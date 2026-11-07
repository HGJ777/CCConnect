// Sample events and clubs for the CCConnect demo (made-up, like the rest of the demo data).
// Event dates are relative to today so the list always looks current.

export type CampusEvent = { id: string; title: string; host: string; place: string; startsAt: string; endsAt: string; about: string; going: number; tag: string };
export type ClubIcon = "code" | "globe" | "trophy" | "pen" | "briefcase" | "film" | "stethoscope" | "music" | "mic" | "camera" | "sparkles" | "users";
// colors: the cover gradient; icon: the cover's big mark; photos: the mock gallery (caption + icon); friends: classmates in it.
export type CampusClub = { id: string; name: string; category: "Academic" | "Cultural" | "Sports" | "Arts" | "Careers"; members: number; meets: string; about: string; colors: [string, string]; icon: ClubIcon; photos: [string, ClubIcon][]; friends: string[] };

const at = (days: number, hour: number, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

export const CAMPUS_EVENTS: CampusEvent[] = [
  { id: "ev-1", title: "Midterm study night", host: "Computer Science Society", place: "Scott Library, 2nd floor", startsAt: at(1, 18), endsAt: at(1, 21), about: "Bring your practice midterms. Upper-years will be around to help with recursion, linked lists and lab 4.", going: 42, tag: "Study" },
  { id: "ev-2", title: "Resume clinic with recruiters", host: "Career Centre", place: "Kaneff Tower, room 519", startsAt: at(2, 13), endsAt: at(2, 15), about: "Fifteen-minute one-on-one reviews. Bring a printed copy or have it on your phone.", going: 87, tag: "Careers" },
  { id: "ev-3", title: "Diwali night market", host: "South Asian Students Association", place: "Vari Hall rotunda", startsAt: at(3, 17), endsAt: at(3, 22), about: "Food stalls, henna, music and a lantern walk at 8. Free entry.", going: 214, tag: "Culture" },
  { id: "ev-4", title: "Intramural futsal finals", host: "Lions Rec", place: "Tait McKenzie gym", startsAt: at(4, 19), endsAt: at(4, 21), about: "Come cheer on the last two teams of the term. Snacks for the first 50 people.", going: 63, tag: "Sports" },
  { id: "ev-5", title: "Open mic and poetry slam", host: "Creative Writing Club", place: "The Underground", startsAt: at(8, 19, 30), endsAt: at(8, 22), about: "Sign up at the door for a five-minute slot, or just come listen.", going: 38, tag: "Arts" },
  { id: "ev-6", title: "Hackathon kickoff", host: "Lassonde Engineering Society", place: "Bergeron Centre atrium", startsAt: at(12, 10), endsAt: at(12, 12), about: "Team formation, theme reveal and a workshop on shipping a demo in 24 hours.", going: 129, tag: "Tech" },
];

export const CAMPUS_CLUBS: CampusClub[] = [
  { id: "cl-1", name: "Computer Science Society", category: "Academic", members: 640, meets: "Thursdays, 6 pm · Lassonde 1009", about: "Study nights, coding interviews practice and the end-of-term LAN party.", colors: ["#2563eb", "#7c3aed"], icon: "code", photos: [["Study night", "code"], ["LAN party", "sparkles"], ["Hack demo day", "mic"]], friends: ["Priya S", "Marcus T", "Daniel O"] },
  { id: "cl-2", name: "South Asian Students Association", category: "Cultural", members: 1120, meets: "Every other Friday · Vari Hall", about: "Culture nights, the Diwali market and a mentorship program for first-years.", colors: ["#f97316", "#db2777"], icon: "globe", photos: [["Diwali market", "sparkles"], ["Culture night", "music"], ["Mentor meetup", "users"]], friends: ["Aisha K", "Priya S"] },
  { id: "cl-3", name: "Lions Rec Futsal", category: "Sports", members: 210, meets: "Mondays and Wednesdays, 8 pm · Tait gym", about: "Drop-in games for all levels, plus the intramural league each term.", colors: ["#16a34a", "#0d9488"], icon: "trophy", photos: [["Finals night", "trophy"], ["Drop-in games", "users"], ["Team photo", "camera"]], friends: ["Marcus T", "Jaylee Park"] },
  { id: "cl-4", name: "Creative Writing Club", category: "Arts", members: 95, meets: "Tuesdays, 5 pm · Ross S-block lounge", about: "Workshops, a monthly open mic and an anthology we publish every spring.", colors: ["#9333ea", "#e11d48"], icon: "pen", photos: [["Open mic", "mic"], ["Workshop", "pen"], ["Spring anthology", "sparkles"]], friends: ["Sofia R"] },
  { id: "cl-5", name: "Business and Consulting Group", category: "Careers", members: 380, meets: "Wednesdays, 6 pm · Schulich SSB", about: "Case competitions, alumni panels and coffee chats with recruiters.", colors: ["#0f172a", "#2563eb"], icon: "briefcase", photos: [["Case competition", "briefcase"], ["Alumni panel", "mic"], ["Coffee chats", "users"]], friends: ["Daniel O", "Aisha K"] },
  { id: "cl-6", name: "Film Society", category: "Arts", members: 160, meets: "Fridays, 7 pm · Curtis Lecture Hall L", about: "A free screening every week and a short-film contest in March.", colors: ["#b45309", "#7c2d12"], icon: "film", photos: [["Friday screening", "film"], ["Short-film contest", "camera"], ["Director Q&A", "mic"]], friends: ["Jaylee Park", "Sofia R"] },
  { id: "cl-7", name: "Pre-Med Society", category: "Academic", members: 520, meets: "First Monday of the month · Life Sciences 101", about: "MCAT study groups, shadowing tips and talks from med students.", colors: ["#0891b2", "#4f46e5"], icon: "stethoscope", photos: [["MCAT study group", "stethoscope"], ["Med student talk", "mic"], ["Volunteer day", "users"]], friends: ["Priya S", "Sofia R"] },
];

export const CLUB_CATEGORIES = ["All", "Academic", "Cultural", "Sports", "Arts", "Careers"] as const;
