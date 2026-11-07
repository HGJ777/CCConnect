// CCConnect's campus assistant. With a signed-in Claude viewer it asks Claude (the artifact `sample`
// capability, on the viewer's own Claude usage); everywhere else it answers from the demo's own data.
import { CAMPUS_CLUBS, CAMPUS_EVENTS } from "./campus";

export type AssistantTurn = { mine: boolean; text: string };
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
    `The student's courses: ${courses.join(", ") || "none yet"}.`,
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
export function offlineAnswer(question: string, courses: string[]) {
  const q = question.toLowerCase();
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
