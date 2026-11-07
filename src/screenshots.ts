// App Store screenshot mode (`vite build --mode screenshots`, see client/.env.screenshots): every /api/ request is
// answered with made-up data (no real accounts, nothing sent to the server), and the app walks itself through the
// screens so a simulator can be captured without tapping. Never part of a normal build.

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
const person = (displayName: string) => ({ displayName, program: "", studyYear: null, bio: "", interests: [] });

const DEGREE = { id: "deg-cs", code: "CSE", name: "Computer Science", faculty: "Lassonde School of Engineering", credentials: "BSc", status: "active", groupId: "grp-degree", memberCount: 1284, unreadCount: 0 };
const ME = "Jordan Lee";
const COURSES = [
  { id: "grp-eecs", courseCode: "EECS 2030", instructor: "Kim", unreadCount: 3, memberCount: 186 },
  { id: "grp-math", courseCode: "MATH 1300", instructor: "Patel", unreadCount: 0, memberCount: 241 },
  { id: "grp-adms", courseCode: "ADMS 1000", instructor: null, unreadCount: 1, memberCount: 312 },
].map((group) => ({ ...group, termName: "Fall 2026", endsOn: "2027-01-01", fullYear: false, pinnedAt: [], joined: true }));
const ROOMS = [
  { id: "room-lab", courseGroupId: "grp-eecs", courseCode: "EECS 2030", name: "Lab 4 team", unreadCount: 2 },
  { id: "room-case", courseGroupId: "grp-adms", courseCode: "ADMS 1000", name: "Case study group", unreadCount: 0 },
].map((room) => ({ ...room, isCreator: true, createdById: "me", lastActivityAt: minutesAgo(30), expiresAt: minutesAgo(-43200), members: [{ id: "me", name: "Jordan Lee", isCreator: true }, { id: "p-1", name: "Marcus T", isCreator: false }], pendingInvites: [], lastMessage: null }));
// Classmates in every course (the demo's member list); private groups are made from these.
const CLASSMATES = ["Priya S", "Marcus T", "Jaylee Park", "Daniel O", "Aisha K", "Sofia R"].map((name, index) => ({ id: `p-${index}`, name }));
// Group messages, per group; the two sample groups start with a short conversation.
const roomMessages = new Map<string, Record<string, unknown>[]>();

// Newest first, like the server.
const CHAT: [string, string, number, { emoji: string; count: number }[]?][] = [
  [ME, "same, see you all at 6 😅", 2],
  ["Marcus T", "library 2nd floor tonight if anyone wants to go over the practice midterm", 4, [{ emoji: "🙏", count: 4 }]],
  ["Priya S", "it's on recursion + linked lists, the review slides are on eClass", 9],
  ["Jaylee Park", "wait is the midterm next thursday or the one after?", 11],
  [ME, "lab 4 is due friday at 11:59 btw", 26, [{ emoji: "👍", count: 3 }]],
  ["Daniel O", "anyone figure out question 3 on lab 4? my equals() keeps failing", 31],
  ["Priya S", "you have to override hashCode too, that got me last week", 29, [{ emoji: "❤️", count: 2 }]],
];
const coursePosts = CHAT.map(([name, body, minutes, reactions], index) => ({
  id: `msg-${index}`, kind: "text", body, imageUrl: null, attachmentName: null, pollOptions: [], pinnedAt: null, createdAt: minutesAgo(minutes),
  author: person(name), reactionCount: reactions?.reduce((total, reaction) => total + reaction.count, 0) || 0, reacted: false,
  reactions: reactions || [], myReaction: null, pollVotes: {}, myPollVote: null, isMine: name === ME,
})).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const FORUM: [string, string, string, number, number][] = [
  ["Aisha K", "Which prof for EECS 2031 next term?", "Deciding between the two sections for winter. Anyone had either of them? Mostly care about how the labs are run.", 3, 3],
  ["Marcus T", "Anyone want to start a midterm study group?", "Thinking Tuesdays 6pm at Scott Library, second floor. Bring your notes, I'll bring snacks.", 45, 6],
  ["Sofia R", "Co-op info session this Thursday", "Lassonde co-op office is running a Q&A at 4pm in Bergeron. Worth going if you're applying for summer.", 180, 2],
  ["Daniel O", "Is MATH 1300 worth taking in first year?", "Thinking of taking it alongside EECS 1015. Is the workload manageable?", 600, 9],
];
const forumPosts = FORUM.map(([name, title, body, minutes, comments], index) => ({
  id: `post-${index}`, kind: "info", degreeId: DEGREE.id, flair: null, imageUrls: [], body: `${title}\n\n${body}`, externalUrl: null,
  createdAt: minutesAgo(minutes), author: person(name), reactionCounts: {}, commentCount: comments, myReaction: null, isMine: false,
}));
// A course's forum (title only, or title + description, like real posts).
const COURSE_FORUM_POSTS: [string, string, string, number, number][] = [
  ["Priya S", "Is the midterm cumulative?", "", 12, 14],
  ["Marcus T", "Which section should I take next term?", "Deciding between Prof. Kim and the other section. Anyone had either of them?", 48, 6],
  ["Daniel O", "Anyone figure out question 3 on lab 4?", "My equals() keeps failing the tests even though the fields match.", 130, 9],
  ["Aisha K", "Are the lecture slides enough for the final?", "", 320, 5],
  ["Sofia R", "Which tutorial section is best?", "", 610, 7],
];
const courseForumPosts = COURSE_FORUM_POSTS.map(([name, title, body, minutes, comments], index) => ({
  id: `course-post-${index}`, kind: "info", degreeId: null, courseGroupId: "grp-eecs", courseCode: "EECS 2030", courseChannel: "questions", flair: null, imageUrls: [], body: body ? `${title}\n\n${body}` : title, externalUrl: null,
  createdAt: minutesAgo(minutes), author: person(name), reactionCounts: {}, commentCount: comments, myReaction: null, isMine: false,
}));
const COMMENTS: [string, string, number, string | null][] = [
  ["Priya S", "Took Prof. Kim's section last year. Labs were really well organized and the TAs actually answer on the forum.", 2, null],
  ["Jordan Lee", "Second this, Kim's midterm review sessions are the best", 1, "c-0"],
  ["Marcus T", "Other section is fine too but labs are on Friday evenings 💀", 1, null],
  ["Aisha K", "Friday evening labs is a dealbreaker lol, Kim it is", 0.6, "c-2"],
  ["Priya S", "and she posts the slides before lecture, huge help", 0.5, "c-1"],
];
const comments = COMMENTS.map(([authorName, body, minutes, parentCommentId], index) => ({ id: `c-${index}`, parentCommentId, body, createdAt: minutesAgo(minutes), authorName, isMine: authorName === ME }));

const chatNote = (id: string, actorName: string, preview: string, minutes: number, unread: boolean) => ({ id, kind: "chat_message", courseGroupId: "grp-eecs", postTitle: "EECS 2030", courseCode: "EECS 2030", actorName, preview, createdAt: minutesAgo(minutes), unread });
const SAMPLE_NOTIFICATIONS = [
  chatNote("n1", "Priya S", "it's on recursion + linked lists, the review slides are on eClass", 9, true),
  chatNote("n2", "Jaylee Park", "wait is the midterm next thursday or the one after?", 11, true),
  chatNote("n3", "Daniel O", "anyone figure out question 3 on lab 4?", 31, true),
  { id: "n4", kind: "comment_reply", postId: "post-0", postTitle: "Which prof for EECS 2031 next term?", actorName: "Marcus T", preview: "Other section is fine too but labs are on Friday evenings", createdAt: minutesAgo(60), unread: true },
  { id: "n5", kind: "project_invite", projectRoomId: "room-x", courseGroupId: "grp-eecs", postTitle: "Lab 5 team", courseCode: "EECS 2030", actorName: "Aisha K", preview: "", createdAt: minutesAgo(26 * 60), unread: false, pending: true },
  { id: "n6", kind: "new_course", courseGroupId: "grp-math", courseCode: "PHIL 1100", postTitle: "PHIL 1100", actorName: "", preview: "", createdAt: minutesAgo(30 * 60), unread: false },
  chatNote("n7", "Sofia R", "anyone want to split notes for the midterm?", 4 * 24 * 60, false),
  chatNote("n8", "Sofia R", "I can do chapters 1 to 3", 4 * 24 * 60 + 5, false),
  { id: "n9", kind: "new_post", postId: "dev-1", postTitle: "Welcome to CCConnect", actorName: "CCConnect", preview: "Find your classmates, ask your program anything.", createdAt: minutesAgo(12 * 24 * 60), unread: false },
];
const NOTE_ENTRIES = ([
  ["Midterm is on recursion + linked lists, chapters 3 to 6", 1500],
  ["Override hashCode whenever you override equals", 1440],
  ["Ask Prof. Kim about the bonus question on lab 4", 180],
  ["Lab 4 due Friday at 11:59", 40],
] as [string, number][]).map(([body, minutes], index) => ({ id: `entry-${index}`, body, imageUrl: null, createdAt: minutesAgo(minutes) }));
const routes: [RegExp, (path: string) => unknown][] = [
  [/^\/api\/me$/, () => ({ account: { id: "me", email: "jordan@my.yorku.ca", bio: "", needsPassword: location.search.includes("password"), hasPassword: true, degreeId: DEGREE.id, ageConfirmed: !/signup|password/.test(location.search), termsAccepted: !/terms|signup|password/.test(location.search), termsVersion: "2026-10-10", postingBannedUntil: null, isAdmin: false, canPost: false } })], // ?terms shows the Terms screen
  [/^\/api\/identity$/, () => ({ profile: { displayName: ME, program: "", studyYear: null, bio: "Second year CS", interests: [], contactLabel: "", contactValue: "" } })],
  [/^\/api\/course-groups$/, () => ({ term: { id: "term", name: "Fall 2026" }, terms: [], classmates: [], degree: DEGREE, groups: COURSES })],
  [/^\/api\/course-groups\/[^/]+\/posts$/, () => ({ posts: coursePosts })],
  [/^\/api\/course-groups\/[^/]+\/members$/, () => ({ members: CLASSMATES })],
  [/^\/api\/course-groups\/[^/]+\/project-rooms\/discover$/, () => ({ setupRequired: false, projectRooms: [
    { id: "pub-1", courseGroupId: "grp-eecs", name: "Midterm study group", createdBy: "Marcus T", memberCount: 14, lastActivityAt: minutesAgo(20), expiresAt: minutesAgo(-43200) },
    { id: "pub-2", courseGroupId: "grp-eecs", name: "Lab help (any section)", createdBy: "Priya S", memberCount: 8, lastActivityAt: minutesAgo(300), expiresAt: minutesAgo(-43200) },
  ] })],
  [/^\/api\/course-groups\/[^/]+\/project-rooms$/, (path) => ({ projectRooms: ROOMS.filter((room) => room.courseGroupId === path.split("/")[3]), setupRequired: false })],
  [/^\/api\/project-rooms\/[^/?]+$/, (path) => {
    const room = ROOMS.find((item) => item.id === path.split("/")[3]) || ROOMS[0];
    if (!roomMessages.has(room.id)) roomMessages.set(room.id, room.id.startsWith("demo-") ? [] : [
      { id: `${room.id}-1`, body: "I'll take the write-up if someone does the diagrams", createdAt: minutesAgo(90), mine: false, authorAccountId: "p-1", author: person("Marcus T") },
      { id: `${room.id}-2`, body: "On it, diagrams by Thursday", createdAt: minutesAgo(60), mine: true, authorAccountId: "me", author: person(ME) },
    ]);
    return { projectRoom: room, messages: roomMessages.get(room.id) };
  }],
  [/^\/api\/chats$/, () => ({ courses: { "grp-eecs": { body: CHAT[0][1], authorName: ME, mine: true, createdAt: minutesAgo(2) } }, projectRooms: ROOMS })],
  [/^\/api\/social\/posts\?degreeId=/, () => ({ posts: forumPosts })],
  [/^\/api\/social\/posts\?courseGroupId=/, () => ({ posts: courseForumPosts })],
  [/^\/api\/social\/posts\?scope=general/, () => ({ posts: [...generalExtra, ...forumPosts.map((post) => ({ ...post, degreeId: null }))] })],
  [/^\/api\/social\/posts$/, () => ({ posts: [{ ...forumPosts[2], id: "dev-1", degreeId: null, body: "Welcome to CCConnect\n\nFind your classmates, ask your program anything, and team up in project rooms.", author: person("CCConnect") }] })],
  [/^\/api\/social\/posts\/[^/]+\/comments$/, (path) => ({ comments: commentsByPost.get(path.split("/")[4]) || comments })],
  [/^\/api\/notes$/, () => ({ notes: [{ id: "note-eecs", courseGroupId: "grp-eecs", name: "General notes", createdAt: minutesAgo(9000), updatedAt: minutesAgo(40) }] })],
  [/^\/api\/notes\/[^/]+\/entries$/, () => ({ entries: NOTE_ENTRIES })],
  [/^\/api\/notifications$/, () => ({ notifications: location.search.includes("notifs") ? SAMPLE_NOTIFICATIONS : [], unreadCount: 0, setupRequired: false })], // ?notifs fills the list
  [/^\/api\/notification-settings$/, () => ({ settings: { paused: false, offKinds: [], mutedChats: [] }, setupRequired: false })],
  [/^\/api\/blocks$/, () => ({ blocked: [] })],
  [/^\/api\/course-requests$/, () => ({ requests: [], setupRequired: false })],
  [/^\/api\/degrees$/, () => ({ degrees: [DEGREE], myRequests: [] })],
  [/^\/api\/rooms$/, () => ({ rooms: [] })],
];

// Demo writes: new posts, comments and note entries are kept in memory, so they show up until the page is reloaded.
let demoId = 0;
const generalExtra: Record<string, unknown>[] = [];
const commentsByPost = new Map<string, Record<string, unknown>[]>();
function demoWrite(method: string, path: string, rawBody: BodyInit | null | undefined): unknown {
  let body: Record<string, any> = {};
  try { body = typeof rawBody === "string" ? JSON.parse(rawBody) : {}; } catch { body = {}; }
  const now = new Date().toISOString();
  if (method === "POST" && path === "/api/chat-attachments") return { attachmentUrl: body.fileData || "", url: body.fileData || "" };
  if (method === "POST" && path === "/api/social/posts") {
    const post = { id: `demo-post-${++demoId}`, kind: "info", degreeId: null, courseGroupId: body.courseGroupId || null, courseCode: body.courseGroupId ? COURSES.find((group) => group.id === body.courseGroupId)?.courseCode || null : null, courseChannel: body.courseGroupId ? "questions" : null, flair: null, imageUrls: body.imageUrls || [], body: String(body.body || ""), externalUrl: null, createdAt: now, author: person(ME), reactionCounts: {}, commentCount: 0, myReaction: null, isMine: true };
    if (post.courseGroupId) courseForumPosts.unshift(post as (typeof courseForumPosts)[number]); else generalExtra.unshift(post);
    return { post };
  }
  const commentPath = path.match(/^\/api\/social\/posts\/([^/]+)\/comments$/);
  if (method === "POST" && commentPath) {
    const comment = { id: `demo-comment-${++demoId}`, parentCommentId: body.parentCommentId || null, body: String(body.body || ""), imageUrl: body.imageUrl || null, createdAt: now, authorName: ME, isMine: true };
    commentsByPost.set(commentPath[1], [...(commentsByPost.get(commentPath[1]) || comments), comment]);
    return { comment };
  }
  const newGroup = path.match(/^\/api\/course-groups\/([^/]+)\/project-rooms$/);
  if (method === "POST" && newGroup) {
    const course = COURSES.find((group) => group.id === newGroup[1]);
    const picked = CLASSMATES.filter((person) => (body.memberIds || []).includes(person.id));
    const room = { id: `demo-room-${++demoId}`, courseGroupId: newGroup[1], courseCode: course?.courseCode || "", name: String(body.name || "New group"), unreadCount: 0, isCreator: true, createdById: "me", lastActivityAt: now, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), members: [{ id: "me", name: ME, isCreator: true }, ...picked.map((person) => ({ ...person, isCreator: false }))], pendingInvites: [], lastMessage: null };
    ROOMS.push(room as (typeof ROOMS)[number]);
    roomMessages.set(room.id, []);
    return { projectRoom: room };
  }
  const groupPath = path.match(/^\/api\/project-rooms\/([^/]+)\/(messages|members)$/);
  if (method === "POST" && groupPath) {
    const room = ROOMS.find((item) => item.id === groupPath[1]);
    if (groupPath[2] === "members" && room) {
      const added = CLASSMATES.filter((person) => (body.memberIds || []).includes(person.id) && !room.members.some((member) => member.id === person.id));
      room.members.push(...added.map((person) => ({ ...person, isCreator: false })));
      return { ok: true };
    }
    const message = { id: `demo-msg-${++demoId}`, body: String(body.body || ""), attachmentUrl: body.attachmentUrl || null, attachmentName: body.attachmentName || null, isImage: Boolean(body.isImage), createdAt: now, mine: true, authorAccountId: "me", author: person(ME) };
    roomMessages.set(groupPath[1], [...(roomMessages.get(groupPath[1]) || []), message]);
    return { message };
  }
  if (method === "POST" && /^\/api\/notes\/[^/]+\/entries$/.test(path)) {
    const entry = { id: `demo-entry-${++demoId}`, body: String(body.body || ""), imageUrl: body.imageUrl || null, createdAt: now };
    NOTE_ENTRIES.push(entry);
    return { entry };
  }
  return { ok: true };
}

export function installScreenshotMode() {
  try {
    localStorage.setItem("mixby-token", "screenshot");
    localStorage.removeItem("mixby-last-chat");
    localStorage.removeItem("mixby-guest");
    localStorage.setItem("mixby-theme", "light");
  } catch { /* private mode */ }
  // No server in this mode, so hide the "live connection failed" toast.
  const style = document.createElement("style");
  style.textContent = ".mx .mx-toast{display:none!important}";
  document.head.append(style);
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const path = url.pathname + url.search;
    const method = (init?.method || "GET").toUpperCase();
    const match = method === "GET" ? routes.find(([pattern]) => pattern.test(path)) : null;
    const result = match ? match[1](path) : demoWrite(method, url.pathname, init?.body);
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  // The CCConnect demo (`--mode demo`) is clicked through by hand, so it skips the self-running tour.
  if (import.meta.env.VITE_DEMO !== "true" && !/terms|signup|password|notifs/.test(location.search)) runTour();
  // The demo opens on the General Forum (the default page is an old welcome screen).
  if (import.meta.env.VITE_DEMO === "true") {
    const started = Date.now();
    const openForum = () => {
      const row = [...document.querySelectorAll<HTMLElement>(".mx-tree .mx-channel")].find((item) => item.textContent?.includes("General Forum"));
      if (row) row.click(); else if (Date.now() - started < 10000) window.setTimeout(openForum, 150);
    };
    window.setTimeout(openForum, 150);
  } // ?terms = Terms update screen, ?signup = new-account screen
}

// The tour: each screen stays up for SCENE_MS so a script can capture it (scene n starts at about START_MS + n * SCENE_MS).
const START_MS = 6000;
const SCENE_MS = 8000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clickText = (selector: string, text: string) => {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find((candidate) => candidate.textContent?.trim().includes(text));
  element?.click();
};
async function runTour() {
  await wait(START_MS - 1000);
  clickText(".mx-tree .mx-course-row", "EECS 2030"); // 0: course list, one course open
  await wait(1000 + SCENE_MS);
  clickText(".mx-tree .mx-note-row", "General notes"); // 1: private notes
  await wait(SCENE_MS);
  clickText(".mx-tree .mx-channel", "General Forum"); // 2: General Forum
  await wait(SCENE_MS);
  [...document.querySelectorAll<HTMLElement>(".mx-course .mx-channel")].find((row) => row.textContent?.trim().startsWith("forum"))?.click(); // 3: the course's forum
  await wait(SCENE_MS);
  document.querySelectorAll<HTMLElement>(".mx-post-open")[1]?.click(); // 4: a post
  await wait(SCENE_MS);
  document.querySelector<HTMLElement>(".mx-post-fab button:last-child")?.click(); // 5: its comments
}
