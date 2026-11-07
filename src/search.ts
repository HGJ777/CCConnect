// Mixby chat search (Oct 2026): smart, but no AI. Plain rules and counting, in layers:
//   1. Words: lowercase, word forms ("midterms" → "midterm"), typos ("midtrem" → "midterm"), a campus dictionary
//      (mt = midterm, prof = professor, tmrw = tomorrow, wed = wednesday…), and rare words counting more than common
//      ones (BM25, the classic search-engine score).
//   2. Questions vs answers: questions end in "?" or start with when/what/where/is/does/anyone…; answers carry facts
//      (dates, times, rooms, chapters, %, links, files, cancelled/moved/online…); "idk", "same", "lol", "😭" are
//      known non-answers.
//   3. Conversations: a matching question is shown with its best answer, taken from real replies (reply_to_id) or,
//      when nobody used Reply, the next few messages from other people within 3 hours. Similar questions are merged
//      into one card ("4 people asked") with the strongest answer from any of them.
//   4. Students: 👍 reactions and taps on search results (counted by the server) raise a message.
//   5. Time: an answer whose date has passed drops; when answers disagree, the newer one wins and the card says
//      "Updated", and different answers are flagged instead of Mixby picking one as true.
// The same code ranks the messages on the phone and the whole term's matches that the server sends back.

export type SearchMessage = {
  id: string;
  name: string;
  author: string; // stable per person (display name or account id), to tell "someone else" from the asker
  body: string;
  createdAt?: string;
  pending?: boolean;
  image?: string | null;
  file?: string | null;
  reactions?: { emoji: string; count: number }[];
  replyToId?: string | null;
};

export type SearchCard = {
  key: string;
  kind: "answered" | "question" | "info";
  hit: SearchMessage; // the message that matched (the question, or the info message itself)
  answer?: SearchMessage; // best answer for a question
  answerIsReply: boolean; // linked with Reply (vs. guessed from the messages that followed)
  askedCount: number; // similar questions merged into this card
  answerCount: number; // useful-looking answers found
  conflict: boolean; // answers disagree (different dates)
  updated: boolean; // a later answer changed an earlier one
  past: boolean; // the answer's date has already passed
  newer?: SearchMessage; // a later message on the same thing with a different date ("moved to Oct 28")
  newerLinked: boolean; // that later message was posted as a Reply in this conversation: "Update"; otherwise "Possible update"
  junk: boolean; // only the search word plus filler ("midterm boo"): left out of the live bar
  thread: SearchMessage[]; // the question and the messages that answer it, oldest first (for "View conversation")
  target: string; // where "View conversation" jumps to
  score: number;
};

// ---- 1. Words ----

const STOP = new Set("a an the is are was were be been being am i im i'm u you ur we they he she it its it's this that these those to of in on at for and or but so if then than with my your our their me us them do does did doing not no yes ya yeah yep ok okay k kk can could would should will just like really very too what when where who whom which why how anyone anybody someone somebody does has have had any some there here about from by as up out into over get got".split(" "));
const NON_ANSWER = new Set("idk idc dunno same samee me too also wondering lol lmao lmfao rofl haha hahaha hehe omg omfg bruh bro boo ugh ew wtf smh fr ngl tbh no clue no idea ?? ??? ? rip sad mad cry crying dead dying help pls plz please thx ty thanks thank you nice cool mood fml".split(" "));
// Feelings about something ("midterm sucks", "midterm was good") aren't information either.
const OPINION = "sucks suck sucked awful good bad great terrible horrible hard harder hardest easy easier fine brutal rough insane crazy cooked boring fun hate hated love loved scary stressful stressed killed kill worst best ez gg nice cool amazing fair unfair impossible tough doable chill solid mid trash goated decent okay ok alright".split(" ");
const FILLER = new Set([...NON_ANSWER].filter((word) => !word.includes(" ")).concat(["oh", "ah", "uh", "um", "hmm", "wow", "damn", "dang", "lowkey", "highkey", "literally", "actually", "guys", "yall", "y'all", "so", "very", "really", "kinda", "pretty", "super"], OPINION));

// Campus dictionary: every spelling on a line becomes the first word, so they all find each other.
const SYNONYMS: string[][] = [
  ["midterm", "mt", "midterms", "mid-term"],
  ["exam", "final", "finals", "exams"],
  ["assignment", "asgn", "assign", "assignments", "hw", "homework"],
  ["professor", "prof", "profs", "instructor", "teacher"],
  ["tomorrow", "tmrw", "tmr", "tmrrw", "tomorow", "2moro"],
  ["today", "tdy", "tday"],
  ["tonight", "tn", "2nite", "tonite"],
  ["monday", "mon"], ["tuesday", "tue", "tues"], ["wednesday", "wed", "weds"], ["thursday", "thu", "thur", "thurs"],
  ["friday", "fri"], ["saturday", "sat"], ["sunday", "sun"],
  ["tutorial", "tut", "tuts"], ["lecture", "lec", "lect"], ["laboratory", "lab", "labs"],
  ["chapter", "ch", "chap", "chpt"], ["textbook", "txtbk", "book"], ["syllabus", "outline"],
  ["quiz", "quizzes"], ["deadline", "due"], ["room", "rm"], ["eclass", "moodle"],
  ["cancelled", "cancel", "canceled", "cancellation", "cancelling"],
  ["postponed", "postpone", "delayed", "delay", "rescheduled", "reschedule"],
  ["question", "qs", "q"], ["answer", "ans"], ["notes", "note"], ["grade", "grades", "mark", "marks"],
];
// Close but not the same thing ("test" when you typed "midterm"): they match, but count less.
const RELATED: string[][] = [["midterm", "test", "exam"], ["assignment", "project", "lab"], ["lecture", "class"], ["tutorial", "lab"]];

const canonical = new Map<string, string>();
for (const group of SYNONYMS) for (const word of group) canonical.set(word, group[0]);

export function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, "").replace(/['’]/g, "");
  if (canonical.has(w)) return canonical.get(w) as string;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) { w = w.slice(0, -3); if (/(.)\1$/.test(w)) w = w.slice(0, -1); }
  else if (w.length > 4 && w.endsWith("ed") && !w.endsWith("eed")) { w = w.slice(0, -2); if (/(.)\1$/.test(w)) w = w.slice(0, -1); }
  return canonical.get(w) || w;
}
const related = new Map<string, Set<string>>();
for (const group of RELATED) for (const word of group) { const set = related.get(stem(word)) || new Set<string>(); group.forEach((other) => other !== word && set.add(stem(other))); related.set(stem(word), set); }

export const rawWords = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}'’%:-]+/u).map((word) => word.replace(/^[-:'’]+|[-:'’]+$/g, "")).filter(Boolean);
// Numbered short forms also count as the word they stand for ("a2" = assignment 2, "mt1" = midterm 1, "q3" = quiz 3),
// while "a2" still matches "a2" best.
const NUMBERED: [RegExp, string][] = [[/^(a|asgn|assign|hw)\d{1,2}$/, "assignment"], [/^(mt|midterm)\d$/, "midterm"], [/^(q|quiz)\d{1,2}$/, "quiz"], [/^(t|test)\d$/, "test"], [/^(ch|chap|chapter)\d{1,2}$/, "chapter"], [/^(lab)\d{1,2}$/, "laboratory"], [/^(tut|tutorial)\d{1,2}$/, "tutorial"]];
export const terms = (text: string) => rawWords(text).flatMap((word) => { const base = stem(word); const also = NUMBERED.find(([pattern]) => pattern.test(word)); return also && also[1] !== base ? [base, also[1]] : [base]; });

// Typos: optimal string alignment distance (a swap of two letters counts as one), stopping early past `max`.
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prevPrev[j - 2] + 1);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    prevPrev = prev; prev = row;
  }
  return prev[b.length];
}

// ---- 2. Questions vs answers ----

const QUESTION_START = /^(when|what|whats|what's|where|who|which|why|how|is|are|was|were|does|do|did|can|could|will|would|should|has|have|anyone|anybody|someone|somebody|any)\b/i;
export const isQuestion = (body: string) => /\?\s*$/.test(body.trim()) || (QUESTION_START.test(body.trim()) && body.trim().split(/\s+/).length <= 25);
const DECISIVE = /\b(cancel+ed|cancel|postponed|moved|rescheduled|changed|delayed|online|in[- ]person|open[- ]book|closed[- ]book|no class|not happening|confirmed|extended|extension|optional|mandatory|required|not required|worth|counts? for|weighted|allowed|not allowed|cheat ?sheet|formula sheet|on eclass|on moodle|syllabus says|prof said|professor said|announced|posted)\b/i;
const DETAILS: RegExp[] = [
  /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|sday|urday|rsday)?\b/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{1,2}(st|nd|rd|th)?\b|\b\d{1,2}[/-]\d{1,2}\b/i,
  /\b\d{1,2}:\d{2}\s*(am|pm)?\b|\b\d{1,2}\s*(am|pm)\b/i,
  /\b(today|tomorrow|tonight|next week|this week|due|deadline)\b/i,
  /\b(room|rm|hall|building|lecture|tutorial|lab|online|zoom|eclass|moodle)\b/i,
  /\b(chapter|ch\.?|unit|module|week|section|lecture|slides?)\s*\d+/i,
  /\d+\s*%|\bworth\b|\bout of \d+/i,
  /\b[A-Z]{2,4}\s?\d{2,4}\b/,
];
export function infoScore(message: SearchMessage): number {
  const body = message.body.trim();
  const words = rawWords(body);
  const content = words.filter((word) => !STOP.has(word) && !FILLER.has(word) && /\p{L}{2,}|\d/u.test(word));
  let score = Math.min(content.length, 12) * 0.5;
  score += DETAILS.filter((pattern) => pattern.test(body)).length * 1.6;
  if (DECISIVE.test(body)) score += 3; // "It's cancelled" is short but decisive
  if (/https?:\/\/|www\./i.test(body)) score += 1.5;
  if (message.image || message.file) score += 1.5;
  return score;
}
export function isNonAnswer(body: string): boolean {
  const text = body.toLowerCase().replace(/[^\p{L}\p{N}?\s']/gu, " ").replace(/\s+/g, " ").trim();
  if (!text) return true; // only emojis / punctuation
  if (NON_ANSWER.has(text)) return true;
  const words = text.split(" ");
  return words.length <= 4 && words.every((word) => FILLER.has(word) || STOP.has(word) || word === "?" || /^\?+$/.test(word));
}
const reactionCount = (message: SearchMessage) => (message.reactions || []).reduce((sum, reaction) => sum + reaction.count, 0);
const time = (message: SearchMessage) => (message.createdAt ? new Date(message.createdAt).getTime() : 0);

// ---- 5. Time ----

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// The dates a message talks about, worked out from when it was sent ("wed" = the next Wednesday after it).
export function mentionedDates(message: SearchMessage): number[] {
  const sent = message.createdAt ? new Date(message.createdAt) : new Date();
  const found: number[] = [];
  const body = message.body.toLowerCase();
  for (const match of body.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})(st|nd|rd|th)?\b/g)) {
    const date = new Date(sent.getFullYear(), MONTHS.indexOf(match[1].slice(0, 3)), Number(match[2]));
    if (date.getTime() < sent.getTime() - 200 * 86400000) date.setFullYear(date.getFullYear() + 1);
    found.push(date.getTime());
  }
  for (const match of body.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
    const month = Number(match[1]) - 1, day = Number(match[2]);
    if (month < 12 && day >= 1 && day <= 31) found.push(new Date(sent.getFullYear(), month, day).getTime());
  }
  for (const match of body.matchAll(/\b(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(day|nesday|sday|urday|rsday)?\b/g)) {
    const target = DAYS.indexOf(match[1].slice(0, 3));
    const date = new Date(sent.getFullYear(), sent.getMonth(), sent.getDate());
    date.setDate(date.getDate() + ((target - date.getDay() + 7) % 7 || 7));
    found.push(date.getTime());
  }
  if (/\btomorrow|tmrw|tmr\b/.test(body)) found.push(new Date(sent.getFullYear(), sent.getMonth(), sent.getDate() + 1).getTime());
  if (/\btoday|tonight\b/.test(body)) found.push(new Date(sent.getFullYear(), sent.getMonth(), sent.getDate()).getTime());
  return [...new Set(found.map((value) => new Date(value).setHours(0, 0, 0, 0)))];
}

// A correction has to say it changed, and be about this course: "My other course's midterm moved to Oct 28" isn't.
const CHANGE_WORDS = /\b(moved|changed|change|rescheduled|reschedule|postponed|pushed|now|actually|update|updated|correction|instead|no longer|not anymore|cancel+ed|wrong|incorrect|nope)\b|\bno,? (it'?s|its|it is)\b/i;
const OTHER_COURSE = /\b(other|another|different|my \w+ (course|class))\s+(course|class|section|prof|professor)\b|\bnot (this|our) (course|class)\b/i;
function aboutThisCourse(body: string, courseCode?: string) {
  if (OTHER_COURSE.test(body)) return false;
  const codes = [...body.matchAll(/\b([A-Z]{2,6})\s?(\d{4})\b/g)].map((match) => `${match[1]} ${match[2]}`);
  return !courseCode || !codes.length || codes.includes(courseCode.toUpperCase());
}

// ---- Putting it together ----

type Prepared = { message: SearchMessage; terms: string[]; set: Set<string>; nameTerms: Set<string>; question: boolean; nonAnswer: boolean; info: number };
const prepCache = new Map<string, { body: string; prepared: Prepared }>();
function prepare(message: SearchMessage): Prepared {
  const cached = prepCache.get(message.id);
  if (cached && cached.body === message.body && cached.prepared.message === message) return cached.prepared;
  const list = terms(message.body);
  const prepared = { message, terms: list, set: new Set(list), nameTerms: new Set(terms(message.name)), question: isQuestion(message.body), nonAnswer: isNonAnswer(message.body), info: infoScore(message) };
  if (prepCache.size > 5000) prepCache.clear();
  prepCache.set(message.id, { body: message.body, prepared });
  return prepared;
}

export type SearchOptions = { now?: number; clicks?: Record<string, number>; includeNames?: boolean; keepJunk?: boolean; courseCode?: string };

// Words that say what kind of answer you want ("midterm date", "tutorial room") instead of words the message must
// contain: they aren't required, they favour messages that carry that kind of detail.
const INTENTS: [RegExp, RegExp][] = [
  [/^(date|dates|day|days|when|deadline|schedule|scheduled)$/, /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|sday|urday|rsday)?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}\b|\b(today|tomorrow|tonight|next week)\b/i],
  [/^(time|times|hour|hours|start|starts|when)$/, /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b|\b(noon|morning|afternoon|evening)\b/i],
  [/^(where|location|place|room|building|hall)$/, /\b(room|rm|hall|building|lecture hall|online|zoom|[A-Z]{2,4}\s?\d{3})\b/i],
  [/^(info|information|details|detail)$/, /./],
];
export function searchChat(messages: SearchMessage[], query: string, options: SearchOptions = {}): SearchCard[] {
  const now = options.now ?? Date.now();
  const allWords = rawWords(query);
  if (!allWords.length) return [];
  // "midterm date": find midterm messages, and favour the ones with a date. Alone ("date"), the word is searched.
  const intentDetail = allWords.map((word) => INTENTS.find(([pattern]) => pattern.test(word))?.[1]).filter((pattern): pattern is RegExp => Boolean(pattern));
  const queryWords = allWords.filter((word) => !INTENTS.some(([pattern]) => pattern.test(word))).length ? allWords.filter((word) => !INTENTS.some(([pattern]) => pattern.test(word))) : allWords;
  const wants = (message?: SearchMessage) => message && queryWords.length < allWords.length && intentDetail.some((pattern) => pattern.test(message.body)) ? 2.5 : 0;
  const typingLast = !/\s$/.test(query); // the last word may still be half typed: match it as a prefix too
  const docs = messages.filter((message) => !message.pending && message.body.trim()).map(prepare).sort((a, b) => time(a.message) - time(b.message));
  if (!docs.length) return [];
  // BM25 statistics over this chat.
  const docFreq = new Map<string, number>();
  let totalLength = 0;
  for (const doc of docs) { totalLength += doc.terms.length; doc.set.forEach((term) => docFreq.set(term, (docFreq.get(term) || 0) + 1)); }
  const averageLength = totalLength / docs.length || 1;
  const vocabulary = [...docFreq.keys()];
  const idf = (term: string) => { const n = docFreq.get(term) || 0; return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)); };
  // Each typed word → the chat's words it stands for, with how sure we are (exact 1, related 0.6, prefix 0.8, typo 0.65).
  const expansions = queryWords.map((word, index) => {
    const base = stem(word);
    const found = new Map<string, number>([[base, 1]]);
    related.get(base)?.forEach((other) => found.set(other, Math.max(found.get(other) || 0, 0.6)));
    const prefix = index === queryWords.length - 1 && typingLast;
    for (const term of vocabulary) {
      if (found.has(term)) continue;
      if ((prefix || word.length >= 3) && term.startsWith(word.toLowerCase()) && term !== word) found.set(term, 0.8);
      else if (word.length >= 4 && Math.abs(term.length - word.length) <= 2 && editDistance(word.toLowerCase(), term, word.length >= 8 ? 2 : 1) <= (word.length >= 8 ? 2 : 1)) found.set(term, 0.65);
    }
    return found;
  });
  const meaningful = expansions.filter((_, index) => !STOP.has(queryWords[index]) || queryWords.length === 1);
  const matchScore = (doc: Prepared): number | null => {
    let score = 0;
    for (const variants of meaningful.length ? meaningful : expansions) {
      let best = 0;
      for (const [term, weight] of variants) {
        const inBody = doc.set.has(term);
        const inName = options.includeNames && doc.nameTerms.has(term);
        if (!inBody && !inName) continue;
        const tf = inBody ? doc.terms.filter((value) => value === term).length : 1;
        const bm25 = idf(term) * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (doc.terms.length / averageLength))));
        best = Math.max(best, bm25 * weight * (inBody ? 1 : 0.5));
      }
      if (!best) return null; // every typed word has to be there
      score += best;
    }
    return score;
  };
  // Taps only break ties (at most 1 point): someone may tap a result because it's confusing or wrong. 👍 counts more.
  const clicks = (id: string) => Math.min(1, Math.log2(1 + (options.clicks?.[id] || 0)) * 0.4);
  const freshness = (message: SearchMessage) => 1.2 * Math.exp(-Math.max(0, now - time(message)) / (14 * 86400000));
  const indexOf = new Map(docs.map((doc, index) => [doc.message.id, index]));
  const byId = new Map(docs.map((doc) => [doc.message.id, doc]));

  // 3. Answers to a question: real replies first, then the next messages from other people within 3 hours.
  const answersFor = (question: Prepared) => {
    const found: { doc: Prepared; reply: boolean }[] = [];
    for (const doc of docs) if (doc.message.replyToId === question.message.id) found.push({ doc, reply: true });
    const start = indexOf.get(question.message.id) ?? -1;
    for (let i = start + 1, seen = 0; i < docs.length && seen < 8; i++) {
      const doc = docs[i];
      if (time(doc.message) - time(question.message) > 3 * 3600000) break;
      if (doc.message.replyToId && doc.message.replyToId !== question.message.id) continue; // answering something else
      if (doc.message.author === question.message.author) continue;
      if (doc.question && !doc.message.replyToId) break; // a new question starts a new conversation
      seen++;
      if (!found.some((item) => item.doc === doc)) found.push({ doc, reply: false });
    }
    return found;
  };
  const answerScore = (question: Prepared, answer: Prepared, reply: boolean) => {
    if (answer.nonAnswer) return -5;
    if (!aboutThisCourse(answer.message.body, options.courseCode)) return -5; // "my other course's midterm is…"

    if (answer.question) return -3;
    const overlap = [...question.set].filter((term) => !STOP.has(term) && answer.set.has(term)).length;
    const past = mentionedDates(answer.message);
    const passed = past.length > 0 && past.every((value) => value < new Date(now).setHours(0, 0, 0, 0));
    return answer.info + (past.length ? 0.5 : 0) + overlap * 0.8 + (reply ? 3 : 0) + Math.log2(1 + reactionCount(answer.message)) * 1.5 + clicks(answer.message.id) + (passed ? -2 : 0) - (indexOf.get(answer.message.id)! - indexOf.get(question.message.id)!) * 0.15;
  };

  // Every matching message.
  const hits: { doc: Prepared; match: number }[] = [];
  for (const doc of docs) { const match = matchScore(doc); if (match !== null) hits.push({ doc, match }); }

  // 3. Merge similar questions into one card: same kind of question (when / what / where…) and mostly the same
  // meaningful words, compared with each question already in the card.
  const QUESTION_FILLER = new Set(["know", "knows", "tell", "remember", "wondering", "guy", "people", "class", "u", "ur", "pls", "please", "anyone", "someone", "exactly", "again"]);
  const WH = /\b(when|what|where|who|which|why|how)\b/;
  const keyOf = (doc: Prepared) => ({ wh: (doc.message.body.toLowerCase().replace(/when's/g, "when").replace(/what's/g, "what").match(WH) || [""])[0], words: new Set([...doc.set].filter((term) => !STOP.has(term) && !FILLER.has(term) && !QUESTION_FILLER.has(term) && term.length > 1)) });
  const similar = (a: ReturnType<typeof keyOf>, b: ReturnType<typeof keyOf>) => {
    if (a.wh && b.wh && a.wh !== b.wh) return false;
    if (!a.words.size || !b.words.size) return false;
    const shared = [...a.words].filter((term) => b.words.has(term)).length;
    return shared / new Set([...a.words, ...b.words]).size >= 0.5;
  };
  const clusters: { questions: { doc: Prepared; match: number; key: ReturnType<typeof keyOf> }[] }[] = [];
  for (const hit of hits.filter((item) => item.doc.question)) {
    const key = keyOf(hit.doc);
    const cluster = clusters.find((group) => group.questions.some((question) => similar(question.key, key)));
    if (cluster) cluster.questions.push({ ...hit, key }); else clusters.push({ questions: [{ ...hit, key }] });
  }

  const cards: SearchCard[] = [];
  const usedAsAnswer = new Set<string>();
  for (const cluster of clusters) {
    const candidates: { doc: Prepared; reply: boolean; score: number; question: Prepared }[] = [];
    for (const { doc } of cluster.questions) for (const { doc: answer, reply } of answersFor(doc)) candidates.push({ doc: answer, reply, score: answerScore(doc, answer, reply), question: doc });
    const useful = candidates.filter((item) => item.score >= 2);
    // 5. Disagreeing answers: different dates. The newer one wins and the card says so.
    const dated = useful.map((item) => ({ ...item, dates: mentionedDates(item.doc.message) })).filter((item) => item.dates.length);
    const distinct = new Set(dated.map((item) => item.dates.join(",")));
    const conflict = distinct.size > 1;
    let best = useful.sort((a, b) => b.score - a.score)[0];
    // A later answer in the same conversation that says it changed ("now it's Oct 28") shows under the earlier
    // answer it corrects, as an update, instead of silently replacing it.
    let change: (typeof dated)[number] | undefined;
    if (conflict) {
      // A correction says it changed, or was posted as a Reply in this conversation with a different date.
      const latest = dated.filter((item) => item.reply || CHANGE_WORDS.test(item.doc.message.body)).sort((a, b) => time(b.doc.message) - time(a.doc.message))[0];
      const earlier = latest && useful.filter((item) => item.doc !== latest.doc && time(item.doc.message) < time(latest.doc.message) && mentionedDates(item.doc.message).join(",") !== latest.dates.join(",")).sort((a, b) => b.score - a.score)[0];
      if (latest && earlier) { best = earlier; change = latest; }
    }
    const updated = Boolean(change);
    const shownQuestion = best ? best.question : cluster.questions.sort((a, b) => time(b.doc.message) - time(a.doc.message))[0].doc;
    const match = Math.max(...cluster.questions.map((item) => item.match));
    const pastDates = best ? mentionedDates(best.doc.message) : [];
    const past = pastDates.length > 0 && pastDates.every((value) => value < new Date(now).setHours(0, 0, 0, 0));
    if (best) usedAsAnswer.add(best.doc.message.id);
    if (change) usedAsAnswer.add(change.doc.message.id);
    cards.push({
      key: `q-${shownQuestion.message.id}`,
      kind: best ? "answered" : "question",
      hit: shownQuestion.message,
      answer: best?.doc.message,
      answerIsReply: Boolean(best?.reply),
      askedCount: cluster.questions.length,
      answerCount: new Set(useful.map((item) => item.doc.message.id)).size,
      conflict,
      updated,
      past,
      newer: change?.doc.message,
      newerLinked: Boolean(change?.reply),
      junk: false,
      thread: [...new Map([shownQuestion, ...answersFor(shownQuestion).map((item) => item.doc), ...(best && best.question !== shownQuestion ? [best.question, best.doc] : [])].map((doc) => [doc.message.id, doc.message])).values()].sort((a, b) => time(a) - time(b)),
      target: shownQuestion.message.id,
      score: match + (best ? 2 + best.score * 0.9 : -1.5) + Math.log2(cluster.questions.length) * 1.2 + clicks(shownQuestion.message.id) + freshness(shownQuestion.message) + wants(best?.doc.message),
    });
  }
  // Standalone information ("Prof moved the midterm to Friday") stands on its own.
  for (const { doc, match } of hits) {
    if (doc.question || usedAsAnswer.has(doc.message.id)) continue;
    const dates = mentionedDates(doc.message);
    const past = dates.length > 0 && dates.every((value) => value < new Date(now).setHours(0, 0, 0, 0));
    // Junk = nothing but the search words and filler, and no details ("midterm boo", "MIDTERM lol 😭").
    const beyond = rawWords(doc.message.body).filter((word) => !STOP.has(word) && !FILLER.has(word) && /\p{L}{2,}|\d/u.test(word) && !expansions.some((variants) => variants.has(stem(word))));
    const junk = doc.nonAnswer || (beyond.length === 0 && !DETAILS.some((pattern) => pattern.test(doc.message.body)) && !DECISIVE.test(doc.message.body) && !doc.message.image && !doc.message.file);
    cards.push({
      key: `i-${doc.message.id}`, kind: "info", hit: doc.message, answerIsReply: false, askedCount: 0, answerCount: 0, conflict: false, updated: false, past, junk, newerLinked: false,
      // A statement's discussion: the message plus every Reply to it.
      thread: [doc.message, ...docs.filter((other) => other.message.replyToId === doc.message.id).map((other) => other.message)].sort((a, b) => time(a) - time(b)),
      target: doc.message.id,
      score: match + wants(doc.message) + doc.info * 0.9 + Math.log2(1 + reactionCount(doc.message)) * 1.5 + clicks(doc.message.id) + freshness(doc.message) - (junk ? 4 : 0) - (past ? 2 : 0) - (aboutThisCourse(doc.message.body, options.courseCode) ? 0 : 5),
    });
  }
  // 5. A later message on the same thing with a different date updates an answered card ("moved to Oct 28").
  for (const card of cards) {
    if (card.kind !== "answered" || !card.answer || card.newer) continue;
    const answerDates = mentionedDates(card.answer).join(",");
    if (!answerDates) continue;
    const topic = keyOf(prepare(card.hit)).words;
    const conversation = new Set([card.hit.id, card.answer.id, ...card.thread.map((message) => message.id)]);
    const later = cards.filter((other) => other.kind === "info" && !other.junk && time(other.hit) > time(card.answer as SearchMessage)).map((other) => other.hit).filter((message) => {
      const dates = mentionedDates(message).join(",");
      const linked = Boolean(message.replyToId && conversation.has(message.replyToId));
      // Linked by Reply: it's a reply in this conversation with a different date. Not linked: it must also say it
      // changed, share the question's topic words and be about this course.
      return dates && dates !== answerDates && (linked || (CHANGE_WORDS.test(message.body) && aboutThisCourse(message.body, options.courseCode) && [...topic].some((term) => prepare(message).set.has(term))));
    }).sort((a, b) => time(b) - time(a))[0];
    if (later) { card.newer = later; card.updated = true; card.newerLinked = Boolean(later.replyToId && conversation.has(later.replyToId)); }
  }
  // A Reply that corrects the shown answer or message ("no it is on tuesday" under "the midterm is on wednesday")
  // shows under it as an Update, even though the reply itself doesn't contain the search words.
  const attached = new Set<string>();
  for (const card of cards) {
    const base = card.answer || card.hit;
    const linkedTo = new Set([card.hit.id, ...(card.answer ? [card.answer.id] : [])]);
    const baseDates = mentionedDates(base).join(",");
    const correction = docs.filter((doc) => doc.message.replyToId && linkedTo.has(doc.message.replyToId) && time(doc.message) > time(base) && !doc.nonAnswer && !doc.question && aboutThisCourse(doc.message.body, options.courseCode)).filter((doc) => {
      const dates = mentionedDates(doc.message).join(",");
      return (dates && dates !== baseDates) || CHANGE_WORDS.test(doc.message.body);
    }).sort((a, b) => time(b.message) - time(a.message))[0];
    if (correction && (!card.newer || time(correction.message) >= time(card.newer))) {
      card.newer = correction.message;
      card.newerLinked = true;
      card.updated = true;
      if (!card.thread.some((message) => message.id === correction.message.id)) card.thread = [...card.thread, correction.message].sort((a, b) => time(a) - time(b));
      attached.add(correction.message.id);
    }
  }
  // The same text twice shows once.
  const seen = new Set<string>();
  return cards.filter((card) => (options.keepJunk || !card.junk) && !(card.kind === "info" && attached.has(card.hit.id))).sort((a, b) => b.score - a.score || time(b.hit) - time(a.hit)).filter((card) => {
    const text = `${card.hit.body.toLowerCase().replace(/\s+/g, " ").trim()}|${card.answer?.body.toLowerCase().trim() || ""}`;
    if (seen.has(text)) return false;
    seen.add(text);
    return Boolean(byId.get(card.hit.id));
  });
}

// For the server: each typed word with its campus-dictionary spellings ([["midterm","mt","midterms"],["room","rm"]]);
// the server turns these into a full-text query (any spelling of each word, every word required).
export function queryGroups(query: string): string[][] {
  // "date", "time", "where"… aren't required words (see INTENTS), unless they're all that was typed.
  const words = rawWords(query);
  const required = words.filter((word) => !INTENTS.some(([pattern]) => pattern.test(word)));
  return (required.length ? required : words).filter((word) => !STOP.has(word) || words.length === 1).slice(0, 6).map((word) => {
    const base = stem(word);
    const group = SYNONYMS.find((list) => list[0] === base) || [];
    return [...new Set([word, base, ...group].map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean))].slice(0, 12);
  }).filter((group) => group.length);
}
// The same search typed slightly differently counts as one for taps ("Midterms date" = "date midterm").
export const queryKey = (query: string) => [...new Set(rawWords(query).filter((word) => !STOP.has(word)).map(stem))].sort().join(" ").slice(0, 80);

// Short words the dictionary knows ("mt", "ch", "rm"): worth a server search even at 2 letters.
export const isDictionaryWord = (word: string) => canonical.has(word.toLowerCase());
