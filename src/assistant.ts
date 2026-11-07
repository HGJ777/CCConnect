// CCConnect's campus assistant. With a signed-in Claude viewer it asks Claude (the artifact `sample`
// capability, on the viewer's own Claude usage); everywhere else it answers from the demo's own data.
import { CAMPUS_CLUBS, CAMPUS_EVENTS } from "./campus";

export type AssistantTurn = { mine: boolean; text: string };
export type CatalogCourse = [code: string, title: string];

// York's course catalogue (public/york-courses.json, 5,184 courses), loaded once when the assistant is first used.
let catalogPromise: Promise<CatalogCourse[]> | null = null;
export function loadCatalog(): Promise<CatalogCourse[]> {
  const get = (url: string) => fetch(url).then((response) => (response.ok ? response.json() : Promise.reject(response.status)));
  return (catalogPromise ||= get("./york-courses.json").catch(() => get("/york-courses.json")).catch(() => { catalogPromise = null; return []; }));
}

const level = (code: string) => { const number = Number(code.match(/\d{4}/)?.[0] || 9999); return number >= 5000 ? 10000 + number : number; };
// Courses whose code or title contains every word of the query ("eecs", "psych 1010", "organic chemistry").
export function searchCourses(catalog: CatalogCourse[], query: string, limit = 12) {
  const words = query.toLowerCase().replace(/([a-z])(\d)/g, "$1 $2").split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  return catalog
    .filter(([code, title]) => { const text = `${code} ${title}`.toLowerCase(); return words.every((word) => text.includes(word)); })
    // Code matches first, then undergraduate (1000-4000 level) before graduate, lowest level first.
    .sort((a, b) => Number(!a[0].toLowerCase().startsWith(words[0])) - Number(!b[0].toLowerCase().startsWith(words[0])) || level(a[0]) - level(b[0]) || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

// The tool Claude calls to look courses up instead of guessing.
export function courseTool(catalog: CatalogCourse[]) {
  return {
    name: "search_courses",
    description: "Search the university's full course catalogue (5,184 courses) by course code, subject code (like EECS or PSYC) or words in the course title. Returns up to 12 matches as code and title. Call it for any question about which courses exist or are available.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "A subject code, course code or title words, e.g. \"PSYC\", \"EECS 2030\" or \"organic chemistry\"" } }, required: ["query"] },
    execute: async (input: { query?: string }) => {
      const found = searchCourses(catalog, String(input?.query || ""));
      return found.length ? found.map(([code, title]) => `${code}: ${title}`).join("\n") : "No matching courses.";
    },
  };
}
type Sample = ((input: string | { role: "user" | "assistant"; content: string }[], options?: Record<string, unknown>) => Promise<{ text: string; truncated: boolean }>) | null;

let samplePromise: Promise<Sample> | null = null;
// Resolves Claude's `sample` function inside a Claude viewer, or null (no viewer, signed out, not offered).
export function claudeSample(): Promise<Sample> {
  const host = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
  if (!host?.use) return Promise.resolve(null);
  return (samplePromise ||= host.use("sample").then((value) => (typeof value === "function" ? (value as Sample) : null)).catch(() => null));
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Everything the assistant may talk about, as plain text for Claude.
export function campusContext(courses: string[], forumTitles: string[]) {
  return [
    `Today is ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`,
    `The student's own courses on CCConnect: ${courses.join(", ") || "none yet"}. Every course has its own forum on CCConnect, and students add courses with + next to My courses.`,
    "The full York University course catalogue has 5,184 courses. Use the search_courses tool to look courses up; never invent course codes or titles.",
    "Upcoming campus events:",
    ...CAMPUS_EVENTS.map((event) => `- ${event.title} (${event.tag}), ${when(event.startsAt)} at ${event.place}, hosted by ${event.host}. ${event.about} ${event.going} going.`),
    "Clubs:",
    ...CAMPUS_CLUBS.map((club) => `- ${club.name} (${club.category}, ${club.members} members), meets ${club.meets}. ${club.about}`),
    "Recent General Forum post titles:",
    ...forumTitles.slice(0, 8).map((title) => `- ${title}`),
  ].join("\n");
}

// The chat as Claude's input: instructions and data in the first turn, then the conversation.
export function claudeInput(history: AssistantTurn[], context: string) {
  const intro = `You are CCConnect's campus assistant for a university student. Answer in 1-4 short sentences or a short list, friendly and specific, using only the information below when it is about this campus; say so when something isn't listed. Plain text, no markdown headings.\n\n${context}\n\nStudent's question:`;
  return history.map((turn, index) => ({ role: turn.mine ? "user" as const : "assistant" as const, content: index === 0 && turn.mine ? `${intro} ${turn.text}` : turn.text }));
}

// Answers from the demo's data when Claude isn't available.
const CATALOG_FILLER = new Set(["what", "which", "courses", "course", "classes", "class", "available", "avaliable", "are", "is", "the", "a", "an", "about", "for", "in", "on", "any", "there", "offer", "offered", "list", "show", "me", "i", "can", "take", "do", "you", "have", "with", "of", "to", "some", "good", "find", "search", "york", "level", "all"]);
export function offlineAnswer(question: string, courses: string[], catalog: CatalogCourse[] = []) {
  const q = question.toLowerCase();
  if (/course|class|catalog/.test(q) && !/midterm|exam|study|lab|assignment|help/.test(q)) {
    const topic = q.split(/[^a-z0-9]+/).filter((word) => word && !CATALOG_FILLER.has(word)).join(" ");
    const found = topic ? searchCourses(catalog, topic, 6) : [];
    if (found.length) return `Courses matching "${topic}":\n- ${found.map(([code, title]) => `${code}: ${title}`).join("\n- ")}\nAdd one with + next to My courses.`;
    if (topic) return `I couldn't find a course matching "${topic}". Try a subject code like PSYC or EECS, or words from the title.`;
    return `York has ${(catalog.length || 5184).toLocaleString()} courses. Ask about a subject, like "psychology courses" or "EECS courses". Your courses here are ${courses.join(", ") || "not set yet"}.`;
  }
  const soon = [...CAMPUS_EVENTS].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  // The club whose distinctive words (not "society", "club"…) the question mentions most.
  const generic = new Set(["society", "club", "association", "group", "students", "student", "and", "the", "rec"]);
  const scored = CAMPUS_CLUBS.map((item) => ({ item, score: item.name.toLowerCase().split(/\s+/).filter((word) => word.length > 2 && !generic.has(word) && q.includes(word)).length })).sort((a, b) => b.score - a.score);
  const club = scored[0]?.score ? scored[0].item : null;
  if (club) return `${club.name} (${club.category}, ${club.members.toLocaleString()} members) meets ${club.meets}. ${club.about} Tap Message on its card in Clubs to ask them anything.`;
  const category = ["academic", "cultural", "sports", "arts", "careers"].find((name) => q.includes(name) || (name === "sports" && /sport|soccer|futsal|gym/.test(q)) || (name === "careers" && /career|job|resume|intern/.test(q)));
  if (/event|happening|this week|tonight|tomorrow|weekend|do on campus/.test(q)) {
    const list = soon.slice(0, 3).map((event) => `${event.title}, ${when(event.startsAt)} at ${event.place}`);
    return `Coming up:\n- ${list.join("\n- ")}\nSee everything in Events.`;
  }
  if (/club|join|society|group/.test(q) || category) {
    const picks = CAMPUS_CLUBS.filter((item) => !category || item.category.toLowerCase() === category).slice(0, 3);
    return `${category ? "Clubs you might like" : "Popular clubs"}:\n- ${picks.map((item) => `${item.name} (${item.meets})`).join("\n- ")}\nOpen Clubs to message any of them.`;
  }
  if (/midterm|exam|study|lab|assignment|course|class/.test(q)) {
    const study = soon.find((event) => event.tag === "Study");
    return `Your courses are ${courses.join(", ") || "not set yet"}. Each one has its own forum where classmates ask about midterms and labs.${study ? ` There's also ${study.title} on ${when(study.startsAt)} at ${study.place}.` : ""}`;
  }
  if (/hi|hello|hey|help|what can you/.test(q)) return "Hi! Ask me about events this week, clubs to join, or where to get help with your courses.";
  return "I can help with campus events, clubs and your courses. Try \"What's happening this week?\" or \"Which clubs are good for careers?\"";
}
