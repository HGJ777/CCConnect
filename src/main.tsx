import { Fragment, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, SyntheticEvent, TouchEvent as ReactTouchEvent } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { io, Socket } from "socket.io-client";
import { CAMPUS_CLUBS, CAMPUS_EVENTS, CLUB_CATEGORIES } from "./campus";
import { CalendarDays, MapPin, UsersRound, CodeXml as ClubCode, Globe as ClubGlobe, Trophy as ClubTrophy, PenLine as ClubPen, Briefcase as ClubBriefcase, Film as ClubFilm, Stethoscope as ClubStethoscope, Music as ClubMusic, Mic as ClubMic, Camera as ClubCamera, Sparkles as ClubSparkles, Users as ClubUsers } from "lucide-react";
import type { ClubIcon } from "./campus";
import { campusContext, claudeInput, claudeSample, offlineAnswer, type AssistantTurn } from "./assistant";
// Club artwork for the CCConnect demo: covers and mock photos are drawn from a gradient, a pattern and one of these marks.
const CLUB_ICONS: Record<ClubIcon, typeof ClubCode> = { code: ClubCode, globe: ClubGlobe, trophy: ClubTrophy, pen: ClubPen, briefcase: ClubBriefcase, film: ClubFilm, stethoscope: ClubStethoscope, music: ClubMusic, mic: ClubMic, camera: ClubCamera, sparkles: ClubSparkles, users: ClubUsers };
import { BarChart3, Flame, Heart, Reply as ReplyIcon, Share as ShareIcon, SquarePlus, ToggleRight } from "lucide-react";
import { ArrowRight, Pencil, NotebookPen, BadgeCheck, Ban, Copy, Eye, EyeOff, FileText, Clock, Mail, Menu, Newspaper, Lock, Send, Smile, TriangleAlert, MoreVertical, Bell, BellOff, Hash, Shield, CircleCheck, LogOut, Moon, MoreHorizontal, Palette, Paperclip, Share2, ChevronDown, FolderKanban, Plus, Settings2, ShieldCheck, Trash2, Flag, MicOff, ImageIcon, Link2, X, ChevronLeft, ChevronRight, Compass, Camera, Check, GraduationCap, House, ImagePlus, MessageCircle, Pin, QrCode, Search, SlidersHorizontal, Smartphone, UserRound, Users } from "lucide-react";
import { currentDeviceToken, enablePush, GoogleAuth, isNativeApp, onPushTap, PhotoPicker, setAppChrome } from "./native";
import type { PushTap } from "./native";
import { cachedPhoto, DEVICE_PHOTO, dropOp, forgetNote, forgetPhoto, loadPhoto, noteView, pendingOps, queueOp, readNoteSnapshot, savePhoto, writeNoteSnapshot } from "./notesync";
import type { NoteOp } from "./notesync";
import { isDictionaryWord, queryGroups, queryKey, searchChat } from "./search";
import type { SearchCard, SearchMessage } from "./search";
import { canPromptInstall, currentSubscription, isIOS, isStandalone, onInstallChange, onWebPushTap, promptInstall, registerServiceWorker, subscribeToPush, webPushSupported } from "./webpush";
import "./style.css";
import "./social.css";
import "./shell.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
// Sign in with Google (public client IDs from the CCConnect Google Cloud project). York accounts only; the server enforces it.
const GOOGLE_WEB_CLIENT_ID = "914867383475-01qls6pcvgi3tca5f60i6k2lnlbvc754.apps.googleusercontent.com";
const GOOGLE_IOS_CLIENT_ID = "914867383475-s6tl2km60j5qc21m4vee2eqb17lkiffe.apps.googleusercontent.com";
// Rooms are hidden for now (website and app). Everything still exists on the server; set to true to bring them back.
const ROOMS_ENABLED = false;
// Posting (the feed, post pages, creating posts) is off for now on the website and app; CCConnect is Discover + Chats.
// The code is untouched: set to true to bring the feed back (and the old Home/＋ tab bar in the app).
const POSTS_ENABLED = true;
// The Degree / Course / Project layout (rail + community tree + chat; two screens on phones). Website and app.
const NEW_SHELL = true;
// Course forums (owner's call, Oct 27 2026): each course opens a forum (posts + threaded comments, like the Degree
// Forum) instead of its class chat. Chats stay in the database; set false to bring them back.
const COURSE_FORUM = true;
// The Degree Forum is hidden (owner's call, Oct 27 2026): the General Forum takes its place. Its posts and code stay.
const DEGREE_FORUM = false;
const FORUM_HOME = DEGREE_FORUM ? "degree-posts" : "general-forum";
// Where "home" is: the feed when posting is on, otherwise your Chats.
const homeTab = (_legacyGuest = false): "social" | "browse-courses" | "your-courses" => POSTS_ENABLED && !NEW_SHELL ? "social" : "your-courses";
type Account = {
  isGuest?: boolean; // "Browse as guest" (migration 048)
  id: string;
  email: string;
  memberSince?: string | null;
  needsPassword: boolean;
  hasPassword?: boolean;
  ageConfirmed: boolean;
  termsAccepted?: boolean; // accepted the current Terms of Service (server: TERMS_VERSION)
  termsVersion?: string;
  isAdmin?: boolean;
  canPost?: boolean; // only the CCConnect team creates feed posts (server: POST_AUTHOR_EMAILS)
  postingBannedUntil?: string | null;
  degreeId?: string | null;
};
type ModPerson = { id?: string; name: string; email: string; postingBannedUntil: string | null };
type ModReport = { id: string; targetType: string; targetId: string; category: string | null; reason: string; evidence: { body?: string; imageUrl?: string | null }; status: string; createdAt: string; reporter: ModPerson | null; reported: ModPerson | null };
const formatBanDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
type Identity = {
  displayName: string;
  program: string;
  studyYear: number | null;
  bio: string;
  interests: string[];
  contactLabel?: string;
  contactValue?: string;
  avatarColor?: number | null;
};
type PostFlair = "question" | "campus" | "event" | "opportunity" | "discussion";
const POST_FLAIRS: { id: PostFlair; label: string; description: string }[] = [
  { id: "question", label: "Question", description: "Asking York students something" },
  { id: "campus", label: "Campus", description: "Updates and info about what's happening around York" },
  { id: "event", label: "Event", description: "Club events, university events, informal meetups" },
  { id: "opportunity", label: "Opportunity", description: "Jobs, competitions, volunteering, workshops, research" },
  { id: "discussion", label: "Discussion", description: "Opinions, experiences, stories, general York conversation" },
];
const flairLabel = (flair: PostFlair) => POST_FLAIRS.find((option) => option.id === flair)?.label || flair;
type Post = {
  locked?: boolean; // a visitor's blurred post: the server sent masked text
  id: string;
  kind: "info" | "community" | "connection";
  degreeId?: string | null;
  courseGroupId?: string | null; // a course's Announcements or Questions (migration 044)
  courseChannel?: "announcements" | "questions" | null;
  courseCode?: string | null; // General Forum: which course the post is from
  flair?: PostFlair | null;
  imageUrls?: string[];
  body: string;
  externalUrl: string | null;
  createdAt: string;
  author: Identity;
  reactionCounts: Record<string, number>;
  commentCount: number;
  myReaction: string | null;
  isMine: boolean;
};
// The Feed (migration 047): York-wide one-line posts and two-option polls, shown full screen one at a time.
type FeedPost = { id: string; body: string; imageUrls: string[]; createdAt: string; isMine: boolean; author: Identity; pollOptions: string[]; pollCounts: number[]; myVote: number | null; likes: number; liked: boolean; commentCount: number; seen: boolean; pinned: boolean };
// The Feed is switched off for now (owner's call, Oct 26 2026): Dev Posts is back on the rail as before. The Feed's
// code and data are kept; set this to true to bring it back.
const FEED_ENABLED = false;
// Dev Posts are hidden too (owner's call, Oct 26 2026): the rail is Degree and Alerts. Posts, comments and routes stay;
// set to true to bring the Dev Posts rail item back.
const DEV_POSTS_ENABLED = false;
const FEED_POST_MAX = 350; // one piece of text, about 3-4 sentences (no title + body)
type PostComment = { id: string; parentCommentId: string | null; body: string; imageUrl?: string | null; createdAt: string; authorName?: string; isMine: boolean; pending?: boolean };
type ActivityPost = { id: string; kind: Post["kind"]; body: string; external_url: string | null; created_at: string };
type ProfileActivity = { posts: ActivityPost[]; comments: { id: string; postId: string; parentCommentId: string | null; post: Omit<ActivityPost, "created_at"> | null; body: string; createdAt: string }[] };
type Room = {
  id: string;
  title: string;
  isGeneral: boolean;
  expiresAt: string | null;
  memberCount: number;
  host: Identity | null;
};
type RoomMessage = {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  author: Identity;
  authorAccountId?: string;
  kind?: "text" | "attachment" | "poll";
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  pollOptions?: string[];
};
type CourseGroup = { id: string; courseCode: string; termName: string; memberCount: number; joined: boolean; unreadCount?: number; forumPosts?: number; lastPostAt?: string | null; instructor?: string | null; isDegree?: boolean; endsOn?: string | null; fullYear?: boolean; pinnedAt?: string[] };
type ReportTarget = { type: "post" | "comment" | "room_message" | "course_message" | "project_message"; id: string; what: string; authorName: string; preview: string };
const REPORT_CATEGORIES: { id: string; label: string; hint: string }[] = [
  { id: "harassment", label: "Harassment or bullying", hint: "Targeting, insulting or threatening someone" },
  { id: "hate", label: "Hate or discrimination", hint: "Attacks based on identity" },
  { id: "sexual", label: "Sexual or explicit content", hint: "Nudity, sexual messages or images" },
  { id: "spam", label: "Spam or scam", hint: "Ads, repeated messages, misleading links" },
  { id: "privacy", label: "Sharing private information", hint: "Someone's personal details, photos or chats" },
  { id: "self_harm", label: "Self-harm or someone in danger", hint: "Content that worries you about someone's safety" },
  { id: "academic", label: "Academic dishonesty", hint: "Selling assignments or sharing exam answers" },
  { id: "other", label: "Something else", hint: "Tell us what's wrong" },
];
// Why a moderator banned someone (shown to them). Same wording as the report reasons, minus "someone in danger".
const BAN_REASONS = REPORT_CATEGORIES.filter((category) => category.id !== "self_harm").map((category) => category.id === "other" ? { ...category, label: "Other" } : category);
type AppNotification = { count?: number; id: string; kind: "post_comment" | "project_invite" | "course_reset" | "chat_message" | "new_post" | "comment_reply" | "public_group" | "course_live" | "course_declined" | "course_post" | "new_course" | "posting_ban" | "join_request"; requesterId?: string; endsOn?: string; bannedUntil?: string; active?: boolean; postId?: string; projectRoomId?: string; courseGroupId?: string; courseCode?: string; postTitle: string; actorName: string; preview: string; createdAt: string; unread: boolean; pending?: boolean };
type ProjectMember = { id: string; name: string; isCreator: boolean };
// Only invite-only groups can be deleted by their creator; public ones belong to the course (the creator can leave).
const canDeleteGroup = (room: { isCreator: boolean; isPublic?: boolean }) => room.isCreator && !room.isPublic;
// Professor groups (public) are named "Prof. " + the professor's full name: first and last, more than 3 letters.
// Same rule as professorGroupName on the server; returns "" until the name is good enough.
const professorName = (typed: string) => {
  const name = typed.replace(/^prof(essor)?\.?\s*/i, "").replace(/\s+/g, " ").trim();
  const letters = (name.match(/\p{L}/gu) || []).length;
  return name.split(" ").length >= 2 && letters > 3 && /^[\p{L}][\p{L}'.-]*( [\p{L}][\p{L}'.-]*)+$/u.test(name) ? `Prof. ${name.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}` : "";
};
type ProjectRoom = { id: string; courseGroupId: string; name: string; isPublic?: boolean; joinRequests?: { id: string; name: string }[]; isCreator: boolean; createdById: string; lastActivityAt: string; expiresAt: string; unreadCount: number; members: ProjectMember[]; pendingInvites?: { id: string; name: string }[] };
type Degree = { id: string; code: string; name: string; faculty: string | null; credentials?: string | null; status?: string };
type DegreeCommunity = Degree & { groupId: string; memberCount: number; unreadCount: number };
type ChatPreview = { body: string; authorName: string; mine: boolean; createdAt: string } | null;
type ProjectMessage = { pending?: boolean; id: string; body: string; attachmentUrl?: string | null; attachmentName?: string | null; isImage?: boolean; createdAt: string; mine: boolean; authorAccountId: string; author: { displayName: string; bio?: string } };
// "Closes in 5 days" once a project room has gone quiet for a while; otherwise how recently it was active.
const projectStatus = (room: ProjectRoom) => {
  const daysLeft = Math.ceil((new Date(room.expiresAt).getTime() - Date.now()) / 86400000);
  return daysLeft <= 7 ? { text: `Closes in ${Math.max(daysLeft, 0)} day${daysLeft === 1 ? "" : "s"} without messages`, warn: true } : { text: `Active ${agoText(room.lastActivityAt)}`, warn: false };
};
// "Closes in 42m" / "Closed" for Rooms, which end 1 hour after they start.
const closesIn = (iso: string) => {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "Closing now";
  return minutes < 60 ? `Closes in ${minutes}m` : `Closes in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const timeAgo = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};
// "5m ago", but "just now" on its own.
const agoText = (iso: string) => { const ago = timeAgo(iso); return ago === "just now" ? ago : `${ago} ago`; };
type CourseTerm = { id: string; name: string; starts_at?: string };
type CourseRequest = { id: string; courseCode: string; instructor?: string | null; termId: string; termName: string; courseGroupId: string | null; status: "pending" | "approved" | "declined"; requesterCount: number; requestedByMe: boolean; createdAt: string; reviewedAt: string | null };
type CourseGroupPost = { pending?: boolean; id: string; replyToId?: string | null; replyTo?: { id: string; name: string | null; body: string | null } | null; kind: "text" | "image" | "attachment" | "poll"; body: string; imageUrl: string | null; attachmentName?: string | null; pollOptions: string[]; pinnedAt: string | null; createdAt?: string; author?: Identity | null; reactionCount: number; reacted: boolean; reactions?: { emoji: string; count: number }[]; myReaction?: string | null; pollVotes: Record<number, number>; myPollVote: number | null; isMine: boolean };
type ChatAttachment = { data: string; name: string; isImage: boolean };

async function request(
  path: string,
  options: RequestInit = {},
  token?: string,
) {
  const send = (signal?: AbortSignal) => fetch(`${API}${path}`, {
    ...options,
    signal: options.signal || signal,
    headers: {
      "Content-Type": "application/json",
      // Lets the server tell this version apart from old open tabs (it ignores "mark read" from those).
      "X-CCConnect-Client": "2",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  // Loads (GET) give up after 12 s and try once more: on phones a request started just as the app/tab comes back
  // from the background can hang forever, which looked like endless loading. Sends and uploads are never retried.
  const isLoad = !options.method || options.method.toUpperCase() === "GET";
  const timed = async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try { return await send(controller.signal); } finally { window.clearTimeout(timer); }
  };
  let response: Response;
  if (!isLoad || options.signal) response = await send();
  else {
    try { response = await timed(); }
    catch (error) { if ((error as Error)?.name !== "AbortError") throw error; response = await timed(); }
  }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: response.status });
  return data;
}

// Soft colour + two initials ("priya.s" -> PS, "jaylee" -> JA); the colour is stable per person.
// Profile colours: [background, initials]. Keep the count in step with AVATAR_COLOR_COUNT in server/src/index.js.
const AVATAR_TONES: [string, string][] = [["#DDF1E4", "#1E6B3E"], ["#ECE4FA", "#5B37A6"], ["#FBEED6", "#8A5A0E"], ["#E3EBFB", "#2A4FA8"], ["#FBE9E3", "#A8341A"], ["#DDF2F1", "#0F6B66"], ["#FBE4EE", "#A42A64"], ["#E8EAF0", "#3D4556"], ["#F3EED9", "#6B5A12"], ["#E6E1F7", "#3F2E8C"]];
// Everyone keeps one colour everywhere: the automatic one comes from the display name (same formula as the
// server's defaultAvatarColor); a colour someone picked in Edit Profile (or kept through a rename) comes from
// /api/avatar-colors, remembered on this device so it shows straight away next time.
// A picked colour is one of the presets above (0-9) or any colour from the colour square, saved as a negative
// number: -1 - (5-bit red, green, blue). Light colours get darker initials in the same colour, dark ones white.
// Same rule as the server's avatar colour check.
const customToneRgb = (tone: number): [number, number, number] | null => {
  if (!(tone < 0 && tone >= -32768)) return null;
  const packed = -1 - tone;
  return [(packed >> 10) & 31, (packed >> 5) & 31, packed & 31].map((part) => Math.round(part * 255 / 31)) as [number, number, number];
};
const toneOfRgb = ([r, g, b]: number[]) => -1 - ((Math.round(r * 31 / 255) << 10) | (Math.round(g * 31 / 255) << 5) | Math.round(b * 31 / 255));
const rgbText = ([r, g, b]: number[]) => `rgb(${r} ${g} ${b})`;
const toneColors = (tone: number): [string, string] => {
  const rgb = customToneRgb(tone);
  if (!rgb) return AVATAR_TONES[tone] || AVATAR_TONES[0];
  const light = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.6;
  return [rgbText(rgb), light ? rgbText(rgb.map((part) => Math.round(part * 0.38))) : "#ffffff"];
};
const toneRgb = (tone: number): number[] => customToneRgb(tone) || [1, 3, 5].map((at) => parseInt((AVATAR_TONES[tone] || AVATAR_TONES[0])[0].slice(at, at + 2), 16));
const rgbToHsv = ([r, g, b]: number[]) => {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255], max = Math.max(rr, gg, bb), d = max - Math.min(rr, gg, bb);
  const h = !d ? 0 : max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
};
const hsvToRgb = ({ h, s, v }: { h: number; s: number; v: number }) => {
  const f = (n: number) => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return [f(5), f(3), f(1)];
};
// Profile colour picker: colour square (saturation left to right, brightness top to bottom), hue bar, a hex box with
// a live dot, and the CCConnect presets for a quick pick. Presets save as 0-9, anything else as a custom colour.
const toHex = (rgb: number[]) => `#${rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
function ColorPicker({ tone, onChange }: { tone: number; onChange: (tone: number) => void }) {
  const [hsv, setHsv] = useState(() => rgbToHsv(toneRgb(tone)));
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const rgb = tone >= 0 && tone < AVATAR_TONES.length ? toneRgb(tone) : hsvToRgb(hsv);
  const update = (next: { h: number; s: number; v: number }) => { setHsv(next); setHexDraft(null); onChange(toneOfRgb(hsvToRgb(next))); };
  const at = (event: ReactPointerEvent<HTMLDivElement>) => { const box = event.currentTarget.getBoundingClientRect(); return [Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))]; };
  const track = (apply: (x: number, y: number) => void) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); const [x, y] = at(event); apply(x, y); },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const [x, y] = at(event); apply(x, y); },
  });
  return (
    <div className="color-picker">
      <div className="color-square" style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }} role="slider" aria-label="Shade" aria-valuenow={Math.round(hsv.s * 100)} {...track((x, y) => update({ ...hsv, s: x, v: 1 - y }))}>
        <span className="color-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: rgbText(hsvToRgb(hsv)) }} />
      </div>
      <div className="color-hue" role="slider" aria-label="Hue" aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.round(hsv.h)} {...track((x) => update({ ...hsv, h: Math.round(x * 359) }))}>
        <span className="color-knob" style={{ left: `${hsv.h / 359 * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="color-hex">
        <span className="color-dot" style={{ background: rgbText(rgb) }} />
        <input aria-label="Hex colour" spellCheck={false} maxLength={7} value={hexDraft ?? toHex(rgb)} onChange={(event) => {
          const value = event.target.value.toUpperCase();
          setHexDraft(value);
          const match = value.replace("#", "").match(/^[0-9A-F]{6}$/);
          if (match) { const next = [0, 2, 4].map((at) => parseInt(match[0].slice(at, at + 2), 16)); setHsv(rgbToHsv(next)); onChange(toneOfRgb(next)); }
        }} onBlur={() => setHexDraft(null)} />
      </div>
      <div className="color-presets" role="radiogroup" aria-label="CCConnect colours">
        {AVATAR_TONES.map(([background, color], index) => <button type="button" key={background} role="radio" aria-checked={tone === index} aria-label={`Preset ${index + 1}`} className={tone === index ? "selected" : ""} style={{ background, color }} onClick={() => { setHsv(rgbToHsv(toneRgb(index))); setHexDraft(null); onChange(index); }} />)}
      </div>
    </div>
  );
}
function defaultTone(name: string) {
  let hash = 0;
  for (const character of name.trim().toLowerCase()) hash = (hash * 31 + (character.codePointAt(0) || 0)) >>> 0;
  return hash % AVATAR_TONES.length;
}
const avatarColors = new Map<string, number>(Object.entries((() => { try { return JSON.parse(localStorage.getItem("mixby-avatar-colors") || "{}"); } catch { return {}; } })()));
const avatarAsked = new Set<string>();
const avatarWaiting = new Set<string>();
const avatarListeners = new Set<() => void>();
let avatarVersion = 0;
let avatarTimer = 0;
function setAvatarColor(name: string, tone: number | null | undefined) {
  if (!name) return;
  if (Number.isInteger(tone)) avatarColors.set(name, tone as number); else avatarColors.delete(name);
  avatarVersion += 1;
  avatarListeners.forEach((listener) => listener());
  try { localStorage.setItem("mixby-avatar-colors", JSON.stringify(Object.fromEntries([...avatarColors].slice(-500)))); } catch { /* ignore */ }
}
function askAvatarColor(name: string) {
  if (!name || avatarAsked.has(name) || import.meta.env.VITE_SCREENSHOTS === "true") return;
  avatarAsked.add(name);
  avatarWaiting.add(name);
  window.clearTimeout(avatarTimer);
  avatarTimer = window.setTimeout(() => {
    const names = [...avatarWaiting];
    avatarWaiting.clear();
    const token = localStorage.getItem("mixby-token") || "";
    if (!token) { names.forEach((name) => avatarAsked.delete(name)); return; } // signed out: automatic colours only
    request("/api/avatar-colors", { method: "POST", body: JSON.stringify({ names }) }, token).then((data) => {
      const colors: Record<string, number> = data.colors || {};
      let changed = false;
      for (const name of names) {
        const tone = Number.isInteger(colors[name]) ? colors[name] : undefined;
        if (avatarColors.get(name) !== tone) { changed = true; if (tone === undefined) avatarColors.delete(name); else avatarColors.set(name, tone); }
      }
      if (changed) { avatarVersion += 1; avatarListeners.forEach((listener) => listener()); }
      try { localStorage.setItem("mixby-avatar-colors", JSON.stringify(Object.fromEntries([...avatarColors].slice(-500)))); } catch { /* ignore */ }
    }).catch(() => { names.forEach((name) => avatarAsked.delete(name)); });
  }, 250);
}
const subscribeAvatars = (listener: () => void) => { avatarListeners.add(listener); return () => { avatarListeners.delete(listener); }; };
const avatarToneOf = (name: string) => avatarColors.get(name) ?? defaultTone(name);
// What this device loaded last time, shown instantly on the next launch while fresh data loads.
// Kept per login (tied to the session token) and cleared on sign-out.
// Course notes (migration 049): private notes under a course, like KakaoTalk's "chat with myself".
type CourseNote = { id: string; courseGroupId: string; name: string; createdAt: string; updatedAt: string };
type NoteEntry = { id: string; body: string; imageUrl: string | null; createdAt: string; pending?: boolean };
type AppSnapshot = { account?: any; identity?: any; groups?: any; requests?: any; posts?: any; chats?: any };
const SNAPSHOT_KEY = "mixby-snapshot";
function readSnapshot(token: string): AppSnapshot | null {
  if (!token || import.meta.env.VITE_SCREENSHOTS === "true") return null;
  try {
    const saved = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    return saved && saved.session === token.slice(-12) ? saved.data : null;
  } catch { return null; }
}
function saveSnapshot(token: string, part: keyof AppSnapshot, data: unknown) {
  if (!token || import.meta.env.VITE_SCREENSHOTS === "true") return;
  try {
    const current = readSnapshot(token) || {};
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ session: token.slice(-12), data: { ...current, [part]: data } }));
  } catch { /* storage full or blocked: just no instant start next time */ }
}
function clearSnapshot() {
  try { localStorage.removeItem(SNAPSHOT_KEY); localStorage.removeItem(CHAT_CACHE_KEY); localStorage.removeItem(FORUM_CACHE_KEY); } catch { /* ignore */ }
}
// Recent messages of your chats, kept on this device so every chat opens instantly, even right after launch
// (fresh messages load behind them). Last 60 per chat, under ~1.5 MB, tied to the login like the snapshot.
type ChatCacheData = { course?: Record<string, CourseGroupPost[]>; project?: Record<string, { projectRoom: ProjectRoom; messages: ProjectMessage[] }>; members?: Record<string, { id: string; name: string }[]> };
const CHAT_CACHE_KEY = "mixby-chat-cache";
// Forums kept on this device (the General Forum and each course's forum, newest 30 posts each), so they show
// instantly, even right after launch, while fresh posts load behind. Tied to the login; cleared on sign-out.
const FORUM_CACHE_KEY = "mixby-forum-cache";
function readForumCache(token: string): Record<string, Post[]> {
  if (!token || import.meta.env.VITE_SCREENSHOTS === "true") return {};
  try { const saved = JSON.parse(localStorage.getItem(FORUM_CACHE_KEY) || "null"); return saved && saved.session === token.slice(-12) ? saved.lists || {} : {}; } catch { return {}; }
}
function saveForumCache(token: string, lists: Record<string, Post[]>) {
  if (!token || import.meta.env.VITE_SCREENSHOTS === "true") return;
  try {
    const kept = Object.fromEntries(Object.entries(lists).slice(-14).map(([key, posts]) => [key, posts.slice(0, 30)]));
    localStorage.setItem(FORUM_CACHE_KEY, JSON.stringify({ session: token.slice(-12), lists: kept }));
  } catch { /* storage full or blocked: forums just load from the network */ }
}
const CHAT_CACHE_KEEP = 60;
function readChatCache(token: string): ChatCacheData {
  if (!token || import.meta.env.VITE_SCREENSHOTS === "true") return {};
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_CACHE_KEY) || "null");
    return saved && saved.session === token.slice(-12) ? saved.data : {};
  } catch { return {}; }
}
function writeChatCache(token: string, data: ChatCacheData) {
  if (!token || import.meta.env.VITE_SCREENSHOTS === "true") return "";
  const text = JSON.stringify({ session: token.slice(-12), data });
  if (text.length > 1_500_000) return text; // too big to keep; next launch just loads normally
  try { localStorage.setItem(CHAT_CACHE_KEY, text); } catch { /* storage full or blocked */ }
  return text;
}

function initialsOf(name?: string) {
  const parts = (name || "Y").trim().split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || "Y").slice(0, 2)).toUpperCase();
}
// Shown instead of the person for anything a team account sends with Dev mode on (server: TEAM_NAME).
const TEAM_NAME = "CCConnect Team";
const TeamBadge = () => <span className="mx-team-badge" title="Official message from the CCConnect team"><BadgeCheck size={12} />Team</span>;
// `seed` is ignored now: the colour always follows the person's name, so it's the same in every list.
function Avatar({ name, large = false, className = "", tone }: { name?: string; large?: boolean; seed?: string; className?: string; tone?: number }) {
  useSyncExternalStore(subscribeAvatars, () => avatarVersion);
  const key = (name || "").trim();
  // Posts and messages sent as the CCConnect team show the CCConnect icon (the name is reserved, so nobody else has it).
  if (key === TEAM_NAME) return <span className={`avatar avatar-team${large ? " avatar-large" : ""}${className ? ` ${className}` : ""}`}><img src="/icon-192.png" alt="" /></span>;
  useEffect(() => { if (key && tone === undefined) askAvatarColor(key); }, [key, tone]);
  const [background, color] = toneColors(tone ?? (key ? avatarToneOf(key) : 0));
  return (
    <span className={`avatar${large ? " avatar-large" : ""}${className ? ` ${className}` : ""}`} style={{ background, color }}>
      {initialsOf(name)}
    </span>
  );
}
type Typer = { accountId: string; name: string };
// Website on phones (Safari, or saved to the Home Screen): lay the page out edge to edge and keep the shell inside
// the safe area (status bar, home bar) and above Safari's toolbar; see "Website safe area" in shell.css.
// The iOS app keeps its own native safe-area handling, so it's left alone.
// The iOS app needs viewport-fit=cover too: its shell runs under the home indicator (see "App: edge to edge" in shell.css).
if (typeof document !== "undefined") {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport && !/viewport-fit/.test(viewport.getAttribute("content") || "")) viewport.setAttribute("content", `${viewport.getAttribute("content")}, viewport-fit=cover`);
  if (!isNativeApp) document.documentElement.classList.add("web-safe-area");
}
// Phones and tablets (no mouse): long-press opens the message menu, and message text isn't selectable.
const touchScreen = typeof window !== "undefined" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
if (touchScreen && typeof document !== "undefined") document.documentElement.classList.add("touch-screen");
const MAX_POST_IMAGES = 6;
// Courses a guest added, kept on this device only. The key exists only while a guest is signed in.
const GUEST_COURSES_KEY = "mixby-guest-courses";
const VISITOR_KEY = "mixby-visitor"; // a visitor's login + recently visited, put aside while they sign up or log in
const guestCourseIds = (): Set<string> | null => { try { const raw = localStorage.getItem(GUEST_COURSES_KEY); return raw === null ? null : new Set(JSON.parse(raw) as string[]); } catch { return null; } };
const saveGuestCourses = (ids: Set<string>) => { try { localStorage.setItem(GUEST_COURSES_KEY, JSON.stringify([...ids])); } catch { /* storage full or blocked */ } };
// Many live events can ask for the same reload at once (every message, post or vote): while one is running, further
// calls share it and trigger just one more run afterwards, instead of piling up requests on the server.
function coalesce<T>(run: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  let again = false;
  const call = (): Promise<T> => {
    if (running) { again = true; return running; }
    running = run().finally(() => { running = null; if (again) { again = false; call().catch(() => {}); } });
    return running;
  };
  return call;
}
// York's course list (code + title), from York's public course calendar via the SSADC Yoki scraper (Jan 2025 data).
// Loaded once, when Add a course opens; ships with the website and the app (public/york-courses.json).
type CatalogCourse = [code: string, title: string];
let catalogLoad: Promise<CatalogCourse[]> | null = null;
const loadCourseCatalog = () => (catalogLoad ||= fetch("/york-courses.json").then((response) => response.ok ? response.json() : []).catch(() => { catalogLoad = null; return []; }));
// The focus ring only shows after Tab: browsers also turn it on when any key is pressed after a click, which outlined
// the course row you'd just clicked as soon as you typed a letter.
if (typeof window !== "undefined") {
  // Saved mode, before the first paint, so dark mode never flashes white while loading.
  try {
    const savedTheme = localStorage.getItem("mixby-theme");
    if (savedTheme === "dark" || (savedTheme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("theme-dark");
  } catch { /* private mode */ }
  window.addEventListener("keydown", (event) => { if (event.key === "Tab") document.documentElement.classList.add("tab-nav"); }, true);
  window.addEventListener("pointerdown", () => document.documentElement.classList.remove("tab-nav"), true);
}
const TYPING_IDLE_MS = 4000;
const capCount = (count?: number) => (count || 0) > 99 ? "99+" : String(count || 0); // unread badges stop at 99+
// Longest message, comment or post body (same as the server's TEXT_MAX). The box shows a counter near it and won't
// send past it, so a message never leaves the box only to be refused.
const MESSAGE_MAX = 20000;
const tooLong = (text: string) => text.length > MESSAGE_MAX;
function LengthNote({ text }: { text: string }) {
  if (text.length < MESSAGE_MAX * 0.9) return null;
  const over = text.length - MESSAGE_MAX;
  return <span className={over > 0 ? "mx-length over" : "mx-length"} role={over > 0 ? "alert" : undefined}>{over > 0 ? `${over.toLocaleString()} character${over === 1 ? "" : "s"} too long` : `${text.length.toLocaleString()} / ${MESSAGE_MAX.toLocaleString()}`}</span>;
} // stop showing "typing" this long after the last keystroke
// Images keep their own shape (like Reddit): the post's height follows the image, very tall images are
// shown whole up to a max height, and any empty space is filled with a blurred copy of the image.
// onOpen: in a list, tapping a photo opens its post (the arrows still just change photo; swiping never opens).
function ImageCarousel({ images, className = "", onOpen }: { images: string[]; className?: string; onOpen?: () => void }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  // Height-to-width ratio of the first image; it sets the height of the whole post's image area.
  const [ratio, setRatio] = useState<number | null>(null);
  const measure = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth) setRatio(image.naturalHeight / image.naturalWidth);
  };
  const frameStyle = { "--ratio": ratio ?? 0.75 } as CSSProperties;
  if (images.length === 1) {
    return (
      <div className={`post-single-image ${className}${onOpen ? " opens-post" : ""}`} style={frameStyle} onClick={onOpen}>
        <div className="image-frame" style={{ "--img": `url("${images[0]}")` } as CSSProperties}><img src={images[0]} alt="" loading="lazy" onLoad={measure} /></div>
      </div>
    );
  }
  const go = (next: number) => {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.max(0, Math.min(images.length - 1, next));
    track.scrollTo({ left: target * track.clientWidth, behavior: "smooth" });
  };
  return (
    // Several images: the whole carousel is for browsing, so clicks inside it never open the post.
    <div className={`image-carousel ${className}`} style={frameStyle} onClick={(event) => event.stopPropagation()}>
      <div className="image-carousel-track" ref={trackRef} onScroll={(event) => setIndex(Math.round(event.currentTarget.scrollLeft / Math.max(1, event.currentTarget.clientWidth)))}>
        {images.map((src, imageIndex) => <div className={`image-carousel-slide image-frame${onOpen ? " opens-post" : ""}`} onClick={onOpen} key={src} style={{ "--img": `url("${src}")` } as CSSProperties}><img src={src} alt={`Image ${imageIndex + 1} of ${images.length}`} loading={imageIndex === 0 ? "eager" : "lazy"} draggable={false} onLoad={imageIndex === 0 ? measure : undefined} /></div>)}
      </div>
      {index > 0 && <button type="button" className="image-carousel-arrow prev" aria-label="Previous image" onClick={() => go(index - 1)}><ChevronLeft size={22} /></button>}
      {index < images.length - 1 && <button type="button" className="image-carousel-arrow next" aria-label="Next image" onClick={() => go(index + 1)}><ChevronRight size={22} /></button>}
      <span className="image-carousel-count">{index + 1}/{images.length}</span>
      <div className="image-carousel-dots" aria-hidden="true">{images.map((src, dot) => <span key={src} className={dot === index ? "active" : ""} />)}</div>
    </div>
  );
}
// Opens when you click someone's avatar or name in a Room or course chat.
// "Continue with Google": Google's own button on the website, the native Google sheet in the iOS app.
// ===== Website homepage (logged-out visitors on ccconnect.app; never in the app) =====
// Degree search is the main interaction: picking a degree and pressing Join carries it through sign-up
// (localStorage "mixby-pending-degree"), and the new account lands straight in that degree's Forum.
// No member counts or activity numbers here on purpose (owner's call while CCConnect is new).
const PENDING_DEGREE_KEY = "mixby-pending-degree";
function readPendingDegree(): Degree | null {
  try { const saved = JSON.parse(localStorage.getItem(PENDING_DEGREE_KEY) || "null"); return saved?.id && saved?.name ? saved : null; } catch { return null; }
}
function savePendingDegree(degree: Degree | null) {
  try { if (degree) localStorage.setItem(PENDING_DEGREE_KEY, JSON.stringify(degree)); else localStorage.removeItem(PENDING_DEGREE_KEY); } catch { /* ignore */ }
}
const FLOATING_DEGREES = ["Cognitive Science", "Film Production", "Space Engineering", "Biomedical Science", "Linguistics", "Finance", "Theatre", "Data Science"];
// How to add CCConnect to the Home Screen. iPhone and iPad have no install prompt for websites, so these are Safari's
// own steps; Android and desktop browsers usually show their own prompt instead (see promptInstall).
function InstallHelp({ onClose }: { onClose: () => void }) {
  return createPortal(
        // How to install: iPhone and iPad have no install prompt, so these are Safari's own steps.
        <div className="block-backdrop" onClick={onClose}>
          <section className="block-sheet mx-install-sheet" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}>
            <span className="block-grabber" aria-hidden="true" />
            <h2 id="install-title">Add CCConnect to your Home Screen</h2>
            {isIOS() ? (
              <ol className="mx-install-steps">
                <li><span>1</span><p>In Safari, tap the <strong>Share</strong> button <i className="mx-step-icon" aria-label="Share button"><ShareIcon size={15} /></i> (the box with an arrow pointing up).</p></li>
                <li><span>2</span><p>Tap <strong>View More</strong> to see all the options.</p></li>
                <li><span>3</span><p>Tap <strong>Add to Home Screen</strong> <i className="mx-step-icon" aria-hidden="true"><SquarePlus size={15} /></i>.</p></li>
                <li><span>4</span><p>Make sure <strong>Open as Web App</strong> is on <i className="mx-step-icon on" aria-hidden="true"><ToggleRight size={17} /></i>.</p></li>
                <li><span>5</span><p>Tap <strong>Add</strong> (top right).</p></li>
                <li><span>6</span><p>Open <strong>CCConnect</strong> from your Home Screen and sign in.</p></li>
              </ol>
            ) : (
              <ol className="mx-install-steps">
                <li><span>1</span><p>Open the browser menu <strong>⋮</strong>.</p></li>
                <li><span>2</span><p>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p></li>
                <li><span>3</span><p>Open <strong>CCConnect</strong> from your Home Screen.</p></li>
              </ol>
            )}
            <button type="button" className="block-cancel" onClick={onClose}>Got it</button>
          </section>
        </div>,
    document.body,
  );
}
function Landing({ onLogin, onJoin, onInstall, onGuest }: { onLogin: () => void; onJoin: (degree: Degree | null) => void; onInstall: () => void; onGuest: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  // Scroll-in reveals for the sections below the fold.
  useEffect(() => {
    const root = page.current;
    if (!root || typeof IntersectionObserver === "undefined") { root?.querySelectorAll(".lp-reveal").forEach((node) => node.classList.add("in")); return; }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("in"); observer.unobserve(entry.target); } }), { root, threshold: 0.15 });
    root.querySelectorAll(".lp-reveal").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return (
    <div className="lp" ref={page} onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 8)}>
      <header className={`lp-nav${scrolled ? " scrolled" : ""}`}>
        <a className="lp-logo" href="/" onClick={(event) => { event.preventDefault(); page.current?.scrollTo({ top: 0, behavior: "smooth" }); }}>ccconnect<span>.</span></a>
        <nav>
          <button type="button" className="lp-nav-signup" onClick={() => onJoin(null)}>Sign up</button>
          <button type="button" className="lp-nav-login" onClick={onLogin}>Log in</button>
        </nav>
      </header>

      <section className="lp-hero">
        <div className="lp-glow" aria-hidden="true" />
        <div className="lp-floaters" aria-hidden="true">
          {FLOATING_DEGREES.map((name, index) => <span key={name} className={`lp-floater f${index}`}><GraduationCap size={14} />{name}</span>)}
        </div>
        <p className="lp-eyebrow"><span className="lp-dot" />Launching at York University</p>
        <h1>Your academic <em>community</em> starts here.</h1>
        <p className="lp-lede">Find your degree community, connect with classmates, and make university a little less disconnected.</p>

        {/* The degree search card was replaced by one button (owner's call, Oct 2026); Sign up / Log in are in the top bar. */}
        <div className="lp-guest-wrap">
          <button type="button" className="lp-guest lp-guest-big" onClick={onGuest}><span>Continue as guest</span><ArrowRight size={22} strokeWidth={2.6} /></button>
          <p className="lp-guest-note">No sign-up needed · look around in one tap</p>
          {/* Phones (not already installed): add CCConnect to the Home Screen while the App Store app is on its way. */}
          {touchScreen && !isStandalone() && <button type="button" className="lp-install" onClick={onInstall}><Smartphone size={16} />Add CCConnect to your Home Screen</button>}
        </div>
      </section>

      <section className="lp-section lp-product-section">
        <div className="lp-product-copy lp-reveal">
          <p className="lp-kicker">One place to belong</p>
          <h2>Your degree, courses, and project people — in one calm workspace.</h2>
          <p className="lp-product-lede">CCConnect starts with the community you keep through university, then gives every course and assignment group its own place to talk.</p>
          <div className="lp-product-points">
            <article><span><Newspaper size={18} /></span><div><h3>Degree Forum</h3><p>Ask your program about electives, professors, placements, and the things nobody puts in a syllabus.</p></div></article>
            <article><span><Hash size={18} /></span><div><h3>Course chats</h3><p>One focused chat per course and professor, refreshed every term with the people actually in your class.</p></div></article>
            <article><span><FolderKanban size={18} /></span><div><h3>Mini project groups</h3><p>Make a private assignment room or open a public study group when you need a smaller circle.</p></div></article>
          </div>
        </div>
        <div className="lp-workspace lp-reveal" aria-label="A preview of the CCConnect workspace">
          <div className="lp-workspace-window" aria-hidden="true">
            <aside className="lp-workspace-rail"><span className="lp-workspace-wordmark">ccconnect<span>.</span></span><i><Newspaper size={15} /></i><i className="active"><GraduationCap size={16} /></i><i><Bell size={15} /></i></aside>
            <aside className="lp-workspace-tree">
              <div className="lp-workspace-banner"><span>Entrepreneurship<br />&amp; Innovation</span><small>BCom · 3 students</small><MoreVertical size={15} /></div>
              <strong className="lp-workspace-forum"><Newspaper size={15} />Degree Forum</strong>
              <div className="lp-workspace-tree-label">MY COURSES <Plus size={14} /></div>
              <div className="lp-workspace-course"><b>⌄ &nbsp;ENTR 1700</b><span>· Prof. CCConnect</span></div>
              <div className="lp-workspace-channel"><Hash size={14} />class-chat</div>
              <div className="lp-workspace-channel"><Lock size={13} />Lab 3</div>
              <div className="lp-workspace-channel"><Users size={14} />Pitch team</div>
              <div className="lp-workspace-course"><b>⌄ &nbsp;CHEM 1000</b></div>
              <div className="lp-workspace-channel"><Hash size={14} />class-chat</div>
            </aside>
            <main className="lp-workspace-main">
              <header><h3>Degree Forum</h3><button><Plus size={13} /><span>New post</span></button></header>
              <div className="lp-workspace-feed">
                <article><div className="lp-workspace-author"><b>MT</b><strong>ccconnect student</strong><span>· 2d</span></div><h4>Is ENTR 1700 worth taking in first year?</h4><p>Thinking of taking it alongside ADMS 1000. Any professor recommendations?</p><footer>◯&nbsp; 4 &nbsp;&nbsp; ↗ Share</footer></article>
                <article><div className="lp-workspace-author"><b>JL</b><strong>Jordan Lee</strong><span>· 4d</span></div><h4>Anyone want to start a midterm study group?</h4><p>Tuesdays at 6pm — bring notes, I’ll bring snacks.</p><footer>◯&nbsp; 1 &nbsp;&nbsp; ↗ Share</footer></article>
                <article className="lp-workspace-teaser"><div className="lp-workspace-author"><b>AN</b><strong>Alex Nguyen</strong><span>· 5d</span></div><h4>Summer internship resources</h4></article>
              </div>
            </main>
          </div>
        </div>
      </section>

      <section className="lp-section lp-steps-wrap">
        <div className="lp-section-head lp-reveal">
          <p className="lp-kicker">How it works</p>
          <h2>From search to your community in a minute.</h2>
        </div>
        <ol className="lp-steps">
          <li className="lp-reveal"><span>1</span><h3>Find your degree</h3><p>York is CCConnect's launch campus. More university communities are planned next.</p></li>
          <li className="lp-reveal"><span>2</span><h3>Verify you're at York</h3><p>Use your York Google account, or a 6-digit code sent to your York email.</p></li>
          <li className="lp-reveal"><span>3</span><h3>Land in your community</h3><p>You go straight to your Degree Forum. No searching twice.</p></li>
        </ol>
      </section>

      <section className="lp-section">
        <div className="lp-trust lp-reveal">
          <div><BadgeCheck size={22} /><h3>Built campus by campus</h3><p>CCConnect starts at York, with more universities planned.</p></div>
          <div><Flag size={22} /><h3>Report and block anything</h3><p>Every post, comment and message. Moderators review every report.</p></div>
          <div><Trash2 size={22} /><h3>Leave whenever you like</h3><p>Deleting your account removes your posts, messages and files.</p></div>
        </div>
      </section>

      <section className="lp-cta lp-reveal">
        <img src="/campus.svg" alt="" aria-hidden="true" />
        <div>
          <h2>Make university a little less disconnected.</h2>
          <p>Your degree community is one search away.</p>
          <button type="button" className="lp-join light" onClick={() => onJoin(null)}>Join CCConnect<ArrowRight size={18} /></button>
        </div>
      </section>

      <footer className="lp-footer">
        <span className="lp-logo">ccconnect<span>.</span></span>
        <p>An independent student project, launching at York University. Not affiliated with or endorsed by York.</p>
        <nav>
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
          <a href="#">Contact</a>
          <button type="button" onClick={onLogin}>Log in</button>
        </nav>
      </footer>
    </div>
  );
}

function GoogleButton({ onIdToken, onError }: { onIdToken: (idToken: string) => void; onError: (message: string) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const callback = useRef(onIdToken);
  callback.current = onIdToken;
  useEffect(() => {
    if (isNativeApp || !holder.current) return;
    const render = () => {
      const google = (window as unknown as { google?: any }).google;
      if (!google || !holder.current) return;
      google.accounts.id.initialize({ client_id: GOOGLE_WEB_CLIENT_ID, hd: "my.yorku.ca", callback: (response: { credential: string }) => callback.current(response.credential) });
      holder.current.replaceChildren(); // never two buttons if this runs twice
      google.accounts.id.renderButton(holder.current, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: Math.min(holder.current.offsetWidth || 320, 400) });
    };
    let script = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      document.head.appendChild(script);
    }
    if ((window as unknown as { google?: unknown }).google) render();
    else script.addEventListener("load", render);
    return () => script?.removeEventListener("load", render);
  }, []);
  if (isNativeApp) return (
    <button type="button" className="google-button" onClick={() => GoogleAuth.signIn({ clientId: GOOGLE_IOS_CLIENT_ID, serverClientId: GOOGLE_WEB_CLIENT_ID, hostedDomain: "my.yorku.ca" }).then(({ idToken }) => onIdToken(idToken)).catch((error: { code?: string; message?: string }) => { if (error?.code !== "CANCELED") onError(error?.message || "Google sign-in failed."); })}>
      <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Continue with Google
    </button>
  );
  // Our own button so it matches the page; Google's real one sits on top, almost invisible, and takes the click.
  return <div className="google-button google-button-over"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Continue with Google</span><div className="google-button-web" ref={holder} /></div>;
}

// A course's QR code: scanning it opens ccconnect.app with that course chat (see the ?course= link handling in App).
const courseLink = (groupId: string) => `https://www.ccconnect.app/?course=${groupId}`;
const postLink = (postId: string) => `https://www.ccconnect.app/?post=${postId}`;
function CourseQr({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(url, { width: 640, margin: 1, color: { dark: "#19211d", light: "#ffffff" } }).then(setSrc).catch(() => setSrc("")); }, [url]);
  return src ? <img className="course-qr-image" src={src} alt="QR code for this course" /> : <div className="course-qr-image" aria-hidden="true" />;
}

const MESSAGE_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const QUICK_REACTIONS = MESSAGE_EMOJIS.slice(0, 3); // website hover toolbar
// Post photos are shrunk before upload: at most 2048px on the long side, JPEG at 85% (GIFs stay as they are so they
// keep moving). Sharp at every size CCConnect shows them, and a 12 MP phone photo goes from ~5 MB to a few hundred KB.
const POST_IMAGE_MAX_SIDE = 2048;
// A note photo still on this device (not uploaded yet, or from when note photos never left the phone). notesync.ts
const uploadedNotePhotos = new Map<string, string>(); // just-uploaded note photos, shown from memory
function DevicePhoto({ id, onOpen, onLoad }: { id: string; onOpen: (src: string) => void; onLoad?: () => void }) {
  const [src, setSrc] = useState<string | null | undefined>(() => cachedPhoto(id));
  useEffect(() => {
    if (src !== undefined) return;
    let live = true;
    loadPhoto(id).then((found) => { if (live) setSrc(found); }).catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [id, src]);
  if (src === undefined) return <span className="mx-note-photo-wait" />;
  if (src === null) return <span className="mx-note-photo-gone"><Smartphone size={18} aria-hidden="true" />Photo saved on another device</span>;
  return <img src={src} alt="" onClick={() => onOpen(src)} onLoad={onLoad} />;
}
const shrinkImage = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Couldn't read that image."));
  reader.onload = () => {
    const original = String(reader.result);
    if (file.type === "image/gif") { resolve(original); return; }
    const image = new Image();
    image.onerror = () => resolve(original);
    image.onload = () => {
      const scale = Math.min(1, POST_IMAGE_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      if (scale === 1 && file.size <= 1.5 * 1024 * 1024) { resolve(original); return; }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) { resolve(original); return; }
      context.fillStyle = "#ffffff"; // transparent PNGs get a white background instead of black
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.src = original;
  };
  reader.readAsDataURL(file);
});
// Degree Forum posts: the body (not the title) can be at most this many words; the server checks it too.
const DEGREE_POST_MAX_WORDS = 1000;
const countWords = (text: string) => (text.trim().match(/\S+/g) || []).length;
// Text boxes that grow with what's typed instead of scrolling inside themselves.
const growBox = (box: HTMLTextAreaElement | null) => { if (!box) return; box.style.height = "auto"; box.style.height = `${box.scrollHeight}px`; };
// Full picker for "+" in the message menu; the iPhone emoji keyboard covers anything not listed.
const EMOJI_GROUPS: [string, string][] = [
  ["Smileys", "😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😋😛😜🤪😝🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😮‍💨🤥😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈💀💩🤡👻👽🤖"],
  ["Gestures", "👋🤚✋🖖👌🤌🤏✌️🤞🫶🤟🤘🤙👈👉👆👇☝️👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏💪🧠👀👁️👅👄"],
  ["Hearts", "❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💯💢💥💫💦💨🔥✨⭐🌟"],
  ["Animals", "🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦉🐺🐴🦄🐝🦋🐌🐞🐢🐍🐙🦀🐠🐬🐳🦈🐊🦒🐘🦔🌸🌹🌻🌈☀️🌙❄️☔"],
  ["Food", "🍏🍎🍌🍉🍇🍓🍒🍑🥭🍍🥥🥑🍆🥕🌽🌶️🥐🍞🧀🥚🍳🥓🍔🍟🍕🌭🥪🌮🌯🍜🍝🍣🍱🍙🍚🍦🍩🍪🎂🍰🧁🍫🍬🍭☕🧋🍵🥤🍺🍻🥂🍷"],
  ["Activities", "⚽🏀🏈⚾🎾🏐🏉🎱🏓🏸🥅🏒⛳🏹🎣🥊🎽🛹⛸️🏆🥇🥈🥉🏅🎉🎊🎈🎁🎮🎲🎯🎳🎨🎬🎤🎧🎵🎶🎸🎹🥁"],
  ["Objects", "📚📖✏️📝📌📎✂️📅📆🗓️⏰⌛💻⌨️🖥️📱☎️📷🎥💡🔋🔌💰💳🎓🏫🧪🔬🔭💊🩺🚗🚌🚇✈️🚀🏠🏢🗺️⛺"],
  ["Symbols", "✅☑️✔️❌❎➕➖➗❓❗‼️⁉️⚠️🚫⛔💤🆗🆒🆕🆙🔝🔜🎯♻️⚡💲🔴🟠🟡🟢🔵🟣⚫⚪"],
];
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const splitEmoji = (text: string) => segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : [...text];
const singleEmoji = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*(?:\u200D\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*)*)$/u;
// Press-and-hold menu for a course chat message (iOS app): emoji row (+ full picker), then Delete (yours) or Report (theirs).
function MessageMenu({ post, canModerate, reactions = true, anchor, onReact, onReply, onDelete, onReport, onBlock, onBan, onClose }: { post: CourseGroupPost; canModerate?: boolean; reactions?: boolean; anchor?: DOMRect | null; onReact: (emoji: string) => void; onReply?: () => void; onDelete: () => void; onReport: () => void; onBlock: () => void; onBan?: () => void; onClose: () => void }) {
  const [picking, setPicking] = useState(false);
  // Website (mouse): ⋯ on the hover toolbar opens just the actions as a small dropdown beside it, Discord-style.
  if (anchor) {
    const width = 220, height = 230;
    const style: CSSProperties = { left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)), top: anchor.bottom + 6 + height <= window.innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - 6 - height) };
    return createPortal(
      <div className="mx-pop-layer" onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }}>
        <div className="mx-msg-dropdown" style={style} role="menu" aria-label="Message options" onClick={(event) => event.stopPropagation()}>
          {onReply && <button type="button" onClick={onReply}><ReplyIcon size={17} />Reply</button>}
          {post.body && <button type="button" onClick={() => { navigator.clipboard?.writeText(post.body).catch(() => {}); onClose(); }}><Copy size={17} />Copy text</button>}
          {post.isMine ? <button type="button" className="risky" onClick={onDelete}><Trash2 size={17} />Delete message</button> : <>
            <button type="button" className="risky" onClick={onReport}><Flag size={17} />Report</button>
            <button type="button" className="risky" onClick={onBlock}><Ban size={17} />Block</button>
            {canModerate && <button type="button" className="risky" onClick={onDelete}><Trash2 size={17} />Delete (moderator)</button>}
            {canModerate && onBan && <button type="button" className="risky" onClick={onBan}><ShieldCheck size={17} />Ban from posting</button>}
          </>}
        </div>
      </div>,
      document.body,
    );
  }
  const quick = post.myReaction && !MESSAGE_EMOJIS.includes(post.myReaction) ? [...MESSAGE_EMOJIS.slice(0, 5), post.myReaction] : MESSAGE_EMOJIS;
  return createPortal(
    <div className="message-menu-backdrop" onClick={onClose}>
      <div className={picking ? "message-menu picking" : "message-menu"} role="dialog" aria-label="Message options" onClick={(event) => event.stopPropagation()}>
        {picking ? <>
          <header className="emoji-picker-head">
            <button type="button" onClick={() => setPicking(false)}>Back</button>
            <input aria-label="Type an emoji" placeholder="Type any emoji" onInput={(event) => { const picked = splitEmoji(event.currentTarget.value).filter((part) => singleEmoji.test(part)).pop(); if (picked) onReact(picked); }} />
          </header>
          <div className="emoji-picker-grid">
            {EMOJI_GROUPS.map(([name, emojis]) => (
              <section key={name}>
                <h3>{name}</h3>
                <div>{splitEmoji(emojis).map((emoji) => <button type="button" key={emoji} className={post.myReaction === emoji ? "picked" : ""} onClick={() => onReact(emoji)}>{emoji}</button>)}</div>
              </section>
            ))}
          </div>
        </> : <>
          {reactions && <div className="message-menu-emojis">
            {quick.map((emoji) => <button type="button" key={emoji} className={post.myReaction === emoji ? "picked" : ""} aria-label={`React ${emoji}`} onClick={() => onReact(emoji)}>{emoji}</button>)}
            <button type="button" className="message-menu-more" aria-label="More emoji" onClick={() => setPicking(true)}><Plus size={22} /></button>
          </div>}
          <p className={post.isMine ? "message-menu-preview mine" : "message-menu-preview"}>{post.body || post.attachmentName || "Attachment"}</p>
          <div className="message-menu-actions">
            {onReply && <button type="button" onClick={onReply}><ReplyIcon size={18} />Reply</button>}
            {post.body && <button type="button" onClick={() => { navigator.clipboard?.writeText(post.body).catch(() => {}); onClose(); }}><Copy size={18} />Copy</button>}
            {post.isMine ? <>
              <button type="button" className="danger-item" onClick={onDelete}><Trash2 size={18} />Delete</button>
            </> : <>
              <button type="button" className="danger-item" onClick={onReport}><Flag size={18} />Report</button>
              <button type="button" className="danger-item" onClick={onBlock}><Ban size={18} />Block</button>
              {canModerate && <button type="button" className="danger-item" onClick={onDelete}><Trash2 size={18} />Delete (moderator)</button>}
              {canModerate && onBan && <button type="button" className="danger-item" onClick={onBan}><ShieldCheck size={18} />Ban from posting</button>}
            </>}
          </div>
        </>}
      </div>
    </div>,
    document.body,
  );
}

// Website: the hover toolbar's smiley opens the full emoji picker as a small panel beside the message.
function EmojiPopover({ anchor, picked, onPick, onClose }: { anchor: DOMRect; picked?: string | null; onPick: (emoji: string) => void; onClose: () => void }) {
  const width = Math.min(340, window.innerWidth - 16), height = Math.min(380, window.innerHeight - 16);
  const style: CSSProperties = { width, height, left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)), top: anchor.bottom + 6 + height <= window.innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - 6 - height) };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="mx-pop-layer" onClick={onClose}>
      <div className="mx-react-pop" style={style} role="dialog" aria-label="Add reaction" onClick={(event) => event.stopPropagation()}>
        <input autoFocus aria-label="Type an emoji" placeholder="Type or paste any emoji" onInput={(event) => { const emoji = splitEmoji(event.currentTarget.value).filter((part) => singleEmoji.test(part)).pop(); if (emoji) onPick(emoji); }} />
        <div className="emoji-picker-grid">
          {EMOJI_GROUPS.map(([name, emojis]) => (
            <section key={name}>
              <h3>{name}</h3>
              <div>{splitEmoji(emojis).map((emoji) => <button type="button" key={emoji} className={picked === emoji ? "picked" : ""} onClick={() => onPick(emoji)}>{emoji}</button>)}</div>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SenderConsole({ anchor, name, seed, bio, allowVoteMute = false, onReport, onBlock, onBan, onClose }: { anchor: DOMRect | null; name: string; seed: string; bio?: string; allowVoteMute?: boolean; onReport: () => void; onBlock: () => void; onBan?: () => void; onClose: () => void }) {
  // Fixed to the window (so a scrolling chat can't clip it): below the avatar, or above if there's no room.
  const width = 260, height = 250, gap = 8;
  const position: CSSProperties = anchor ? {
    left: Math.min(Math.max(gap, anchor.left), window.innerWidth - width - gap),
    top: anchor.bottom + gap + height <= window.innerHeight ? anchor.bottom + gap : Math.max(gap, anchor.top - gap - height),
  } : {};
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Touches on the card or its layer stay here: React would otherwise pass them up to the chat underneath, whose
  // swipe-back gesture then dragged the whole chat sideways while the card was open.
  const stopTouches = { onTouchStart: (event: ReactTouchEvent) => event.stopPropagation(), onTouchMove: (event: ReactTouchEvent) => event.stopPropagation(), onTouchEnd: (event: ReactTouchEvent) => event.stopPropagation() };
  // Rendered into <body> so chat-message styles never leak into it. While it's open, an invisible layer covers the
  // screen: the chat behind can't be scrolled, and tapping anywhere outside the card closes it.
  return createPortal(
    <>
    <div className="sender-console-backdrop" aria-hidden="true" onClick={(event) => { event.stopPropagation(); onClose(); }} onMouseDown={(event) => event.stopPropagation()} {...stopTouches} onContextMenu={(event) => { event.preventDefault(); onClose(); }} />
    <div className="sender-console" style={position} role="dialog" aria-label={`${name}'s profile`} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} {...stopTouches}>
      <header>
        <Avatar name={name} seed={seed} className="sender-console-avatar" />
        <div><strong>{name}</strong>{bio && <p>{bio}</p>}</div>
      </header>
      <div className="sender-console-actions">
        <button type="button" className="report-action" onClick={onReport}><Flag size={16} /><span>Report</span></button>
        <button type="button" className="report-action" onClick={onBlock}><Ban size={16} /><span>Block</span></button>
        {onBan && <button type="button" className="report-action" onClick={onBan}><ShieldCheck size={16} /><span>Ban from posting</span></button>}
        {allowVoteMute && <button type="button" disabled title="Coming soon"><MicOff size={16} /><span>Vote mute</span><em>Soon</em></button>}
      </div>
    </div>
    </>,
    document.body,
  );
}
// The Terms of Service / Privacy Policy, loaded from the same pages as ccconnect.app/terms.html and /privacy.html
// (bundled with the app too), so there's one copy of each document. onReadToEnd fires once scrolled to the bottom.
function LegalDoc({ page, onReadToEnd, className = "" }: { page: "terms" | "privacy"; onReadToEnd?: () => void; className?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    setHtml(null);
    fetch(`/${page}.html`).then((response) => response.text()).then((text) => {
      if (!alive) return;
      const doc = new DOMParser().parseFromString(text, "text/html");
      doc.querySelector(".brand")?.remove();
      setHtml(doc.querySelector("main")?.innerHTML || "");
    }).catch(() => { if (alive) setHtml(""); });
    return () => { alive = false; };
  }, [page]);
  const check = () => { const el = box.current; if (el && html && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) onReadToEnd?.(); };
  useEffect(check, [html]);
  return (
    <div ref={box} className={`legal-doc ${className}`} onScroll={check}>
      {html === null ? <p className="legal-loading">Loading…</p> : html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <p>Couldn't load this. Read it at <a href={`https://www.ccconnect.app/${page}.html`} target="_blank" rel="noreferrer">ccconnect.app/{page}.html</a>.</p>}
    </div>
  );
}
// The post shown above its comments sheet: drawn at a fixed card width, then scaled so it fits the space exactly:
// a tall post (big photos) shrinks, a short one (a title) is enlarged. Re-measured as photos load or the screen turns.
function PostPreview({ post }: { post: Post }) {
  const box = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      if (!box.current || !card.current) return;
      const room = box.current.getBoundingClientRect();
      const width = card.current.offsetWidth, height = card.current.offsetHeight;
      if (!width || !height) return;
      setScale(Math.max(0.25, Math.min(2.2, (room.width * 0.92) / width, (room.height * 0.88) / height)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (box.current) observer.observe(box.current);
    if (card.current) observer.observe(card.current);
    return () => observer.disconnect();
  }, [post.id]);
  const title = post.body.split("\n\n")[0];
  return (
    <div className="mx-preview-box" ref={box}>
      <div className="mx-preview-card" ref={card} style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <span className="mx-post-meta"><Avatar name={post.author.displayName || "CCConnect"} /><strong>{post.author.displayName || "CCConnect"}</strong>{post.author.displayName === TEAM_NAME && <TeamBadge />}<span aria-hidden="true">·</span><time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time></span>
        <strong className="mx-post-title">{title}</strong>
        {(post.imageUrls?.length || 0) > 0 && <ImageCarousel images={post.imageUrls || []} className="mx-post-images" />}
      </div>
    </div>
  );
}

function LinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const href = match[2] || match[3];
    parts.push(<a key={index} href={href} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>{match[1] || match[3]}</a>);
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
const chatDayLabel = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};
const chatTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
type ChatMessageMeta = { createdAt?: string; mine: boolean; author: string };
// Starts a new day section, or collapses into the previous message when the same person sent it within 5 minutes.
const chatMessageFlags = (previous: ChatMessageMeta | undefined, current: ChatMessageMeta) => {
  const newDay = Boolean(current.createdAt && (!previous?.createdAt || new Date(previous.createdAt).toDateString() !== new Date(current.createdAt).toDateString()));
  const grouped = Boolean(previous && !newDay && previous.mine === current.mine && previous.author === current.author && (!current.createdAt || !previous.createdAt || new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000));
  return { newDay, grouped };
};
function TypingIndicator({ typers }: { typers: Typer[] }) {
  if (typers.length === 0) return null;
  const shown = typers.slice(0, 3);
  const extra = typers.length - shown.length;
  const names = typers.map((typer) => typer.name);
  const label = typers.length === 1 ? `${names[0]} is typing` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are typing`;
  return (
    <div className="typing-row" role="status" aria-live="polite" aria-label={label}>
      <span className={typers.length > 1 ? "typing-avatars stacked" : "typing-avatars"} aria-hidden="true">
        {shown.map((typer) => <Avatar key={typer.accountId} name={typer.name} seed={typer.accountId} className="typing-avatar" />)}
        {extra > 0 && <span className="typing-avatar-more">+{extra}</span>}
      </span>
      <div className="typing-bubble" aria-hidden="true">
        <span className="typing-dots"><span /><span /><span /></span>
      </div>
    </div>
  );
}
function Icon({ children }: { children: string }) {
  const Component = children === "◌" ? MessageCircle : children === "profile" ? UserRound : children === "compass" ? Compass : children === "cap" ? GraduationCap : Users;
  return (
    <span className="icon" aria-hidden="true">
      <Component size={18} strokeWidth={2} />
    </span>
  );
}

// Chats list time: "12:59" today, "Yesterday", "Tue" this week, otherwise "Sep 30".
function listTime(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86400000);
  if (days <= 0) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// Enter always sends in chat, with or without Shift, so nothing can slip in as a stray line break.
// Phones (website): while the keyboard is open, CCConnect ends exactly at the top of the keyboard (html.web-keyboard,
// --vv-h / --vv-top from the visible area), instead of keeping the home-bar space and leaving a gap above it.
if (typeof window !== "undefined" && !isNativeApp && touchScreen && window.visualViewport) {
  const viewport = window.visualViewport;
  // iPhone Home Screen apps shrink window.innerHeight along with the keyboard, so compare with the tallest the
  // visible area has been, and also treat a focused text box as "keyboard up" (iPhone always shows it then).
  let tallest = viewport.height;
  const typing = () => { const el = document.activeElement as HTMLElement | null; return Boolean(el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "file", "button", "submit"].includes((el as HTMLInputElement).type)) || el.isContentEditable)); };
  const fit = () => {
    tallest = Math.max(tallest, viewport.height);
    const open = tallest - viewport.height > 120 || (typing() && tallest - viewport.height > 40);
    const root = document.documentElement;
    root.classList.toggle("web-keyboard", open);
    root.style.setProperty("--vv-h", `${viewport.height}px`);
    root.style.setProperty("--vv-top", `${viewport.offsetTop}px`);
  };
  viewport.addEventListener("resize", fit);
  viewport.addEventListener("scroll", fit);
  document.addEventListener("focusin", () => window.setTimeout(fit, 50));
  document.addEventListener("focusout", () => window.setTimeout(fit, 50));
  window.addEventListener("orientationchange", () => { tallest = 0; window.setTimeout(fit, 300); });
  fit();
}
// Phones (website): tapping a send button keeps the keyboard up, so the layout doesn't jump mid-tap and miss it
// (the iPhone app does the same in native.ts).
if (typeof document !== "undefined" && !isNativeApp && touchScreen) {
  document.addEventListener("mousedown", (event) => { if ((event.target as Element | null)?.closest?.(".mx-send")) event.preventDefault(); }, true);
}
function sendChatOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem("mixby-token") || "",
  );
  const [account, setAccount] = useState<Account | null>(null);
  // Retained as a constant until the legacy guest-only rendering branches are removed.
  // Guest mode is the account itself (a guest account from "Browse as guest"), so it is right from the first render after a reload.
  const guest = Boolean(account?.isGuest);
  const [guestPrompt, setGuestPrompt] = useState<string | null>(null);
  const readAuth = () => ({});
  const [screen, setScreen] = useState<
    | "auth"
    | "code"
    | "password"
    | "login"
    | "reset-request"
    | "reset-password"
    | "age"
    | "app"
    | "loading"
  >("loading"); // no homepage (owner's call, Oct 27 2026): without a login, CCConnect makes a visitor one and opens

  // Bumped to retry the saved-login check while the server can't be reached.
  const [sessionRetry, setSessionRetry] = useState(0);
  const [tab, setTab] = useState<"social" | "settings" | "alerts" | "rooms" | "browse-courses" | "your-courses" | "profile" | "create" | "post" | "course-group" | "moderation" | "course-home" | "project-room" | "degree-posts" | "app-info" | "general-forum" | "note" | "events" | "clubs" | "assistant">(homeTab);
  useEffect(() => { localStorage.removeItem("mixby-guest"); }, []);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  // Which screen a notice belongs to, so a login error doesn't follow you to Sign up.
  const [noticeScreen, setNoticeScreen] = useState("");
  const [identity, setIdentity] = useState<Identity>({
    displayName: "",
    program: "",
    studyYear: null,
    bio: "",
    interests: [],
    contactLabel: "",
    contactValue: "",
  });
  const [posts, setPosts] = useState<Post[]>([]);
  const [postKind, setPostKind] = useState<Post["kind"]>("info");
  const feedKind: "all" | Post["kind"] = "all";
  const [search, setSearch] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [postTitle, setPostTitle] = useState("");
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [openPostMenu, setOpenPostMenu] = useState<string | null>(null);
  // Placeholder until we decide what triggers notifications.
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [confirmDeletePost, setConfirmDeletePost] = useState<Post | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  // Block confirmation sheet (replaces the browser's confirm box).
  const [blockTarget, setBlockTarget] = useState<ReportTarget | null>(null);
  const [blocking, setBlocking] = useState(false);
  // One confirmation sheet for every "are you sure?" (replaces the browser's confirm boxes): askConfirm resolves
  // true on the action button, false on Cancel or a tap outside.
  type ConfirmAsk = { title: string; message?: string; action: string; cancel?: string; safe?: boolean };
  const [confirmAsk, setConfirmAsk] = useState<(ConfirmAsk & { resolve: (ok: boolean) => void }) | null>(null);
  const askConfirm = (ask: ConfirmAsk) => new Promise<boolean>((resolve) => setConfirmAsk({ ...ask, resolve }));
  const loadAppStatus = () => request("/api/app-status", {}, token).then((data) => setAppStatus(data)).catch(() => setAppStatus((current) => current || { title: "The CCConnect iPhone app is on its way", body: "", updatedAt: null, canEdit: false }));
  const saveAppStatus = async (event: FormEvent) => {
    event.preventDefault();
    if (!appStatusDraft || appStatusSaving) return;
    setAppStatusSaving(true);
    try {
      const data = await request("/api/app-status", { method: "PUT", body: JSON.stringify(appStatusDraft) }, token);
      setAppStatus(data);
      setAppStatusDraft(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setAppStatusSaving(false);
    }
  };
  const answerConfirm = (ok: boolean) => { setConfirmAsk((current) => { current?.resolve(ok); return null; }); };
  const [pickerBusy, setPickerBusy] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  // Options for a chat in the course list: right-click or ⋯ (dropdown) on desktop, press and hold (bottom sheet) on phones.
  // `course`: the menu for a whole course (its class-chat plus its groups, all in `ids`).
  type ChatMenu = { id: string; label: string; group?: CourseGroup; room?: ProjectRoom; course?: boolean; ids?: string[]; x: number; y: number; sheet: boolean; muting?: boolean };
  const [chatMenu, setChatMenu] = useState<ChatMenu | null>(null);
  const chatHoldTimer = useRef<number | null>(null);
  const chatHoldFired = useRef(false);
  // The ⋯ / press-and-hold menu for a project-group message (no reactions in groups).
  const [projectMenu, setProjectMenu] = useState<ProjectMessage | null>(null);
  // Moderators: every group in the open course (private ones too), listed in Group info with Delete.
  const [modRooms, setModRooms] = useState<{ id: string; name: string; isPublic: boolean; memberCount: number; creatorName: string }[] | null>(null);
  const pickerBusyRef = useRef(false);
  const [reportCategory, setReportCategory] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportState, setReportState] = useState<"form" | "sending" | "done" | "already">("form");
  // Which chat message's sender card is open (click an avatar or name in Rooms / course chats).
  const [senderCard, setSenderCard] = useState<string | null>(null);
  // Course page + project rooms
  const [courseHome, setCourseHome] = useState<CourseGroup | null>(null);
  const [projectRooms, setProjectRooms] = useState<ProjectRoom[]>([]);
  const [projectSetupRequired, setProjectSetupRequired] = useState(false);
  const [courseMembers, setCourseMembers] = useState<{ id: string; name: string }[] | null>([]);
  const [projectPicker, setProjectPicker] = useState<"create" | "invite" | null>(null);
  // Project groups: private (invites only) or a professor group (public: anyone in the course can join from Discover).
  const [inviteOnly, setInviteOnly] = useState(true);
  const [profNameDraft, setProfNameDraft] = useState(""); // professor group: the name typed after the fixed "Prof."
  const [courseAddMenu, setCourseAddMenu] = useState<string | null>(null); // the course whose + menu is open
  const [discoverFor, setDiscoverFor] = useState<CourseGroup | null>(null);
  const [discoverRooms, setDiscoverRooms] = useState<{ id: string; courseGroupId: string; name: string; isPublic?: boolean; requested?: boolean; createdBy: string; memberCount: number; lastActivityAt: string }[] | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [pickedMemberIds, setPickedMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [activeProject, setActiveProject] = useState<ProjectRoom | null>(null);
  const [projectMessages, setProjectMessages] = useState<ProjectMessage[]>([]);
  const [projectDraft, setProjectDraft] = useState("");
  const [projectTypers, setProjectTypers] = useState<Typer[]>([]);
  const [projectPanelOpen, setProjectPanelOpen] = useState(false);
  const [projectRenameDraft, setProjectRenameDraft] = useState("");
  const activeProjectIdRef = useRef<string | null>(null);
  // Switching chats shouldn't wait on the server: show what we last saw instantly, then refresh.
  const storedChats = useRef<ChatCacheData | null>(null);
  if (storedChats.current === null) storedChats.current = readChatCache(token);
  const projectCache = useRef(new Map<string, { projectRoom: ProjectRoom; messages: ProjectMessage[] }>(Object.entries(storedChats.current.project || {})));
  // When the chat on screen was opened. Messages already there appear at once; only ones that arrive afterwards
  // animate in (animating a whole chat on every switch made switching feel slow, worst on iPhone).
  const chatOpened = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  // Which way the main area is moving (owner's call, Oct 28 2026: no instant navigation): deeper slides in from the
  // right, back from the left, a switch between sections fades.
  const navMotion = useRef<{ key: string; depth: number; dir: "forward" | "back" | "swap" | "none" | "uncover"; layer?: boolean; drawer?: boolean }>({ key: "", depth: 1, dir: "swap" });
  // Set for the one render where a phone moves between a drawer page (Alerts, Profile) and one of its full-screen
  // pages: the layout changes at once (no sliding of the rail/layer) and only the page slides, iPhone-style.
  const snapLayout = useRef(false);
  useLayoutEffect(() => {
    if (!snapLayout.current) return;
    snapLayout.current = false;
    const root = document.querySelector<HTMLElement>(".mx");
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => root?.classList.remove("mx-dragging")));
    return () => window.cancelAnimationFrame(frame);
  });
  const swipedBack = useRef(false); // the next page was revealed by a swipe: it's already on screen, so no entrance
  const courseCache = useRef(new Map<string, CourseGroupPost[]>(Object.entries(storedChats.current.course || {})));
  const membersCache = useRef(new Map<string, { id: string; name: string }[]>(Object.entries(storedChats.current.members || {})));
  const roomsCache = useRef(new Map<string, ProjectRoom[]>());
  const openingChat = useRef("");
  const [chatLoading, setChatLoading] = useState(false);
  const courseHomeIdRef = useRef<string | null>(null);
  const projectTypingTimers = useRef(new Map<string, number>());
  const lastProjectTypingSentAt = useRef(0);
  const [modView, setModView] = useState<"open" | "resolved" | "bans" | "deleted" | "stats" | "courses" | "messages">("open");
  const [modContact, setModContact] = useState<{ messages: { id: string; category: "bug" | "idea" | "other"; body: string; device: string | null; status: string; createdAt: string; name: string; email: string | null }[]; setupRequired?: boolean } | null>(null);
  const [modCourseRequests, setModCourseRequests] = useState<{ id: string; courseCode: string; instructor: string | null; termName: string; requesterCount: number; createdAt: string }[] | null>(null);
  // Moderation → Stats: launch numbers (students only; the team's accounts aren't counted).
  type ModStats = { users: { total: number; today: number; last7: number }; signupsByDay: { day: string; count: number }[]; courses: { open: number; memberships: number; studentsInACourse: number; studentsInACoursePct: number; averageMembers: number; withTwoPlus: number; withFivePlus: number; top: { name: string; members: number }[] }; notifications: { optedIn: number; pct: number }; engagement: { active: number; pct: number }; teamExcluded: number; unfinished?: number; recent?: { name: string; email: string; joined: string; method: string; degree: string | null; termsAccepted: boolean }[] };
  const [modStats, setModStats] = useState<ModStats | null>(null);
  // Moderation → Deleted: courses and posts moderators deleted, with Restore (migration 040).
  const [modDeleted, setModDeleted] = useState<{ items: { id: string; type: "course" | "post"; label: string; deletedBy: string; deletedAt: string; restoredAt: string | null }[]; setupRequired: boolean } | null>(null);
  const [modReports, setModReports] = useState<ModReport[]>([]);
  const [modBans, setModBans] = useState<ModPerson[]>([]);
  const [openReportCount, setOpenReportCount] = useState(0);
  const [banTarget, setBanTarget] = useState<{ person: ModPerson; reportId?: string; content?: ReportTarget } | null>(null);
  // Bans last 24 hours; the moderator picks why, and the person is told.
  const [banReason, setBanReason] = useState("");
  const [banOther, setBanOther] = useState("");
  const banReasonText = () => banReason === "other" ? banOther.trim() : BAN_REASONS.find((item) => item.id === banReason)?.label || "";
  const [senderAnchor, setSenderAnchor] = useState<DOMRect | null>(null);
  const toggleSenderCard = (id: string, event: { stopPropagation: () => void; currentTarget: HTMLElement }) => {
    event.stopPropagation();
    setSenderAnchor(event.currentTarget.getBoundingClientRect());
    setSenderCard((current) => (current === id ? null : id));
  };
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  // Instagram-style loading (owner's call, Oct 29 2026): "No posts" / "No comments" only once the server has said so;
  // until then a shimmering placeholder. These hold what has come back from the server in this session.
  const freshForums = useRef(new Set<string>());
  const [commentsLoadedFor, setCommentsLoadedFor] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  // A photo for the comment, picked from your notes with the + (copyFrom: already in the cloud, copied by the server).
  const [commentImage, setCommentImage] = useState<{ src: string; copyFrom?: string } | null>(null);
  // The + next to the comment box: pick one entry from your notes (owner's call, Nov 2 2026).
  const [notePicker, setNotePicker] = useState<{ entries: (NoteEntry & { note: CourseNote })[]; loading: boolean; course: string; query: string; filterOpen?: boolean } | null>(null);
  useEffect(() => {
    if (!notePicker) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setNotePicker((current) => current?.filterOpen ? { ...current, filterOpen: false } : null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [Boolean(notePicker)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [commentPhotoView, setCommentPhotoView] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [openCommentMenu, setOpenCommentMenu] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<PostComment | null>(null);
  const [editedCommentBody, setEditedCommentBody] = useState("");
  const [showActivity, setShowActivity] = useState(false);
  const [profileActivity, setProfileActivity] = useState<ProfileActivity | null>(null);
  const [openActivityMenu, setOpenActivityMenu] = useState<string | null>(null);
  const [showFlairPicker, setShowFlairPicker] = useState(false);
  const [postFlair, setPostFlair] = useState<PostFlair | null>(null);
  // copyFrom: a photo already uploaded to one of your notes; the server copies it instead of the phone uploading it again.
  const [postImages, setPostImages] = useState<{ src: string; name?: string; isNew: boolean; copyFrom?: string }[]>([]);
  // A post is being sent: Post is disabled until it's done, so extra taps can't publish it several times.
  const [postSending, setPostSending] = useState(false);
  const postSendingRef = useRef(false);
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const postBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [postBody, setPostBody] = useState("");
  // The description is optional and folded away under the title (owner's call, Oct 28 2026): it opens only when
  // someone taps "Add description", or by itself when editing a post that already has one.
  const [descOpen, setDescOpen] = useState(false);
  useEffect(() => { if (tab === "create") setDescOpen(Boolean(postBody.trim())); }, [tab]);
  const [externalUrl, setExternalUrl] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [classmateCount, setClassmateCount] = useState(0);
  // Only show the "choose a username" prompt once the real profile has loaded.
  const [identityLoaded, setIdentityLoaded] = useState(false);
  // iOS app Chats list: latest message per course chat and project room (GET /api/chats).
  const [chatPreviews, setChatPreviews] = useState<{ courses: Record<string, ChatPreview>; projectRooms: (ProjectRoom & { courseCode: string; lastMessage: ChatPreview })[] }>({ courses: {}, projectRooms: [] });
  const [chatSearch, setChatSearch] = useState("");
  // Courses opened in the course list. Everything starts closed when the app opens (owner's call, Oct 31 2026).
  const [openCourses, setOpenCourses] = useState<string[]>([]);
  // New shell: search inside the open chat, the composer's emoji picker, and the Create a course page.
  const [chatFind, setChatFind] = useState<string | null>(null);
  // New shell: the rail switches what the course-list column shows (Discord-style tabs).
  const [railPanel, setRailPanel] = useState<"courses" | "posts" | "alerts" | "profile" | "app">("courses");
  // Website "CCConnect App" page: one status post about the iPhone app; the CCConnect team can edit it.
  type AppStatus = { title: string; body: string; updatedAt: string | null; canEdit: boolean; setupRequired?: boolean };
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [appStatusDraft, setAppStatusDraft] = useState<{ title: string; body: string } | null>(null);
  const [appStatusSaving, setAppStatusSaving] = useState(false);
  const appStatusOpened = useRef(false); // only refresh it live for people who've opened the page
  const [emojiPickerFor, setEmojiPickerFor] = useState<"course" | "project" | null>(null);
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [allClassmatesShown, setAllClassmatesShown] = useState(false);
  // Notification settings (gear on Notifications): pause all, kinds off, muted chats. Saved on the server.
  type NotificationSettings = { paused: boolean; offKinds: string[]; mutedChats: string[]; mutedUntil?: Record<string, string> };
  const [notifSettings, setNotifSettings] = useState<NotificationSettings | null>(null);
  const [notifSettingsOpen, setNotifSettingsOpen] = useState(false);
  const [notifChatSearch, setNotifChatSearch] = useState("");
  // Profile → Edit Profile / Privacy & Safety / Account & Security / Appearance, shown in the main area.
  const colorBefore = useRef<number | null>(null); // the colour when the picker opened, for Cancel
  // Edit Profile shows your profile read-only until you press Edit; Cancel puts back what was there.
  const [profileEditing, setProfileEditing] = useState(false);
  const identityBefore = useRef<Identity | null>(null);
  const [profilePage, setProfilePage] = useState<null | "edit" | "color" | "privacy" | "account" | "legal" | "contact" | "moderation">(null);
  // Profile → Contact CCConnect (migration 050): a message to the team instead of email.
  const [contactCategory, setContactCategory] = useState<"bug" | "idea" | "other">("bug");
  const [contactBody, setContactBody] = useState("");
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);
  // Terms gate (sign-up, and once for anyone who hasn't accepted the current Terms) and the Terms and Services page.
  const [legalTab, setLegalTab] = useState<"terms" | "privacy">("terms");
  const [legalRead, setLegalRead] = useState({ terms: false, privacy: false });
  const [legalAgree, setLegalAgree] = useState(false);
  // Display name chosen during sign-up: on the password page (email sign-ups), or on the Terms page for Google
  // sign-ups, which skip the password page. nameChosen = already saved with the password.
  const [signupName, setSignupName] = useState("");
  const [nameChosen, setNameChosen] = useState(false);
  const profilePageFromFull = useRef(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [notifChatsAll, setNotifChatsAll] = useState(false);
  // Phones: something opened from the full-screen Alerts page goes back to that page (not the small side view).
  const backToAlerts = useRef(false);
  const seenVersion = useRef(0); // bumped on every "mark notifications seen"
  const seenInFlight = useRef(0);
  const infoFromBanner = useRef(false); // Degree info opened from the banner's ⋮ (back returns to the list, not the chat)
  const notifSettingsFromFull = useRef(false); // opened from full-screen Notifications (phones) vs the column
  const loadNotifSettings = () => request("/api/notification-settings", {}, token).then((data) => setNotifSettings(data.settings)).catch(() => {});
  const saveNotifSettings = (next: NotificationSettings) => {
    const before = notifSettings;
    setNotifSettings(next);
    request("/api/notification-settings", { method: "PUT", body: JSON.stringify(next) }, token)
      .then(() => loadNotifications().catch(() => {}))
      .catch((error) => { setNotifSettings(before); setNotice(error instanceof Error ? error.message : "Unable to save."); });
  };
  // When you last looked at each course's pinned messages; pins after that get a number badge (like unread).
  const [pinsSeen, setPinsSeen] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem("mixby-pins-seen") || "{}"); } catch { return {}; } });
  const markPinsSeen = (groupId: string) => setPinsSeen((seen) => { const next = { ...seen, [groupId]: new Date().toISOString() }; try { localStorage.setItem("mixby-pins-seen", JSON.stringify(next)); } catch { /* private mode */ } return next; });
  const [showPassword, setShowPassword] = useState(false);
  // Website only: logged-out visitors start on the homepage (degree search); Join or Log in moves on to the forms.
  const [landing, setLanding] = useState(false); // the old homepage; not shown any more (visitors go straight in)
  const [joinDegree, setJoinDegree] = useState<Degree | null>(() => readPendingDegree());
  const [createCode, setCreateCode] = useState("");
  const [createChecked, setCreateChecked] = useState(false);
  // iOS app Discover: one list with filter chips, and Request a course on its own page.
  const [discoverFilter, setDiscoverFilter] = useState<"available" | "requested">("available");
  const [discoverTerm, setDiscoverTerm] = useState("");
  const [requestPageOpen, setRequestPageOpen] = useState(false);
  const [discoverSort, setDiscoverSort] = useState<"members" | "az">("members");
  // Filters page: edits a draft; Apply copies it to the real filters, ✕ throws it away.
  const [filtersDraft, setFiltersDraft] = useState<{ show: "available" | "requested"; term: string; sort: "members" | "az" } | null>(null);
  // Where Back goes from a project room in the app: the course chat it was opened from, or the Chats list.
  const projectReturn = useRef<"course-group" | "your-courses">("your-courses");
  // iOS app: the course chat's Group info page (ⓘ).
  const [courseInfoOpen, setCourseInfoOpen] = useState(false);
  const [courseQrOpen, setCourseQrOpen] = useState(false);
  // A scanned course QR code (ccconnect.app/?course=<id>): opened once you're in the app (after signing in if needed).
  const pendingCourseLink = useRef(new URLSearchParams(window.location.search).get("course"));
  const pendingPostLink = useRef(new URLSearchParams(window.location.search).get("post"));
  // iOS app appearance (Profile → Appearance), remembered on this phone.
  // New shell: your degree community, the degree list/picker, and (on phones) whether the chat pane is showing.
  const [degree, setDegree] = useState<DegreeCommunity | null>(null);
  // Degree Posts (replaces the degree General chat): your degree's posts, and whether the composer is writing one.
  const [degreePosts, setDegreePosts] = useState<Post[]>([]);
  const [degreePostsUnavailable, setDegreePostsUnavailable] = useState(false);
  // General Forum: the newest posts from every course's forum (null until loaded). Back from a post returns here.
  const forumCache = useRef<Record<string, Post[]> | null>(null); // filled from the device on first use
  const cachedForum = (key: string) => { if (!forumCache.current) forumCache.current = readForumCache(localStorage.getItem("mixby-token") || ""); return forumCache.current[key]; };
  const rememberForum = (key: string, posts: Post[]) => {
    if (!forumCache.current) forumCache.current = readForumCache(localStorage.getItem("mixby-token") || "");
    const { [key]: _old, ...rest } = forumCache.current;
    forumCache.current = { ...rest, [key]: posts };
    saveForumCache(localStorage.getItem("mixby-token") || "", forumCache.current);
  };
  const [generalPosts, setGeneralPosts] = useState<Post[] | null>(() => cachedForum("general") || null);
  const postFromGeneral = useRef(false);
  // The open course's forum (COURSE_FORUM): its posts, and which course they belong to.
  const [courseForum, setCourseForum] = useState<{ groupId: string; posts: Post[]; loaded: boolean }>({ groupId: "", posts: [], loaded: false });
  const [postScope, setPostScope] = useState<"dev" | "degree" | "course" | "general">("dev"); // general = a General Forum post (no course)
  const [degreeList, setDegreeList] = useState<Degree[] | null>(null);
  const [degreesUnavailable, setDegreesUnavailable] = useState(false);
  const [myDegreeRequests, setMyDegreeRequests] = useState<Degree[]>([]);
  const [degreePickerOpen, setDegreePickerOpen] = useState(false);
  const [degreeSearch, setDegreeSearch] = useState("");
  const [mobileMain, setMobileMain] = useState(false);
  const [courseRequestInstructor, setCourseRequestInstructor] = useState("");
  const degreePromptShown = useRef(false);
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => { try { const saved = localStorage.getItem("mixby-theme"); return saved === "dark" || saved === "system" ? saved : "light"; } catch { return "light"; } });
  const [systemDark, setSystemDark] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches));
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const darkMode = theme === "dark" || (theme === "system" && systemDark);
  // People you've blocked: their content is filtered by the server; this list powers Profile → Blocked and live-message filtering.
  const [blockedPeople, setBlockedPeople] = useState<{ id: string; name: string }[]>([]);
  const blockedIdsRef = useRef(new Set<string>());
  blockedIdsRef.current = new Set(blockedPeople.map((person) => person.id));
  // A tapped push notification waits here until the app has loaded enough to open it.
  // A tapped notification: native (onPushTap) or the website's (?push= when it starts the app, or a message from the
  // service worker when CCConnect is already open). The same code below opens whatever it points at.
  const [pushTap, setPushTap] = useState<PushTap | null>(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get("push");
      if (!raw) return null;
      const url = new URL(window.location.href);
      url.searchParams.delete("push");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      return JSON.parse(raw);
    } catch { return null; }
  });
  // Website notifications on this device (Web Push): what to show on the Notifications and CCConnect App pages.
  type WebPushState = "loading" | "on" | "off" | "denied" | "needs-install" | "unsupported" | "unavailable";
  const [webPushState, setWebPushState] = useState<WebPushState>("loading");
  const [webPushBusy, setWebPushBusy] = useState(false);
  const [pushTestResult, setPushTestResult] = useState<string | null>(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [, setInstallVersion] = useState(0);
  useEffect(() => onInstallChange(() => setInstallVersion((value) => value + 1)), []);
  const [savedUsername, setSavedUsername] = useState("");
  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);
  // CCConnect demo: events you're going to, clubs you've joined and the club filter (kept in memory).
  const [goingEvents, setGoingEvents] = useState<string[]>(["ev-3"]);
  // Club chats: what you've said to each club and its replies. clubView: the clubs list, the chat list ("inbox") or one club's chat.
  const [clubChats, setClubChats] = useState<Record<string, { mine: boolean; body: string; at: string }[]>>(() => ({ "cl-1": [
    { mine: true, body: "Hi! Is the study night open to first-years?", at: new Date(Date.now() - 26 * 3600000).toISOString() },
    { mine: false, body: "Absolutely, everyone's welcome. Bring your laptop and any questions from lab 4!", at: new Date(Date.now() - 25 * 3600000).toISOString() },
  ] }));
  const [clubView, setClubView] = useState<string | null>(null);
  // CCConnect assistant chat: the turns, the draft, whether an answer is coming, and where answers come from.
  const [aiTurns, setAiTurns] = useState<AssistantTurn[]>([]);
  const [aiDraft, setAiDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSource, setAiSource] = useState<"claude" | "demo" | null>(null);
  const [clubDraft, setClubDraft] = useState("");
  const [clubCategory, setClubCategory] = useState<(typeof CLUB_CATEGORIES)[number]>("All");
  const [groupsReady, setGroupsReady] = useState(false); // the course list has arrived (from the device or the server)
  const [courseQuery, setCourseQuery] = useState("");
  const [courseCatalog, setCourseCatalog] = useState<CatalogCourse[]>([]);
  const [catalogLimit, setCatalogLimit] = useState(60);
  // The General Forum's search finds every York course too, so it needs the list as well.
  useEffect(() => { if ((tab === "browse-courses" || tab === "general-forum") && !courseCatalog.length) loadCourseCatalog().then(setCourseCatalog); }, [tab, courseCatalog.length]);
  const [forumQuery, setForumQuery] = useState(""); // Degree Forum search (title, text or author)
  const [courseTerms, setCourseTerms] = useState<CourseTerm[]>([]);
  const [currentTermName, setCurrentTermName] = useState("");
  const [currentTermId, setCurrentTermId] = useState("");
  const [courseRequests, setCourseRequests] = useState<CourseRequest[]>([]);
  const [courseRequestsSetup, setCourseRequestsSetup] = useState(true);
  const [courseRequestCode, setCourseRequestCode] = useState("");
  const [courseRequestTermId, setCourseRequestTermId] = useState("");
  const [activeCourseGroup, setActiveCourseGroup] = useState<CourseGroup | null>(null);
  // Going back to a list puts it where you left it (owner's call, Oct 28 2026): each list's scroll, by page.
  const listScroll = useRef<Record<string, number>>({});
  const listKey = `${tab}|${tab === "course-group" ? activeCourseGroup?.id || "" : ""}`;
  useLayoutEffect(() => {
    if (!["general-forum", "course-group", "degree-posts", "social"].includes(tab)) return;
    const saved = listScroll.current[listKey];
    if (!saved) return;
    const restore = () => { const list = document.querySelector<HTMLElement>(".mx-main .mx-page-scroll.mx-feed"); if (list) list.scrollTop = saved; };
    restore();
    window.requestAnimationFrame(restore); // again once the page has laid out its posts
  }, [listKey]);
  const rememberListScroll = (from: HTMLElement | null) => {
    const list = from?.closest<HTMLElement>(".mx-page-scroll");
    if (list) listScroll.current[listKey] = list.scrollTop;
  };
  const [courseGroupPosts, setCourseGroupPosts] = useState<CourseGroupPost[]>([]);
  // "Name joined" lines per course chat (sent with its messages: everyone still in it, at the time they joined).
  const [courseJoins, setCourseJoins] = useState<Record<string, { id: string; name: string; at: string; mine?: boolean }[]>>({});
  const rememberJoins = (groupId: string, joins?: { id: string; name: string; at: string; mine?: boolean }[]) => { if (joins) setCourseJoins((all) => ({ ...all, [groupId]: joins })); };
  const [courseGroupView, setCourseGroupView] = useState<"chat" | "pinned">("chat");
  // The chat / tab list eases in only when you open a different one, not when you come back to the same one
  // (from Group info or a question page), which used to replay the whole entrance and looked like a glitch.
  const listKeyNow = useRef("");
  const listKeyShown = useRef("");
  useEffect(() => { listKeyShown.current = listKeyNow.current; });
  const listEnter = (key: string) => { listKeyNow.current = key; return listKeyShown.current === key ? "" : " mx-list-in"; };
  const [coursePostMenuId, setCoursePostMenuId] = useState<string | null>(null);
  const [coursePostBody, setCoursePostBody] = useState("");
  // Reply (migration 045): the course message you're answering; shown above the message box until you send or cancel.
  const [replyingTo, setReplyingTo] = useState<CourseGroupPost | null>(null);
  const [courseAttachment, setCourseAttachment] = useState<ChatAttachment | null>(null);
  const [projectAttachment, setProjectAttachment] = useState<ChatAttachment | null>(null);
  const [coursePollOptions, setCoursePollOptions] = useState<string[]>([]);
  const [roomTitle, setRoomTitle] = useState("");
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [closingRooms, setClosingRooms] = useState(false);
  const closingRoomsTimer = useRef<number | null>(null);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  const [roomDraft, setRoomDraft] = useState("");
  const [roomPollOptions, setRoomPollOptions] = useState<string[]>([]);
  const [roomCount, setRoomCount] = useState(0);
  const [roomTypers, setRoomTypers] = useState<Typer[]>([]);
  const [courseGroupTypers, setCourseGroupTypers] = useState<Typer[]>([]);
  const roomTypingTimers = useRef(new Map<string, number>());
  const courseGroupTypingTimers = useRef(new Map<string, number>());
  const lastRoomTypingSentAt = useRef(0);
  const lastCourseTypingSentAt = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const activeCommentPostIdRef = useRef<string | null>(null);
  const activeCourseGroupIdRef = useRef<string | null>(null);
  const courseKeyAt = useRef(0); // last keystroke in the course chat box
  const courseTypingStopped = useRef(false);
  const projectKeyAt = useRef(0);
  const projectTypingStopped = useRef(false);
  const myChatIdsRef = useRef<Set<string>>(new Set()); // course chats you're in (plus your degree's)
  const prefetchedChats = useRef(false);
  const myPostIdsRef = useRef<Set<string>>(new Set());

  // Re-fetch only the feed (used for live updates), keeping an open post in sync if it was edited.
  // Where a post's back button goes: its course tab, the Degree Forum or Dev Posts.
  const postHome = (post: Pick<Post, "degreeId" | "courseGroupId">) => post.courseGroupId ? "course-group" : post.degreeId ? "degree-posts" : DEV_POSTS_ENABLED ? "social" : "general-forum";
  const refreshPosts = async () => {
    const data = await request("/api/social/posts", {}, token);
    setPosts(data.posts);
    setCommentPost((current) => current ? data.posts.find((post: Post) => post.id === current.id) || current : current);
    if (degreeIdRef.current) await loadDegreePosts();
    if (COURSE_FORUM && activeCourseGroupIdRef.current) await loadCourseForum(activeCourseGroupIdRef.current).catch(() => {});
    if (generalPostsRef.current) await loadGeneralForum().catch(() => {});
  };
  const generalPostsRef = useRef(false); // the General Forum has been opened (so live changes refresh it)
  const loadGeneralForum = async () => {
    const data = await request("/api/social/posts?scope=general", readAuth(), token);
    rememberForum("general", data.posts);
    freshForums.current.add("general");
    setGeneralPosts(data.posts);
    setCommentPost((current) => current ? data.posts.find((post: Post) => post.id === current.id) || current : current);
  };
  const loadCourseForum = async (groupId: string) => {
    const data = await request(`/api/social/posts?courseGroupId=${encodeURIComponent(groupId)}&channel=questions`, readAuth(), token);
    rememberForum(`course:${groupId}`, data.posts);
    freshForums.current.add(`course:${groupId}`);
    if (activeCourseGroupIdRef.current !== groupId) return;
    setCourseForum({ groupId, posts: data.posts, loaded: true });
    setCommentPost((current) => current ? data.posts.find((post: Post) => post.id === current.id) || current : current);
  };
  useEffect(() => {
    if (tab !== "general-forum" || !token || screen !== "app") return;
    generalPostsRef.current = true;
    loadGeneralForum().catch((error) => setNotice(error instanceof Error ? error.message : "Unable to load the General Forum."));
  }, [tab, token, screen]);
  // My notes (under each course in the course list).
  // Loaded again when you join or leave a course (each course you're in gets a "General notes" note on the server).
  const myCourseKey = courseGroups.filter((group) => group.joined && !group.isDegree).map((group) => group.id).sort().join(",");
  useEffect(() => {
    if (!token || screen !== "app" || account?.isGuest) return;
    request("/api/notes", readAuth(), token).then((data) => setNotes(data.notes || [])).catch(() => {});
  }, [token, screen, account?.isGuest, myCourseKey]);
  // Right after launch, fetch the General Forum and your courses' forums in the background, so opening any of them
  // is instant (they're also kept on the device for next time).
  const forumsPrefetched = useRef(false);
  useEffect(() => {
    if (!COURSE_FORUM || forumsPrefetched.current || !token || screen !== "app" || courseGroups.length === 0) return;
    forumsPrefetched.current = true;
    const mine = courseGroups.filter((group) => group.joined && !group.isDegree).slice(0, 10);
    window.setTimeout(() => {
      if (tab !== "general-forum") request("/api/social/posts?scope=general", readAuth(), token).then((data) => { rememberForum("general", data.posts); freshForums.current.add("general"); setGeneralPosts((current) => current ?? data.posts); }).catch(() => {});
      for (const group of mine) request(`/api/social/posts?courseGroupId=${encodeURIComponent(group.id)}&channel=questions`, readAuth(), token).then((data) => { rememberForum(`course:${group.id}`, data.posts); freshForums.current.add(`course:${group.id}`); }).catch(() => {});
    }, 600);
  }, [token, screen, courseGroups.length]);
  // Opening a course loads its forum (the open course stays shown while it refreshes).
  useEffect(() => {
    const groupId = activeCourseGroup?.id;
    if (!COURSE_FORUM || !groupId || !token || tab !== "course-group" || groupId === degree?.groupId) return;
    if (courseForum.groupId !== groupId) setForumQuery(""); // a new course starts with an empty search
    // Shown at once from the device when this course was loaded before (then refreshed).
    setCourseForum((current) => { if (current.groupId === groupId) return current; const saved = cachedForum(`course:${groupId}`); return { groupId, posts: saved || [], loaded: Boolean(saved) }; });
    loadCourseForum(groupId).catch((error) => setNotice(error instanceof Error ? error.message : "Unable to load the forum."));
  }, [activeCourseGroup?.id, tab, token]);
  const degreeIdRef = useRef<string | null>(null);
  const loadDegreePosts = async () => {
    const degreeId = degreeIdRef.current;
    if (!degreeId) { setDegreePosts([]); return []; }
    const data = await request(`/api/social/posts?degreeId=${encodeURIComponent(degreeId)}`, readAuth(), token);
    if (degreeIdRef.current !== degreeId) return [];
    setDegreePosts(data.posts);
    setDegreePostsUnavailable(Boolean(data.setupRequired));
    setCommentPost((current) => current ? data.posts.find((post: Post) => post.id === current.id) || current : current);
    return data.posts as Post[];
  };
  // Dev mode (CCConnect team only, Profile → Dev mode): off = see CCConnect exactly as a student does on this device
  // (no moderation, Dev Post or CCConnect App editing controls). Only hides them; the server still knows who you are.
  const isTeam = Boolean(account?.isAdmin || account?.canPost);
  const [devMode, setDevMode] = useState(() => { try { return localStorage.getItem("mixby-dev-mode") !== "off"; } catch { return true; } });
  const toggleDevMode = (on: boolean) => { setDevMode(on); try { localStorage.setItem("mixby-dev-mode", on ? "on" : "off"); } catch { /* private mode */ } };
  const isAdmin = Boolean(account?.isAdmin) && devMode;
  const canPostDev = Boolean(account?.canPost) && devMode;
  // With Dev mode on, a team account's posts, comments and messages go out as "CCConnect Team" (the server checks it).
  const sendAsTeam = isTeam && devMode;
  const postingBannedUntil = account?.postingBannedUntil && new Date(account.postingBannedUntil) > new Date() ? account.postingBannedUntil : null;
  const loadModeration = async (view = modView) => {
    if (view === "stats") {
      setModStats(await request("/api/admin/stats", {}, token));
    } else if (view === "deleted") {
      setModDeleted(await request("/api/admin/deleted", {}, token));
    } else if (view === "messages") {
      setModContact(await request("/api/admin/contact", {}, token));
    } else if (view === "courses") {
      setModCourseRequests((await request("/api/admin/course-requests", {}, token)).requests);
    } else if (view === "bans") {
      const data = await request("/api/admin/posting-bans", {}, token);
      setModBans(data.bans);
    } else {
      const data = await request(`/api/admin/reports?status=${view}`, {}, token);
      setModReports(data.reports);
    }
    const summary = await request("/api/admin/summary", {}, token);
    setOpenReportCount(summary.openReports);
  };
  // Course requests (owner's call, Oct 31 2026): students ask, a moderator accepts (the course is made and everyone
  // who asked joins it) or rejects.
  const reviewCourseRequest = async (id: string, approve: boolean) => {
    try {
      await request(`/api/admin/course-requests/${id}`, { method: "POST", body: JSON.stringify({ approve }) }, token);
      setModCourseRequests((list) => (list || []).filter((item) => item.id !== id));
      if (approve) loadApp().catch(() => {});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update that request.");
    }
  };
  const markContactDone = async (id: string) => {
    try {
      await request(`/api/admin/contact/${id}`, { method: "POST", body: JSON.stringify({ done: true }) }, token);
      setModContact((current) => current ? { ...current, messages: current.messages.filter((item) => item.id !== id) } : current);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update that message.");
    }
  };
  const sendContact = async () => {
    const body = contactBody.trim();
    if (!body || contactSending) return;
    setContactSending(true);
    try {
      // Which app and screen size, so a bug can be reproduced (shown only to the team).
      const device = `${isNativeApp ? "iPhone app" : "Website"} · ${window.innerWidth}×${window.innerHeight} · ${navigator.userAgent}`.slice(0, 300);
      await request("/api/contact", { method: "POST", body: JSON.stringify({ category: contactCategory, body, device }) }, token);
      setContactBody("");
      setContactSent(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to send your message.");
    } finally {
      setContactSending(false);
    }
  };
  const restoreDeleted = async (id: string) => {
    try {
      await request(`/api/admin/deleted/${id}/restore`, { method: "POST" }, token);
      await loadModeration("deleted");
      loadApp().catch(() => {});
      loadDegreePosts().catch(() => {});
      request("/api/social/posts", {}, token).then((data) => setPosts(data.posts)).catch(() => {});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to restore that.");
    }
  };
  const resolveReport = async (report: ModReport, action: "dismiss" | "reviewed" | "remove") => {
    try {
      await request(`/api/admin/reports/${report.id}`, { method: "POST", body: JSON.stringify({ action }) }, token);
      await loadModeration();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update the report.");
    }
  };
  const setPostingBan = async (personId: string, days: number, reportId?: string, reason?: string) => {
    try {
      await request(`/api/admin/accounts/${personId}/posting-ban`, { method: "POST", body: JSON.stringify({ days, reportId, reason }) }, token);
      setBanTarget(null);
      await loadModeration();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update the ban.");
    }
  };
  // Moderators: ban whoever wrote a message, post or comment, straight from it.
  const startBan = (target: ReportTarget) => { setSenderCard(null); setMessageMenu(null); setBanReason(""); setBanOther(""); setBanTarget({ person: { name: target.authorName, email: "", postingBannedUntil: null }, content: target }); };
  const banByContent = async (target: ReportTarget, reason: string) => {
    try {
      await request("/api/admin/posting-ban-by-content", { method: "POST", body: JSON.stringify({ targetType: target.type, targetId: target.id, days: 1, reason }) }, token);
      setNotice(`${target.authorName} can't post for 24 hours. They've been told why.`);
      setBanTarget(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to ban.");
    }
  };
  const refreshAccount = async () => {
    const data = await request("/api/me", {}, token);
    setAccount(data.account);
  };
  const loadNotificationsLatest = useRef<() => Promise<void>>(async () => {});
  const loadNotificationsShared = useRef(coalesce(() => loadNotificationsLatest.current()));
  const loadNotifications = () => loadNotificationsShared.current();
  loadNotificationsLatest.current = async () => {
    const version = seenVersion.current;
    const data = await request("/api/notifications", {}, token);
    const shown = (data.notifications as AppNotification[]).filter((item) => POSTS_ENABLED || item.kind !== "post_comment");
    setNotifications(shown);
    // A load that overlapped "mark seen" carries the old count; keep the 0 instead of bringing the badge back.
    if (seenInFlight.current === 0 && version === seenVersion.current) setUnreadNotifications(POSTS_ENABLED ? data.unreadCount : shown.filter((item) => item.unread).length);
  };
  const markNotificationsSeen = () => {
    setUnreadNotifications(0);
    seenVersion.current += 1;
    seenInFlight.current += 1;
    request("/api/notifications/seen", { method: "POST" }, token).catch(() => {}).finally(() => { seenInFlight.current -= 1; });
  };
  // Opening the panel marks everything seen; items keep their "new" dot until the panel closes.
  const toggleNotifications = () => {
    if (notificationsOpen) {
      setNotifications((items) => items.map((item) => ({ ...item, unread: false })));
    } else if (unreadNotifications > 0) {
      markNotificationsSeen();
    }
    setNotificationsOpen(!notificationsOpen);
  };
  const openNotification = async (item: AppNotification) => {
    setNotificationsOpen(false);
    backToAlerts.current = !isWide() && tab === "alerts";
    // A new public group in one of your courses: open that course's Discover list.
    if (item.kind === "public_group") {
      const group = courseGroups.find((candidate) => candidate.id === item.courseGroupId);
      if (group) openDiscover(group); else setNotice("That course is no longer available.");
      return;
    }
    // A course you created went live: open its chat (it may not be in the list yet).
    if (item.kind === "course_live" || item.kind === "new_course") {
      let group = courseGroups.find((candidate) => candidate.id === item.courseGroupId);
      if (!group) group = ((await request("/api/course-groups", {}, token).catch(() => ({ groups: [] }))).groups || []).find((candidate: CourseGroup) => candidate.id === item.courseGroupId);
      if (group) { openCourseGroup(group); setMobileMain(true); } else setNotice("That course is no longer available.");
      return;
    }
    if (item.kind === "course_reset") {
      const group = courseGroups.find((candidate) => candidate.id === item.courseGroupId);
      if (group) { openCourseGroup(group); setMobileMain(true); }
      return;
    }
    if (item.kind === "chat_message") {
      if (item.projectRoomId) {
        const group = courseGroups.find((candidate) => candidate.id === item.courseGroupId);
        if (group) setCourseHome(group);
        closeRooms(() => { leaveRoom(); openProjectRoom(item.projectRoomId as string); });
      } else {
        const group = courseGroups.find((candidate) => candidate.id === item.courseGroupId) || (degree && degree.groupId === item.courseGroupId ? { id: degree.groupId, courseCode: "General", termName: degree.code, memberCount: degree.memberCount, joined: true, unreadCount: degree.unreadCount, isDegree: true } : null);
        if (!group) { setNotice("That chat is no longer available."); return; }
        openCourseGroup(group);
      }
      setMobileMain(true);
      return;
    }
    if (item.kind === "project_invite" && item.projectRoomId) {
      const group = courseGroups.find((candidate) => candidate.id === item.courseGroupId);
      if (group) setCourseHome(group);
      closeRooms(() => { leaveRoom(); openProjectRoom(item.projectRoomId as string); });
      setMobileMain(true);
      return;
    }
    // The post can be in any forum (course, General, degree): look on the device first, then ask for just that post.
    let post = posts.find((candidate) => candidate.id === item.postId) || degreePosts.find((candidate) => candidate.id === item.postId) || (generalPosts || []).find((candidate) => candidate.id === item.postId) || courseForum.posts.find((candidate) => candidate.id === item.postId);
    if (!post && item.postId) post = (await request(`/api/social/posts?postId=${encodeURIComponent(item.postId)}`, {}, token).catch(() => ({ posts: [] }))).posts?.[0];
    if (!post) { setNotice("That post is no longer available."); return; }
    const target = post;
    // A course post opens over its course's forum, so Back (and title-only posts' comments) land there.
    const course = target.courseGroupId ? courseGroups.find((candidate) => candidate.id === target.courseGroupId) : undefined;
    closeRooms(() => { leaveRoom(); if (course) openCourseGroup(course); openComments(target, !target.courseGroupId && !target.degreeId); });
  };
  // Re-fetch only the course list (unread counts, members) instead of reloading the whole app.
  const refreshCourseGroupsLatest = useRef<() => Promise<unknown>>(async () => {});
  const refreshCourseGroupsShared = useRef(coalesce(() => refreshCourseGroupsLatest.current()));
  const refreshCourseGroups = () => refreshCourseGroupsShared.current();
  refreshCourseGroupsLatest.current = async () => {
    const data = await request("/api/course-groups", readAuth(), token);
    setCourseGroups(data.groups);
    setClassmateCount(data.classmates || 0);
    if (data.degree !== undefined) setDegree(data.degree);
    // A requested course opens when a classmate joins: drop it from the "Waiting" list at the same time.
    request("/api/course-requests", readAuth(), token).then((requests) => setCourseRequests(requests.requests || [])).catch(() => {});
  };
  // A course's members (the faces in the chat header) and its groups: shown at once from the saved copy, then each
  // list is refreshed on its own as soon as it arrives (the faces used to wait for the groups list too).
  const loadCourseHome = async (groupId: string) => {
    const savedMembers = membersCache.current.get(groupId);
    setCourseMembers(savedMembers || null); // never another course's faces while this one loads
    courseHomeIdRef.current = groupId;
    const savedRooms = roomsCache.current.get(groupId);
    if (savedRooms) setProjectRooms(savedRooms);
    const members = request(`/api/course-groups/${groupId}/members`, {}, token).then((data) => {
      membersCache.current.set(groupId, data.members);
      if (courseHomeIdRef.current === groupId) setCourseMembers(data.members);
    });
    const roomsData = await request(`/api/course-groups/${groupId}/project-rooms`, {}, token);
    roomsCache.current.set(groupId, roomsData.projectRooms);
    if (courseHomeIdRef.current === groupId || !courseHomeIdRef.current) {
      setProjectRooms(roomsData.projectRooms);
      setProjectSetupRequired(Boolean(roomsData.setupRequired));
    }
    await members.catch(() => {});
    return roomsData.projectRooms as ProjectRoom[];
  };
  const openCourseHome = (group: CourseGroup) => {
    closeRooms(() => {
      leaveRoom();
      setCourseHome(group);
      setProjectRooms([]);
      setTab("course-home");
      loadCourseHome(group.id).catch((error) => setNotice(error.message));
    });
  };
  const clearProjectTypers = () => {
    projectTypingTimers.current.forEach((timer) => window.clearTimeout(timer));
    projectTypingTimers.current.clear();
    setProjectTypers([]);
  };
  const openProjectRoom = async (projectRoomId: string) => {
    openingChat.current = `project:${projectRoomId}`;
    // Open right away with whatever we already know (a cached visit, or the room from the course's list).
    const cached = projectCache.current.get(projectRoomId);
    const listed = projectRooms.find((room) => room.id === projectRoomId);
    const showRoom = (room: ProjectRoom, messages: ProjectMessage[]) => {
      clearProjectTypers();
      setActiveProject(room);
      setProjectMessages(messages);
      setProjectPanelOpen(false);
      setProjectDraft("");
      setProjectAttachment(null);
      setTab("project-room");
    };
    if (cached || listed) showRoom(cached?.projectRoom || (listed as ProjectRoom), cached?.messages || []);
    setChatLoading(!cached);
    socketRef.current?.emit("projectRoomJoin", { projectRoomId });
    setProjectRooms((rooms) => rooms.map((room) => room.id === projectRoomId ? { ...room, unreadCount: 0 } : room));
    try {
      const data = await request(`/api/project-rooms/${projectRoomId}`, {}, token);
      projectCache.current.set(projectRoomId, { projectRoom: data.projectRoom, messages: data.messages });
      if (openingChat.current !== `project:${projectRoomId}`) return; // you've already moved on
      if (cached || listed) { setActiveProject(data.projectRoom); setProjectMessages(data.messages); }
      else showRoom(data.projectRoom, data.messages);
      request(`/api/project-rooms/${projectRoomId}/read`, { method: "POST" }, token).catch(() => {});
    } catch (error) {
      if (openingChat.current === `project:${projectRoomId}`) setNotice(error instanceof Error ? error.message : "Unable to open the project room.");
    } finally {
      if (openingChat.current === `project:${projectRoomId}`) setChatLoading(false);
    }
  };
  // Warm the cache for a course's project rooms so their chips open instantly.
  const prefetchProjectRooms = (rooms: ProjectRoom[]) => {
    for (const room of rooms) {
      if (projectCache.current.has(room.id)) continue;
      request(`/api/project-rooms/${room.id}`, {}, token).then((data) => projectCache.current.set(room.id, { projectRoom: data.projectRoom, messages: data.messages })).catch(() => {});
    }
  };
  const closeProjectRoom = () => {
    if (activeProject) socketRef.current?.emit("projectRoomLeave", { projectRoomId: activeProject.id });
    if (activeProject && projectDraft.trim()) socketRef.current?.emit("projectRoomStopTyping", { projectRoomId: activeProject.id });
    clearProjectTypers();
    setActiveProject(null);
    setProjectPanelOpen(false);
    if (isNativeApp) {
      const backToChat = projectReturn.current === "course-group" && activeCourseGroup;
      setTab(backToChat ? "course-group" : "your-courses");
      if (backToChat && courseHome) loadCourseHome(courseHome.id).catch(() => {});
      return;
    }
    setTab(courseHome ? "course-home" : "your-courses");
    if (courseHome) loadCourseHome(courseHome.id).catch(() => {});
  };
  const signalProjectTyping = (typing: boolean) => {
    if (!activeProject) return;
    if (typing) {
      const now = Date.now();
      projectKeyAt.current = now;
      if (projectTypingStopped.current) { projectTypingStopped.current = false; lastProjectTypingSentAt.current = 0; }
      if (now - lastProjectTypingSentAt.current < 900) return;
      lastProjectTypingSentAt.current = now;
      socketRef.current?.emit("projectRoomTyping", { projectRoomId: activeProject.id });
    } else {
      lastProjectTypingSentAt.current = 0;
      socketRef.current?.emit("projectRoomStopTyping", { projectRoomId: activeProject.id });
    }
  };
  const sendProjectMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeProject || (!projectDraft.trim() && !projectAttachment)) return;
    if (tooLong(projectDraft)) { setNotice(`Messages can be up to ${MESSAGE_MAX.toLocaleString()} characters.`); return; }
    const body = projectDraft;
    const attachment = projectAttachment;
    const roomId = activeProject.id;
    // Text shows straight away (faded until confirmed), like course chats.
    const tempId = `pending-${Date.now()}`;
    if (!attachment) setProjectMessages((items) => [...items, { id: tempId, pending: true, body, createdAt: new Date().toISOString(), mine: true, authorAccountId: account?.id || "", author: { displayName: sendAsTeam ? TEAM_NAME : identity.displayName } } as ProjectMessage]);
    setProjectDraft("");
    setProjectAttachment(null);
    signalProjectTyping(false);
    try {
      // Same as course chats: upload the photo/PDF first, then send it with the text.
      const upload = attachment ? await request("/api/chat-attachments", { method: "POST", body: JSON.stringify({ scope: "project-room", parentId: activeProject.id, fileData: attachment.data, fileName: attachment.name }) }, token) : null;
      const data = await request(`/api/project-rooms/${activeProject.id}/messages`, { method: "POST", body: JSON.stringify({ asTeam: sendAsTeam, body, attachmentUrl: upload?.attachmentUrl, attachmentName: upload?.attachmentName, isImage: upload?.isImage }) }, token);
      if (activeProjectIdRef.current === roomId) setProjectMessages((items) => [...items.filter((item) => item.id !== tempId && item.id !== data.message.id), data.message]);
    } catch (error) {
      setProjectMessages((items) => items.filter((item) => item.id !== tempId));
      setProjectDraft((current) => current || body);
      setProjectAttachment((current) => current || attachment);
      setNotice(error instanceof Error ? error.message : "Unable to send your message.");
    }
  };
  const openProjectPicker = (mode: "create" | "invite", group: CourseGroup | null = courseHome, privateGroup = true) => {
    setProjectPicker(mode);
    setInviteOnly(privateGroup);
    setDiscoverFor(null);
    setAllClassmatesShown(false);
    setProjectNameDraft("");
    setProfNameDraft("");
    setPickedMemberIds([]);
    setMemberSearch("");
    // Start empty so a previous course's classmates never flash up; null = still loading.
    setCourseMembers(null);
    if (group) request(`/api/course-groups/${group.id}/members`, {}, token).then((data) => setCourseMembers(data.members)).catch(() => setCourseMembers([]));
  };
  const submitProjectPicker = async (event: FormEvent) => {
    event.preventDefault();
    if (pickerBusyRef.current) return; // a second tap while the first is still saving would make a second group
    pickerBusyRef.current = true;
    setPickerBusy(true);
    try {
      if (projectPicker === "create" && courseHome) {
        const data = await request(`/api/course-groups/${courseHome.id}/project-rooms`, { method: "POST", body: JSON.stringify({ name: inviteOnly ? projectNameDraft : professorName(profNameDraft), memberIds: inviteOnly ? pickedMemberIds : [], isPublic: !inviteOnly }) }, token);
        setProjectPicker(null);
        await loadCourseHome(courseHome.id);
        await openProjectRoom(data.projectRoom.id);
        setMobileMain(true); // phones: show the new room, not the course list it was started from
      } else if (projectPicker === "invite" && activeProject) {
        await request(`/api/project-rooms/${activeProject.id}/members`, { method: "POST", body: JSON.stringify({ memberIds: pickedMemberIds }) }, token);
        setProjectPicker(null);
        await openProjectRoom(activeProject.id);
        setProjectPanelOpen(true);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      pickerBusyRef.current = false;
      setPickerBusy(false);
    }
  };
  const removeProjectMember = async (memberId: string) => {
    if (!activeProject) return;
    const leaving = memberId === account?.id;
    try {
      await request(`/api/project-rooms/${activeProject.id}/members/${memberId}`, { method: "DELETE" }, token);
      if (leaving) {
        closeProjectRoom();
        setProjectPanelOpen(false);
        setMobileMain(false); // phones: back to the course list, not an empty screen
      } else {
        await openProjectRoom(activeProject.id);
        setProjectPanelOpen(true);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update members.");
    }
  };
  const renameProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeProject || !projectRenameDraft.trim()) return;
    try {
      await request(`/api/project-rooms/${activeProject.id}`, { method: "PATCH", body: JSON.stringify({ name: projectRenameDraft }) }, token);
      setActiveProject({ ...activeProject, name: projectRenameDraft.trim() });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to rename the room.");
    }
  };
  // Mute a chat for a while (hours) or until you turn it back on (hours = null); unmute clears both kinds.
  const muteChat = (chatIds: string[], hours: number | null) => {
    setChatMenu(null);
    if (!notifSettings) { setNotice("Notification settings aren't available yet."); return; }
    const mutedUntil = { ...(notifSettings.mutedUntil || {}) };
    for (const id of chatIds) delete mutedUntil[id];
    const others = notifSettings.mutedChats.filter((id) => !chatIds.includes(id));
    if (hours === null) saveNotifSettings({ ...notifSettings, mutedUntil, mutedChats: [...others, ...chatIds] });
    else { const until = new Date(Date.now() + hours * 3600 * 1000).toISOString(); saveNotifSettings({ ...notifSettings, mutedChats: others, mutedUntil: { ...mutedUntil, ...Object.fromEntries(chatIds.map((id) => [id, until])) } }); }
  };
  const unmuteChat = (chatIds: string[]) => {
    setChatMenu(null);
    if (!notifSettings) return;
    const mutedUntil = { ...(notifSettings.mutedUntil || {}) };
    for (const id of chatIds) delete mutedUntil[id];
    saveNotifSettings({ ...notifSettings, mutedUntil, mutedChats: notifSettings.mutedChats.filter((id) => !chatIds.includes(id)) });
  };
  // Clear a chat's unread count without opening it.
  const markChatRead = (menu: { id: string; group?: CourseGroup; room?: ProjectRoom; course?: boolean; ids?: string[] }) => {
    setChatMenu(null);
    if (menu.course && menu.group) {
      // A whole course: its class-chat and every group in it.
      markCourseRead(menu.group.id);
      const roomIds = (menu.ids || []).filter((id) => id !== menu.group?.id);
      setChatPreviews((previews) => ({ ...previews, projectRooms: previews.projectRooms.map((room) => roomIds.includes(room.id) ? { ...room, unreadCount: 0 } : room) }));
      setProjectRooms((rooms) => rooms.map((room) => roomIds.includes(room.id) ? { ...room, unreadCount: 0 } : room));
      for (const id of roomIds) request(`/api/project-rooms/${id}/read`, { method: "POST" }, token).catch(() => {});
      return;
    }
    if (menu.group) { markCourseRead(menu.group.id); return; }
    setChatPreviews((previews) => ({ ...previews, projectRooms: previews.projectRooms.map((room) => room.id === menu.id ? { ...room, unreadCount: 0 } : room) }));
    setProjectRooms((rooms) => rooms.map((room) => room.id === menu.id ? { ...room, unreadCount: 0 } : room));
    request(`/api/project-rooms/${menu.id}/read`, { method: "POST" }, token).catch(() => {});
  };
  const leaveGroupFromList = async (room: ProjectRoom) => {
    setChatMenu(null);
    if (!account || !await askConfirm({ title: `Leave ${room.name}?`, message: room.isPublic ? "You can join again from Discover." : "You'll need a new invite to come back.", action: "Leave group" })) return;
    try {
      await request(`/api/project-rooms/${room.id}/members/${account.id}`, { method: "DELETE" }, token);
      if (activeProject?.id === room.id) { closeProjectRoom(); setMobileMain(false); }
      setChatPreviews((previews) => ({ ...previews, projectRooms: previews.projectRooms.filter((item) => item.id !== room.id) }));
      setProjectRooms((rooms) => rooms.filter((item) => item.id !== room.id));
      request("/api/chats", {}, token).then((data) => setChatPreviews(data)).catch(() => {});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to leave this group.");
    }
  };
  // Long press (phones) or right-click (desktop) on a chat in the list.
  const chatMenuProps = (menu: Omit<ChatMenu, "x" | "y" | "sheet">) => ({
    onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); if (guest) return; setChatMenu({ ...menu, x: event.clientX, y: event.clientY, sheet: !isWide() }); },
    onTouchStart: (event: ReactTouchEvent) => {
      if (guest) return;
      chatHoldFired.current = false;
      holdStart.current = { x: event.touches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? 0 };
      chatHoldTimer.current = window.setTimeout(() => { chatHoldTimer.current = null; chatHoldFired.current = true; navigator.vibrate?.(10); setChatMenu({ ...menu, x: 0, y: 0, sheet: true }); }, 500);
    },
    onTouchMove: (event: ReactTouchEvent) => { if (!movedTooFar(event)) return; if (chatHoldTimer.current) window.clearTimeout(chatHoldTimer.current); chatHoldTimer.current = null; },
    onTouchEnd: () => { if (chatHoldTimer.current) window.clearTimeout(chatHoldTimer.current); chatHoldTimer.current = null; },
    onClickCapture: (event: React.MouseEvent) => { if (chatHoldFired.current) { chatHoldFired.current = false; event.preventDefault(); event.stopPropagation(); } },
  });
  const leaveCourseChat = async (group: CourseGroup) => {
    if (!await askConfirm({ title: `Leave ${group.courseCode}?`, message: `You can rejoin any time from ${NEW_SHELL ? "Add a course" : "Browse courses"}.`, action: "Leave course" })) return;
    if (guest) {
      // Guests only had it on this device.
      const ids = guestCourseIds() || new Set<string>();
      ids.delete(group.id);
      saveGuestCourses(ids);
      setCourseInfoOpen(false);
      closeRooms(() => { leaveRoom(); setTab("your-courses"); });
      setCourseGroups((groups) => groups.map((item) => item.id === group.id ? { ...item, joined: false, unreadCount: 0 } : item));
      return;
    }
    try {
      await request(`/api/course-groups/${group.id}/leave`, { method: "POST" }, token);
      setCourseInfoOpen(false);
      closeRooms(() => { leaveRoom(); setTab("your-courses"); });
      setCourseGroups((groups) => groups.map((item) => item.id === group.id ? { ...item, joined: false, unreadCount: 0 } : item));
      setMobileMain(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to leave this course.");
    }
  };
  // Moderators: delete a whole course chat (everyone is removed and its project rooms close; messages stay hidden on the server).
  const deleteCourseChat = async (group: CourseGroup) => {
    if (!await askConfirm({ title: `Delete the ${group.courseCode} chat?`, message: "Everyone is removed from it and its groups close, for everyone. You can bring it back from Moderation → Deleted.", action: "Delete for everyone" })) return;
    try {
      await request(`/api/admin/course-groups/${group.id}`, { method: "DELETE" }, token);
      setCourseInfoOpen(false);
      closeRooms(() => { leaveRoom(); setTab("your-courses"); });
      setCourseGroups((groups) => groups.filter((item) => item.id !== group.id));
      setMobileMain(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete this course chat.");
    }
  };
  // Discover: the course's public groups you can join.
  const openDiscover = (group: CourseGroup) => {
    setCourseAddMenu(null);
    setCourseHome(group);
    setDiscoverFor(group);
    setDiscoverRooms(null);
    request(`/api/course-groups/${group.id}/project-rooms/discover`, {}, token).then((data) => setDiscoverRooms(data.projectRooms || [])).catch((error) => { setDiscoverRooms([]); setNotice(error instanceof Error ? error.message : "Unable to load groups."); });
  };
  // Discover stays up with "Joining…" until the group is ready, then the group slides in (it used to close at once
  // and leave the previous screen up for a few seconds, which looked like nothing happened).
  const joinPublicRoom = async (roomId: string) => {
    if (joiningRoomId) return;
    setJoiningRoomId(roomId);
    try {
      await request(`/api/project-rooms/${roomId}/join`, { method: "POST" }, token);
      const group = discoverFor;
      if (group) loadCourseHome(group.id).catch(() => {});
      await openProjectRoom(roomId);
      setDiscoverFor(null);
      setMobileMain(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to join this group.");
    } finally {
      setJoiningRoomId(null);
    }
  };
  // Private groups in Discover: ask the creator to let you in (tap again to take the request back).
  const toggleJoinRequest = async (room: { id: string; name: string; createdBy: string; requested?: boolean }) => {
    if (joiningRoomId) return;
    setJoiningRoomId(room.id);
    try {
      await request(`/api/project-rooms/${room.id}/join`, { method: room.requested ? "DELETE" : "POST" }, token);
      setDiscoverRooms((rooms) => rooms && rooms.map((item) => item.id === room.id ? { ...item, requested: !room.requested } : item));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to send your request.");
    } finally {
      setJoiningRoomId(null);
    }
  };
  // The group's creator answers a request to join (from Alerts or Room info).
  const answerJoinRequest = async (projectRoomId: string, requesterId: string, _name: string, approve: boolean) => {
    setNotifications((items) => items.filter((item) => !(item.kind === "join_request" && item.projectRoomId === projectRoomId && item.requesterId === requesterId)));
    const dropRequest = (room: ProjectRoom) => room.id === projectRoomId ? { ...room, joinRequests: (room.joinRequests || []).filter((person) => person.id !== requesterId) } : room;
    setActiveProject((room) => room && dropRequest(room));
    try {
      const data = await request(`/api/project-rooms/${projectRoomId}/requests/${requesterId}/${approve ? "approve" : "decline"}`, { method: "POST" }, token);
      if (data.projectRoom && activeProject?.id === projectRoomId) setActiveProject(data.projectRoom);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to answer that request.");
      loadNotifications().catch(() => {});
    }
  };
  const cancelInvite = async (invite: { id: string; name: string }) => {
    if (!activeProject || !await askConfirm({ title: `Cancel ${invite.name}'s invite?`, message: "They won't be able to join unless you invite them again.", action: "Cancel invite", cancel: "Keep invite" })) return;
    try {
      await request(`/api/project-rooms/${activeProject.id}/invites/${invite.id}`, { method: "DELETE" }, token);
      setActiveProject((room) => room ? { ...room, pendingInvites: (room.pendingInvites || []).filter((item) => item.id !== invite.id) } : room);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to cancel the invite.");
    }
  };
  const deleteProject = async () => {
    if (!activeProject || !await askConfirm({ title: `Delete ${activeProject.name}?`, message: "The group and all its messages are deleted for everyone. This can't be undone.", action: "Delete group" })) return;
    try {
      await request(`/api/project-rooms/${activeProject.id}`, { method: "DELETE" }, token);
      closeProjectRoom();
      setProjectPanelOpen(false);
      setMobileMain(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete the room.");
    }
  };
  const markCourseRead = (groupId: string) => {
    setCourseGroups((groups) => groups.map((group) => group.id === groupId ? { ...group, unreadCount: 0 } : group));
    return request(`/api/course-groups/${groupId}/read`, { method: "POST" }, token).catch(() => {});
  };
  const loadApp = async () => {
    // Each part is shown as soon as it arrives (no waiting for the slowest one) and remembered,
    // so the next launch can show it straight away (see the snapshot effect below).
    const saving = token;
    const remember = (part: keyof AppSnapshot, data: unknown) => saveSnapshot(saving, part, data);
    loadNotifications().catch(() => {});
    request("/api/blocks", {}, token).then((data) => setBlockedPeople(Array.isArray(data.blocked) ? data.blocked : [])).catch(() => {});
    if (account?.isAdmin) request("/api/admin/summary", {}, token).then((data) => setOpenReportCount(data.openReports)).catch(() => {});
    if (NEW_SHELL) request("/api/chats", {}, token).then((data) => { setChatPreviews(data); remember("chats", data); }).catch(() => {});
    // Rooms are hidden while ROOMS_ENABLED is off, so they aren't fetched.
    if (ROOMS_ENABLED) request("/api/rooms", {}, token).then((data) => setRooms(data.rooms)).catch(() => {});
    await Promise.all([
      request("/api/identity", {}, token).then((data) => { applyIdentity(data); remember("identity", data); }),
      request("/api/social/posts", {}, token).then((data) => { setPosts(data.posts); remember("posts", data); }),
      request("/api/course-groups", {}, token).then((data) => { applyGroups(data); remember("groups", data); }),
      request("/api/course-requests", {}, token).catch(() => ({ requests: [], setupRequired: true })).then((data) => { applyRequests(data); remember("requests", data); }),
    ]);
  };
  const applyIdentity = (identityData: any) => {
    setIdentity({ ...identityData.profile, bio: identityData.profile.bio || "" });
    setIdentityLoaded(true);
    setSavedUsername(identityData.profile.displayName || "");
    if (Number.isInteger(identityData.profile.avatarColor)) setAvatarColor(identityData.profile.displayName, identityData.profile.avatarColor);
  };
  const applyGroups = (groupsData: any) => {
    setGroupsReady(true);
    // Guests add courses on this device only (they aren't members, so counts stay real students).
    const local = guestCourseIds();
    // Course forums replace the chats, so the chats' unread counts don't show.
    const groups = COURSE_FORUM ? groupsData.groups.map((group: CourseGroup) => ({ ...group, unreadCount: 0 })) : groupsData.groups;
    setCourseGroups(local ? groups.map((group: CourseGroup) => ({ ...group, joined: local.has(group.id) })) : groups);
    setCourseTerms(groupsData.terms || []);
    setCurrentTermName(groupsData.term?.name || "");
    setClassmateCount(groupsData.classmates || 0);
    setCurrentTermId(groupsData.term?.id || "");
    setDegree(groupsData.degree || null);
  };
  const applyRequests = (requestsData: any) => {
    setCourseRequests(requestsData.requests || []);
    setCourseRequestsSetup(requestsData.setupRequired !== true);
  };
  // Instant start: with a saved login, show what this device loaded last time (courses, degree, chats, posts)
  // before the first paint, and open the app right away; /api/me and loadApp then refresh everything.
  useLayoutEffect(() => {
    const snapshot = readSnapshot(token);
    if (!snapshot) return;
    if (snapshot.identity) applyIdentity(snapshot.identity);
    if (snapshot.groups) applyGroups(snapshot.groups);
    if (snapshot.requests) applyRequests(snapshot.requests);
    if (snapshot.posts) setPosts(snapshot.posts.posts);
    if (snapshot.chats) setChatPreviews(snapshot.chats);
    if (snapshot.account && (snapshot.account.isGuest || (!snapshot.account.needsPassword && snapshot.account.ageConfirmed && snapshot.account.termsAccepted !== false))) {
      setAccount(snapshot.account);
      setScreen((current) => current === "loading" ? "app" : current);
    }
  }, []);
  useEffect(() => {
    if (!token) return;
    request("/api/me", {}, token)
      .then(({ account: next }) => {
        setAccount(next);
        saveSnapshot(token, "account", next);
        setNotice((current) => current.startsWith("Can't reach CCConnect") ? "" : current);
        setScreen(
          // Visitors (guests) go straight in: no password, name or Terms (the Terms + 18+ come at sign-up).
          next.isGuest ? "app" : next.needsPassword ? "password" : next.ageConfirmed && next.termsAccepted !== false ? "app" : "age",
        );
        if (!next.isGuest) forgetVisitor();
      })
      .catch((error: Error & { status?: number }) => {
        // Only a rejected session logs you out; a restarting or unreachable server should not.
        if (error.status !== 401 && error.status !== 403) {
          setNotice("Can't reach CCConnect right now. Retrying…");
          window.setTimeout(() => setSessionRetry((count) => count + 1), 4000);
          return;
        }
        localStorage.removeItem("mixby-token");
        clearSnapshot();
        setToken("");
        setAccount(null);
        // An expired login (or a visitor login that was cleaned up) carries on browsing as a visitor.
        setScreen((current) => current === "loading" || current === "app" ? "loading" : current);
        enterAsVisitor();
      });
  }, [token, sessionRetry]);
  // First open without a login: become a visitor straight away.
  useEffect(() => { if (!localStorage.getItem("mixby-token")) enterAsVisitor(); }, []);
  useEffect(() => {
    if (screen === "app") loadApp().catch((error) => setNotice(error.message));
  }, [screen, guest]);
  useEffect(() => {
    // A message from sign-up or log-in ("You already have a CCConnect account…") belongs to that screen: it must not follow
    // you into the app as a toast that never goes away.
    if (screen === "app" && notice && noticeScreen && noticeScreen !== "app") { setNoticeScreen("app"); setNotice(""); return; }
    setNoticeScreen(screen);
    // In the app, notices are toasts that dismiss themselves.
    if (!notice || screen !== "app") return;
    const timer = window.setTimeout(() => setNotice(""), notice.length > 60 ? 5000 : 3000);
    return () => window.clearTimeout(timer);
  }, [notice, screen]);
  // Keep announcing "typing" for as long as an unsent draft exists (even if the box loses focus).
  const hasRoomDraft = roomDraft.trim().length > 0;
  useEffect(() => {
    if (!activeRoom || !hasRoomDraft) return;
    const timer = window.setInterval(() => {
      socketRef.current?.emit("roomTyping", { roomId: activeRoom.id });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeRoom?.id, hasRoomDraft]);
  // Course and group chats: "typing" is re-announced only while you're actually typing. After 4 seconds without a
  // keystroke the others are told you've stopped (their bubble goes away), even if your draft is still there;
  // typing again brings it back.
  const hasProjectDraft = projectDraft.trim().length > 0;
  useEffect(() => {
    if (!activeProject || !hasProjectDraft) return;
    const roomId = activeProject.id;
    const timer = window.setInterval(() => {
      if (Date.now() - projectKeyAt.current < TYPING_IDLE_MS) socketRef.current?.emit("projectRoomTyping", { projectRoomId: roomId });
      else if (!projectTypingStopped.current) { projectTypingStopped.current = true; lastProjectTypingSentAt.current = 0; socketRef.current?.emit("projectRoomStopTyping", { projectRoomId: roomId }); }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeProject?.id, hasProjectDraft]);
  const hasCourseDraft = coursePostBody.trim().length > 0;
  useEffect(() => {
    if (!activeCourseGroup || !hasCourseDraft) return;
    const groupId = activeCourseGroup.id;
    const timer = window.setInterval(() => {
      if (Date.now() - courseKeyAt.current < TYPING_IDLE_MS) socketRef.current?.emit("courseGroupTyping", { groupId });
      else if (!courseTypingStopped.current) { courseTypingStopped.current = true; lastCourseTypingSentAt.current = 0; socketRef.current?.emit("courseGroupStopTyping", { groupId }); }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeCourseGroup?.id, hasCourseDraft]);
  useEffect(() => {
    if (!token || guest || screen !== "app") return;
    const recheck = () => {
      if (document.visibilityState !== "visible") return;
      loadNotifications().catch(() => {});
      refreshCourseGroups().catch(() => {});
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    const backstop = window.setInterval(recheck, 30000);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      window.clearInterval(backstop);
    };
  }, [token, guest, screen]);
  // A course chat that disappears while open (deleted by a moderator, or reset at the end of term) closes with a
  // message instead of staying on screen with a message bar that can't send. Only courses that were in the list
  // before count, so a course you've just created or joined isn't closed while the list catches up.
  useEffect(() => {
    if (!courseInfoOpen || !isAdmin || !activeCourseGroup || activeCourseGroup.isDegree) return;
    setModRooms(null);
    request(`/api/admin/course-groups/${activeCourseGroup.id}/project-rooms`, {}, token).then((data) => setModRooms(data.projectRooms || [])).catch(() => setModRooms([]));
  }, [courseInfoOpen, activeCourseGroup?.id]);
  const moderatorDeleteRoom = async (room: { id: string; name: string; memberCount: number }) => {
    if (!await askConfirm({ title: `Delete ${room.name}?`, message: `The group and all its messages are deleted for its ${room.memberCount} member${room.memberCount === 1 ? "" : "s"}. This can't be undone.`, action: "Delete group" })) return;
    try {
      await request(`/api/project-rooms/${room.id}`, { method: "DELETE" }, token);
      setModRooms((rooms) => (rooms || []).filter((item) => item.id !== room.id));
      if (courseHome) loadCourseHome(courseHome.id).catch(() => {});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete the group.");
    }
  };
  // Your chats: which "chat changed" events concern you, and a one-time preload of their messages after sign-in so
  // the first open of each is instant too (a few at a time, newest activity first, in the background).
  useEffect(() => {
    const mine = courseGroups.filter((group) => group.joined);
    myChatIdsRef.current = new Set([...mine.map((group) => group.id), ...(degree?.groupId ? [degree.groupId] : []), ...(activeCourseGroup ? [activeCourseGroup.id] : [])]);
    if (prefetchedChats.current || guest || !token || screen !== "app" || mine.length === 0) return;
    prefetchedChats.current = true;
    // Chats saved on this device are refreshed too (they may have missed messages while the app was closed),
    // and the open chat is left alone (it loads itself).
    const queue = mine.slice(0, 12);
    const next = () => {
      const group = queue.shift();
      if (!group) return;
      const isOpen = () => openingChat.current === `course:${group.id}`;
      Promise.all([
        request(`/api/course-groups/${group.id}/posts`, {}, token).then((data) => { if (!isOpen()) courseCache.current.set(group.id, data.posts); }),
        request(`/api/course-groups/${group.id}/members`, {}, token).then((data) => { membersCache.current.set(group.id, data.members); }),
      ]).catch(() => {}).finally(next);
    };
    next(); next(); next();
  }, [courseGroups, degree?.groupId, screen]);
  // Your project groups load in the background once after sign-in too, so the first tap on one is instant.
  const prefetchedGroups = useRef(false);
  useEffect(() => {
    if (prefetchedGroups.current || guest || !token || screen !== "app" || chatPreviews.projectRooms.length === 0) return;
    prefetchedGroups.current = true;
    const queue = chatPreviews.projectRooms.slice(0, 12);
    const next = () => {
      const room = queue.shift();
      if (!room) return;
      request(`/api/project-rooms/${room.id}`, {}, token)
        .then((data) => { if (openingChat.current !== `project:${room.id}`) projectCache.current.set(room.id, { projectRoom: data.projectRoom, messages: data.messages }); })
        .catch(() => {}).finally(next);
    };
    next(); next();
  }, [chatPreviews.projectRooms, screen]);
  // Signing out forgets every chat this window remembers, so the next account never sees (or saves) them.
  useEffect(() => {
    if (token) return;
    courseCache.current.clear(); projectCache.current.clear(); membersCache.current.clear(); roomsCache.current.clear();
    prefetchedChats.current = false; prefetchedGroups.current = false;
  }, [token]);
  // Keep the chat caches on this device (checked every few seconds and when the app goes to the background).
  useEffect(() => {
    if (!token || guest) return;
    let saved = "";
    const save = () => {
      const trim = <T,>(items: T[]) => items.slice(-CHAT_CACHE_KEEP);
      const data: ChatCacheData = {
        course: Object.fromEntries([...courseCache.current].slice(-20).map(([id, posts]) => [id, trim(posts.filter((post) => !post.id.startsWith("pending-")))])),
        project: Object.fromEntries([...projectCache.current].slice(-20).map(([id, entry]) => [id, { projectRoom: entry.projectRoom, messages: trim(entry.messages) }])),
        members: Object.fromEntries([...membersCache.current].slice(-20)),
      };
      const text = JSON.stringify(data);
      if (text !== saved) { writeChatCache(token, data); saved = text; }
    };
    const timer = window.setInterval(save, 8000);
    const onHide = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", save); };
  }, [token, guest]);
  // The open chat's saved copy always matches the screen (messages you send, react to or delete included), so
  // leaving and coming back never shows an older version. Not while it's still loading, so an empty list
  // can't be saved as the chat.
  useEffect(() => {
    if (chatLoading) return;
    if (tab === "course-group" && activeCourseGroup && courseGroupPosts.length) courseCache.current.set(activeCourseGroup.id, courseGroupPosts);
  }, [courseGroupPosts, chatLoading]);
  useEffect(() => {
    if (chatLoading || tab !== "project-room" || !activeProject) return;
    const cached = projectCache.current.get(activeProject.id);
    if (cached && projectMessages.length) projectCache.current.set(activeProject.id, { ...cached, messages: projectMessages });
  }, [projectMessages, chatLoading]);
  // Message boxes grow while you type; once one is emptied (sent, or cleared) it goes straight back to one line.
  useEffect(() => {
    document.querySelectorAll<HTMLTextAreaElement>(".mx-composer textarea, .chat-composer textarea").forEach((box) => { if (!box.value) box.style.height = ""; });
  }, [coursePostBody, projectDraft, commentDraft]);
  const knownCourseIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(courseGroups.map((group) => group.id));
    const open = activeCourseGroup;
    if (tab === "course-group" && open && !open.isDegree && knownCourseIds.current.has(open.id) && !ids.has(open.id)) {
      setCourseInfoOpen(false);
      setTab(!DEGREE_FORUM ? FORUM_HOME : degree ? "degree-posts" : "your-courses");
      setMobileMain(false);
    }
    knownCourseIds.current = ids;
  }, [courseGroups]);
  // New shell: first time without a degree, open the picker once.
  useEffect(() => {
    if (!NEW_SHELL || !DEGREE_FORUM || guest || screen !== "app" || !account || !identityLoaded || degreePromptShown.current) return;
    // A degree picked on the homepage before signing up: join it and land in its Forum (accounts that
    // already have a degree keep theirs).
    const pending = readPendingDegree();
    if (pending) { savePendingDegree(null); setJoinDegree(null); }
    if (account.degreeId) return;
    degreePromptShown.current = true;
    if (pending) { chooseDegree(pending); return; }
    setDegreePickerOpen(true);
    setMobileMain(true);
    loadDegrees();
  }, [screen, account?.id, identityLoaded, guest]);
  // Visitors have no sidebar, so the page is always the screen (phones too).
  useEffect(() => { if (account?.isGuest && !mobileMain) setMobileMain(true); }, [account?.isGuest, mobileMain]);
  // Visitors with nothing open land in the General Forum (posts from every course).
  useEffect(() => {
    if (!NEW_SHELL || screen !== "app" || !account?.isGuest || tab !== "your-courses") return;
    setTab("general-forum"); // a remembered course chat (mixby-last-chat) still reopens a moment later
    setMobileMain(true);
  }, [screen, account?.isGuest, tab]);
  // New shell on desktop: open your degree's Posts page when nothing is selected.
  useEffect(() => {
    if (!NEW_SHELL || screen !== "app" || (DEGREE_FORUM && !degree) || tab !== "your-courses" || degreePickerOpen || !window.matchMedia("(min-width: 900px)").matches) return;
    setTab(FORUM_HOME);
  }, [screen, degree?.groupId, tab]);
  // New shell: keep the Project rooms list and previews fresh as you move around.
  useEffect(() => {
    if (!NEW_SHELL || guest || !token || screen !== "app") return;
    request("/api/chats", {}, token).then((data) => setChatPreviews(data)).catch(() => {});
  }, [tab, activeProject?.id, screen]);
  // iOS app: a project room's chip row needs its course's rooms, even when opened from a notification.
  useEffect(() => {
    if (!isNativeApp || tab !== "project-room" || !activeProject) return;
    if (!projectRooms.some((room) => room.courseGroupId === activeProject.courseGroupId)) loadCourseHome(activeProject.courseGroupId).catch(() => {});
  }, [tab, activeProject?.id]);
  useEffect(() => {
    // Degree info opened from the banner stays open (it's a page of its own, not a chat's info panel).
    if (infoFromBanner.current && tab === "course-group" && activeCourseGroup?.isDegree) return;
    infoFromBanner.current = false;
    setCourseInfoOpen(false); setCourseQrOpen(false);
  }, [tab, activeCourseGroup?.id]);
  useEffect(() => {
    const groupId = pendingCourseLink.current;
    if (!groupId || screen !== "app" || courseGroups.length === 0) return;
    pendingCourseLink.current = null;
    window.history.replaceState(null, "", window.location.pathname);
    const group = courseGroups.find((candidate) => candidate.id === groupId);
    if (group) { openCourseGroup(group); setRailPanel("courses"); setMobileMain(true); } // phones: show the chat, not the list
    else setNotice("That course isn't available this term.");
  }, [screen, courseGroups]);
  // ccconnect.app/?post=<id> (Share on a post) opens that post once the feed has loaded.
  useEffect(() => {
    const postId = pendingPostLink.current;
    if (!postId || screen !== "app" || posts.length === 0) return;
    pendingPostLink.current = null;
    window.history.replaceState(null, "", window.location.pathname);
    const post = posts.find((candidate) => candidate.id === postId);
    if (post) { openComments(post); setMobileMain(true); return; }
    // Not a Dev Post: maybe one from your degree's Posts page.
    loadDegreePosts().then((items) => {
      const match = items.find((candidate) => candidate.id === postId);
      if (match) { openComments(match); setMobileMain(true); } else setNotice("That post is no longer available.");
    }).catch(() => setNotice("That post is no longer available."));
  }, [screen, posts]);
  // Your degree's Posts page follows your degree (loaded on sign-in and when you change degree).
  useEffect(() => {
    degreeIdRef.current = degree?.id || null;
    loadDegreePosts().catch(() => {});
  }, [degree?.id]);
  // A course's invite link (same address as its QR code): phones get the share sheet, computers copy it.
  const shareCourseLink = async (group: CourseGroup) => {
    const url = courseLink(group.id);
    try {
      if ((isNativeApp || touchScreen) && navigator.share) { await navigator.share({ title: `${courseLabel(group)} on CCConnect`, url }); return; }
      await navigator.clipboard.writeText(url);
    } catch { /* closed the share sheet */ }
  };
  // Share a post: the phone's share sheet when there is one, otherwise copy the link.
  const sharePost = async (post: Post) => {
    const url = postLink(post.id);
    const title = post.body.split("\n\n")[0];
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
    } catch { /* closed the share sheet */ }
  };
  // A note photo open full screen (black page, so the status bar and home indicator strips go black too).
  const [noteViewer, setNoteViewer] = useState<string | null>(null);
  // Esc closes a full-screen photo (website).
  useEffect(() => {
    if (!noteViewer && !commentPhotoView) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { setNoteViewer(null); setCommentPhotoView(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [noteViewer, commentPhotoView]);
  // The Camera / Gallery menu that pops up from a note's photo button (ChatGPT-style).
  const [notePhotoMenu, setNotePhotoMenu] = useState(false);
  // iOS app: apply the theme, and colour the strips behind the status bar / home indicator to match the screen's
  // top bar and whatever sits at the bottom (the tab bar, a chat's message bar, or an info page).
  useEffect(() => {
    if (!isNativeApp && !NEW_SHELL) return;
    // Dark mode is for inside the app: the homepage and the sign-up / log-in screens are always light.
    const dark = darkMode;
    document.documentElement.classList.toggle("theme-dark", dark);
    try { localStorage.setItem("mixby-theme", theme); } catch { /* private mode */ }
    if (!isNativeApp) return;
    if (NEW_SHELL) {
      // New shell: strips match the chat (white) or everything else (the course list, Dev Posts, Alerts,
      // Profile and their pages share one background), so toggling the side nav never changes their colour.
      const surface = dark ? "#1b1b1e" : "#ffffff";
      const page = dark ? "#151517" : "#fafaf8";
      const inChatView = mobileMain && (tab === "course-group" || tab === "project-room") && !courseInfoOpen && !projectPanelOpen && !courseQrOpen && !degreePickerOpen && !notifSettingsOpen && !profilePage;
      const strip = screen !== "app" ? (dark ? "#151517" : "#fffdf9") : inChatView ? surface : page;
      // The side rail is on screen (course list, or a Dev Posts/Alerts/Profile small view): its own colour above and below it.
      // Measured again a moment later too, because the shell may not be on the page yet when this runs.
      const toHex = (rgb: string) => { const parts = rgb.match(/[\d.]+/g); return parts && parts.length >= 3 && (parts.length < 4 || Number(parts[3]) > 0) ? `#${parts.slice(0, 3).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}` : undefined; };
      const apply = () => {
        const railElement = screen === "app" && !mobileMain ? document.querySelector<HTMLElement>(".mx-rail") : null;
        const railBox = railElement?.getBoundingClientRect();
        // Only when the rail is really on screen: not hidden, at the left edge, and not covered by the page layer
        // (checked on the page itself, so a slide still in progress can't leave a grey patch in the status bar).
        const mainBox = document.querySelector<HTMLElement>(".mx > .mx-main")?.getBoundingClientRect();
        const covered = Boolean(mainBox && railBox && mainBox.left <= railBox.left + 1 && mainBox.width > 0);
        const rail = railElement && railBox && railBox.left <= 1 && railBox.width > 0 && !covered ? toHex(getComputedStyle(railElement).backgroundColor) : undefined;
        if (noteViewer) return setAppChrome({ top: "#000000", bottom: "#000000", dark: true, webKeyboard: true, rail: undefined, railWidth: 0 });
        // With the rail showing, the whole status-bar strip takes the rail colour, so the course list sits in it as a
        // card (Discord-style).
        setAppChrome({ top: rail || strip, bottom: strip, dark, webKeyboard: screen === "app", rail, railWidth: rail ? railBox?.width : 0 });
      };
      apply();
      // Again once the screen has finished sliding (the slides take ~0.4 s).
      const timers = [window.setTimeout(apply, 350), window.setTimeout(apply, 650)];
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }
    const inChat = screen === "app" && (tab === "course-group" || tab === "project-room");
    const infoPage = inChat && (courseInfoOpen || projectPanelOpen);
    const bar = dark ? "#161616" : "#fffdf9";
    const bottom = inChat && courseQrOpen ? (dark ? "#000000" : "#ffffff") : infoPage ? (dark ? "#000000" : "#f2f2f4") : inChat ? (dark ? "#161616" : "#f6f6f6") : bar;
    setAppChrome({ top: screen === "app" ? bar : dark ? "#151517" : "#fffdf9", bottom: screen === "app" ? bottom : dark ? "#151517" : "#fffdf9", dark });
  }, [theme, darkMode, tab, screen, courseInfoOpen, projectPanelOpen, courseQrOpen, mobileMain, degreePickerOpen, notifSettingsOpen, profilePage, noteViewer]);
  // iOS app: refresh the Chats list previews whenever the tab is shown.
  useEffect(() => {
    if (!isNativeApp || guest || !token || tab !== "your-courses") return;
    request("/api/chats", {}, token).then((data) => setChatPreviews(data)).catch(() => {});
  }, [tab, token, guest]);
  // iOS app: register this device for push once signed in, and open whatever a tapped notification points at.
  useEffect(() => onPushTap(setPushTap), []);
  // Website: the service worker (notifications only) and taps on its notifications while CCConnect is open.
  useEffect(() => { if (isNativeApp) return; registerServiceWorker(); return onWebPushTap((data) => setPushTap(data)); }, []);
  const webPushKey = useRef<string | null | undefined>(undefined);
  const refreshWebPush = async () => {
    if (isNativeApp) return;
    if (!webPushSupported()) { setWebPushState(isIOS() && !isStandalone() ? "needs-install" : "unsupported"); return; }
    if (webPushKey.current === undefined) webPushKey.current = (await request("/api/web-push/key", {}).catch(() => ({ publicKey: null }))).publicKey || null;
    if (!webPushKey.current) { setWebPushState("unavailable"); return; }
    if (Notification.permission === "denied") { setWebPushState("denied"); return; }
    const subscription = Notification.permission === "granted" ? await currentSubscription() : null;
    setWebPushState(subscription ? "on" : "off");
    return subscription;
  };
  // Signed in on a browser that already allowed notifications: make sure they go to this account (a subscription
  // belongs to whoever last signed in on that browser, like the app's device tokens).
  useEffect(() => {
    if (isNativeApp || !token || guest || screen !== "app") return;
    refreshWebPush().then((subscription) => {
      if (subscription) request("/api/web-push/subscriptions", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON() }) }, token).catch(() => {});
    }).catch(() => {});
  }, [token, guest, screen]);
  // Turn website notifications on (must come from a tap: iPhone only asks then) or off, for this device only.
  const enableWebPush = async () => {
    if (webPushBusy) return;
    // iPhone only shows "Allow notifications?" if it's asked at the very start of the tap, before anything else
    // waits (a server call first used up the tap and the popup silently never appeared).
    const asking = webPushSupported() && Notification.permission === "default" ? Notification.requestPermission().catch(() => Notification.permission) : null;
    setWebPushBusy(true);
    try {
      const permission = asking ? await asking : Notification.permission;
      if (permission === "denied") { setWebPushState("denied"); return; }
      if (permission !== "granted") { setNotice("Notifications weren't allowed. Tap Turn on again and choose Allow."); return; }
      if (!webPushKey.current) { await refreshWebPush(); if (!webPushKey.current) { setNotice("Notifications aren't available right now. Try again in a minute."); return; } }
      const { subscription, problem } = await subscribeToPush(webPushKey.current);
      if (problem === "denied") { setWebPushState("denied"); return; }
      if (!subscription) { setNotice("Couldn't turn on notifications on this device. Try again."); return; }
      await request("/api/web-push/subscriptions", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON() }) }, token);
      setWebPushState("on");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't turn on notifications.");
    } finally {
      setWebPushBusy(false);
    }
  };
  const disableWebPush = async () => {
    if (webPushBusy) return;
    setWebPushBusy(true);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await request("/api/web-push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }, token).catch(() => {});
        await subscription.unsubscribe().catch(() => false);
      }
      setWebPushState("off");
    } finally {
      setWebPushBusy(false);
    }
  };
  // Re-check when the Notifications or CCConnect App page opens, and when coming back from iPhone Settings.
  useEffect(() => {
    if (isNativeApp || !token || guest) return;
    if (notifSettingsOpen || tab === "app-info") refreshWebPush().catch(() => {});
    const onShow = () => { if (document.visibilityState === "visible" && (notifSettingsOpen || tab === "app-info")) refreshWebPush().catch(() => {}); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [notifSettingsOpen, tab, token, guest]);
  // Send a test notification to my own devices and say what happened to each (to find why one doesn't arrive).
  const sendPushTest = async () => {
    setPushTestResult("Sending…");
    try {
      const data = await request("/api/push-test", { method: "POST" }, token);
      const lines = [
        ...(data.app || []).map((item: { result: string }) => `iPhone app: ${item.result}`),
        ...(data.web || []).map((item: { host: string; result: string }) => `${item.host.includes("apple") ? "Home Screen app (iPhone)" : item.host.includes("google") ? "Chrome / Android" : item.host}: ${item.result}`),
      ];
      setPushTestResult(lines.length ? lines.join(" · ") : "No devices are signed up for notifications on this account yet. Tap Turn on first.");
    } catch (error) {
      setPushTestResult(error instanceof Error ? error.message : "Couldn't send a test.");
    }
  };
  const startInstall = async () => {
    if (canPromptInstall()) { await promptInstall(); return; }
    setInstallHelpOpen(true);
  };
  useEffect(() => {
    if (!token || guest || screen !== "app" || !identityLoaded || import.meta.env.VITE_SCREENSHOTS === "true") return; // no permission prompt in screenshot builds
    enablePush((deviceToken) => { request("/api/push-tokens", { method: "POST", body: JSON.stringify({ token: deviceToken }) }, token).catch(() => {}); }).catch(() => {});
  }, [token, guest, screen, identityLoaded]);
  useEffect(() => {
    if (!pushTap || !token || guest || screen !== "app" || !identityLoaded) return;
    setPushTap(null);
    // A new report (moderators only): straight to the Moderation page.
    if (pushTap.kind === "report") { if (account?.isAdmin) { if (!devMode) toggleDevMode(true); setNotifSettingsOpen(false); setTab("profile"); setProfilePage("moderation"); setModView("open"); loadModeration("open").catch(() => {}); setMobileMain(true); } return; }
    // Course requests and Contact CCConnect messages open their Moderation tab; an accepted course request opens the course.
    if (pushTap.kind === "course_request" || pushTap.kind === "contact") { if (account?.isAdmin) { const view = pushTap.kind === "contact" ? "messages" : "courses"; if (!devMode) toggleDevMode(true); setNotifSettingsOpen(false); setTab("profile"); setProfilePage("moderation"); setModView(view); loadModeration(view).catch(() => {}); setMobileMain(true); } return; }
    if (pushTap.kind === "course_live" && pushTap.courseGroupId) { openNotification({ id: "", kind: "course_live", courseGroupId: pushTap.courseGroupId, postTitle: "", actorName: "", preview: "", createdAt: "", unread: false }).catch(() => {}); return; }
    if (!pushTap.projectRoomId && !pushTap.postId) return;
    if (pushTap.kind === "project_invite" || pushTap.kind === "join_request") { if (isNativeApp) openAlerts(); else setNotificationsOpen(true); loadNotifications().catch(() => {}); return; }
    openNotification({ id: "", kind: pushTap.projectRoomId ? "project_invite" : "post_comment", postId: pushTap.postId, projectRoomId: pushTap.projectRoomId, courseGroupId: pushTap.courseGroupId, postTitle: "", actorName: "", preview: "", createdAt: "", unread: false }).catch(() => {});
  }, [pushTap, token, guest, screen, identityLoaded]);
  useEffect(() => {
    activeRoomIdRef.current = activeRoom?.id || null;
  }, [activeRoom?.id]);
  // My posts (Dev Posts and my Degree Forum posts): a comment on one of them changes my notifications.
  useEffect(() => {
    myPostIdsRef.current = new Set([...posts, ...degreePosts].filter((post) => post.isMine).map((post) => post.id));
  }, [posts, degreePosts]);
  // On screen or in the background: the server sends message notifications only while CCConnect isn't on screen.
  useEffect(() => {
    const report = () => socketRef.current?.emit("appState", { foreground: document.visibilityState === "visible" });
    document.addEventListener("visibilitychange", report);
    const leaving = () => socketRef.current?.emit("appState", { foreground: false });
    window.addEventListener("pagehide", leaving);
    return () => { document.removeEventListener("visibilitychange", report); window.removeEventListener("pagehide", leaving); };
  }, []);
  // Website: unread messages in the browser tab's title ("(3) CCConnect"), so they show from another tab.
  useEffect(() => {
    if (isNativeApp) return;
    const chats = courseGroups.reduce((total, group) => total + (group.joined ? group.unreadCount || 0 : 0), 0) + chatPreviews.projectRooms.reduce((total, room) => total + (room.unreadCount || 0), 0);
    const total = screen === "app" && !guest ? chats : 0; // messages only (alerts also list messages, so adding them would double-count)
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) CCConnect` : "CCConnect — student communities, starting at York";
  }, [courseGroups, chatPreviews.projectRooms, screen, guest]);
  useEffect(() => {
    activeProjectIdRef.current = activeProject?.id || null;
  }, [activeProject?.id]);
  useEffect(() => {
    courseHomeIdRef.current = courseHome?.id || null;
  }, [courseHome?.id]);
  useEffect(() => {
    activeCommentPostIdRef.current = commentPost?.id || null;
  }, [commentPost?.id]);
  useEffect(() => {
    activeCourseGroupIdRef.current = activeCourseGroup?.id || null;
    if (activeCourseGroup?.id) myChatIdsRef.current.add(activeCourseGroup.id);
  }, [activeCourseGroup?.id]);
  // A chat only counts as read while it's really on screen: on phones the chat layer must be showing (not the
  // course list), and the app must be in the foreground. Coming back to it marks it read then.
  const chatOnScreenRef = useRef(true);
  // In the iOS app "in front" is enough; on a computer the CCConnect window must be the focused one (like Discord).
  const appInFront = () => typeof document === "undefined" || (document.visibilityState === "visible" && (isNativeApp || document.hasFocus()));
  const [appVisible, setAppVisible] = useState(appInFront);
  useEffect(() => {
    const update = () => setAppVisible(appInFront());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => { document.removeEventListener("visibilitychange", update); window.removeEventListener("focus", update); window.removeEventListener("blur", update); };
  }, []);
  useEffect(() => {
    const onScreen = appVisible && (!NEW_SHELL || mobileMain || window.matchMedia("(min-width: 900px)").matches);
    chatOnScreenRef.current = onScreen;
    if (!onScreen || guest || screen !== "app") return;
    if (tab === "course-group" && activeCourseGroup) markCourseRead(activeCourseGroup.id).then(() => refreshCourseGroups().catch(() => {}));
    if (tab === "project-room" && activeProject) {
      request(`/api/project-rooms/${activeProject.id}/read`, { method: "POST" }, token).catch(() => {});
      setChatPreviews((current) => ({ ...current, projectRooms: current.projectRooms.map((room) => room.id === activeProject.id ? { ...room, unreadCount: 0 } : room) }));
    }
  }, [appVisible, mobileMain, tab, activeCourseGroup?.id, activeProject?.id]);
  useEffect(() => () => {
    roomTypingTimers.current.forEach((timer) => window.clearTimeout(timer));
    courseGroupTypingTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);
  useEffect(() => {
    if (!token || screen !== "app") return;
    // Guests connect with their guest login too: they watch course chats live (read-only, names hidden by the server).
    const socket = io(API, { auth: { token } });
    socketRef.current = socket;
    // Live features (typing, presence, chat) depend on this connection, so surface failures instead of hiding them.
    // A failed connection is only worth mentioning if it keeps failing: a server redeploy drops everyone for a few
    // seconds and the app reconnects by itself, so a pop-up then just alarmed people.
    let connectFailures = 0;
    socket.on("connect_error", () => { connectFailures += 1; if (connectFailures === 6) setNotice("Can't reach CCConnect right now. Messages will catch up when the connection is back."); });
    let connectedBefore = false;
    socket.on("connect", () => {
      connectFailures = 0;
      // Tell the server whether CCConnect is on screen (it skips message notifications while it is).
      socket.emit("appState", { foreground: document.visibilityState === "visible" });
      // Channel membership is lost on reconnect (e.g. a server restart), so re-join whatever is open.
      const groupId = activeCourseGroupIdRef.current;
      if (groupId) socket.emit("courseGroupJoin", { groupId });
      const roomId = activeRoomIdRef.current;
      if (roomId) socket.emit("roomJoin", { roomId });
      const projectRoomId = activeProjectIdRef.current;
      if (projectRoomId) socket.emit("projectRoomJoin", { projectRoomId });
      // After a reconnect, catch up on whatever was sent while we were cut off (messages, reactions, pins, counts).
      if (connectedBefore) {
        refreshCourseGroups().catch(() => {});
        if (!guest) {
          loadNotifications().catch(() => {});
          request("/api/chats", {}, token).then((data) => setChatPreviews(data)).catch(() => {});
        }
        if (groupId) request(`/api/course-groups/${groupId}/posts`, readAuth(), token).then((data) => { if (groupId === activeCourseGroupIdRef.current && reactionsSaving.current === 0) setCourseGroupPosts(data.posts); rememberJoins(groupId, data.joins); }).catch(() => {});
        if (projectRoomId) request(`/api/project-rooms/${projectRoomId}`, {}, token).then((data) => { if (projectRoomId === activeProjectIdRef.current) setProjectMessages(data.messages); }).catch(() => {});
      }
      connectedBefore = true;
    });
    socket.on("accountChanged", () => {
      refreshAccount().catch(() => {});
    });
    // A moderator restored a course you were in: reload your course list so it reappears.
    socket.on("myCoursesChanged", () => { loadApp().catch(() => {}); });
    socket.on("projectRoomMessage", (message: ProjectMessage & { projectRoomId: string }) => {
      if (message.projectRoomId !== activeProjectIdRef.current || message.authorAccountId === account?.id || blockedIdsRef.current.has(message.authorAccountId)) return;
      setProjectMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, { ...message, mine: false }]);
      const cached = projectCache.current.get(message.projectRoomId);
      if (cached && !cached.messages.some((item) => item.id === message.id)) projectCache.current.set(message.projectRoomId, { ...cached, messages: [...cached.messages, { ...message, mine: false }] });
      const existing = projectTypingTimers.current.get(message.authorAccountId);
      if (existing) window.clearTimeout(existing);
      projectTypingTimers.current.delete(message.authorAccountId);
      setProjectTypers((items) => items.filter((item) => item.accountId !== message.authorAccountId));
      if (chatOnScreenRef.current) request(`/api/project-rooms/${message.projectRoomId}/read`, { method: "POST" }, token).catch(() => {});
    });
    socket.on("projectRoomTyping", ({ projectRoomId, accountId, displayName }) => {
      if (accountId === account?.id || projectRoomId !== activeProjectIdRef.current || blockedIdsRef.current.has(accountId)) return;
      setProjectTypers((items) => [...items.filter((item) => item.accountId !== accountId), { accountId, name: displayName || "York Student" }]);
      const existing = projectTypingTimers.current.get(accountId);
      if (existing) window.clearTimeout(existing);
      projectTypingTimers.current.set(accountId, window.setTimeout(() => {
        projectTypingTimers.current.delete(accountId);
        setProjectTypers((items) => items.filter((item) => item.accountId !== accountId));
      }, 6000));
    });
    socket.on("projectRoomStopTyping", ({ projectRoomId, accountId }) => {
      if (projectRoomId !== activeProjectIdRef.current) return;
      const existing = projectTypingTimers.current.get(accountId);
      if (existing) window.clearTimeout(existing);
      projectTypingTimers.current.delete(accountId);
      setProjectTypers((items) => items.filter((item) => item.accountId !== accountId));
    });
    socket.on("projectRoomsChanged", (info?: { projectRoomId?: string }) => {
      // A group you visited earlier stays current while you're elsewhere, so going back is instant and up to date.
      const changed = info?.projectRoomId;
      if (changed && changed !== activeProjectIdRef.current && projectCache.current.has(changed)) request(`/api/project-rooms/${changed}`, {}, token).then((data) => projectCache.current.set(changed, { projectRoom: data.projectRoom, messages: data.messages })).catch(() => {});
      if (!guest) loadNotifications().catch(() => {});
      if (NEW_SHELL) request("/api/chats", {}, token).then((data) => setChatPreviews(data)).catch(() => {});
      const homeId = courseHomeIdRef.current;
      if (!homeId) return;
      request(`/api/course-groups/${homeId}/project-rooms`, {}, token).then((data) => {
        setProjectRooms(data.projectRooms);
        const fresh = (data.projectRooms as ProjectRoom[]).find((room) => room.id === activeProjectIdRef.current);
        if (fresh) setActiveProject((current) => current && { ...fresh, unreadCount: 0 });
      }).catch(() => {});
    });
    socket.on("projectRoomClosed", ({ projectRoomId }: { projectRoomId: string; reason: string }) => {
      if (projectRoomId !== activeProjectIdRef.current) return;
      clearProjectTypers();
      setActiveProject(null);
      setTab("course-home");
    });
    socket.on("projectRoomMessageRemoved", ({ messageId }) => {
      setProjectMessages((items) => items.filter((item) => item.id !== messageId));
    });
    socket.on("roomsChanged", ({ closedRoomIds }: { closedRoomIds?: string[] }) => {
      request("/api/rooms", readAuth(), token).then((data) => setRooms(data.rooms)).catch(() => {});
      if (activeRoomIdRef.current && closedRoomIds?.includes(activeRoomIdRef.current)) {
        leaveRoom();
      }
    });
    socket.on("roomMessageRemoved", ({ messageId }) => {
      setRoomMessages((items) => items.filter((item) => item.id !== messageId));
    });
    socket.on("roomMessage", (message) => {
      if (message.roomId === activeRoomIdRef.current)
        setRoomMessages((items) => [
          ...items,
          { ...message, mine: message.authorAccountId === account?.id },
        ]);
    });
    socket.on("roomPresence", (data) => {
      if (data.roomId === activeRoomIdRef.current) setRoomCount(data.count);
    });
    socket.on("roomPresenceChanged", ({ roomId, count }) => {
      setRooms((items) => items.map((room) => room.id === roomId ? { ...room, memberCount: count } : room));
    });
    socket.on("roomTyping", ({ roomId, accountId, displayName }) => {
      if (accountId === account?.id) return;
      if (roomId !== activeRoomIdRef.current) return;
      const typer = { accountId, name: displayName || "York Student" };
      setRoomTypers((items) => [...items.filter((item) => item.accountId !== accountId), typer]);
      const existing = roomTypingTimers.current.get(accountId);
      if (existing) window.clearTimeout(existing);
      roomTypingTimers.current.set(accountId, window.setTimeout(() => {
        roomTypingTimers.current.delete(accountId);
        setRoomTypers((items) => items.filter((item) => item.accountId !== accountId));
      }, 6000));
    });
    socket.on("roomStopTyping", ({ roomId, accountId }) => {
      if (roomId !== activeRoomIdRef.current || accountId === account?.id) return;
      const existing = roomTypingTimers.current.get(accountId);
      if (existing) window.clearTimeout(existing);
      roomTypingTimers.current.delete(accountId);
      setRoomTypers((items) => items.filter((item) => item.accountId !== accountId));
    });
    socket.on("courseGroupTypingState", ({ groupId, typers }: { groupId: string; typers?: { accountId: string; displayName?: string }[] }) => {
      if (groupId !== activeCourseGroupIdRef.current) return;
      const others: Typer[] = (typers || [])
        .filter((typer) => typer.accountId !== account?.id && !blockedIdsRef.current.has(typer.accountId))
        .map((typer) => ({ accountId: typer.accountId, name: typer.displayName || "York Student" }));
      courseGroupTypingTimers.current.forEach((timer) => window.clearTimeout(timer));
      courseGroupTypingTimers.current.clear();
      setCourseGroupTypers(others);
      if (others.length) {
        courseGroupTypingTimers.current.set(others[0].accountId, window.setTimeout(() => {
          courseGroupTypingTimers.current.clear();
          setCourseGroupTypers([]);
        }, 6000));
      }
    });
    socket.on("socialPostsChanged", ({ courseGroupId }: { courseGroupId?: string } = {}) => {
      if (courseGroupId) { if (COURSE_FORUM && courseGroupId === activeCourseGroupIdRef.current) loadCourseForum(courseGroupId).catch(() => {}); if (generalPostsRef.current) loadGeneralForum().catch(() => {}); return; } // a course forum post
      refreshPosts().catch(() => {});
      if (!guest) loadNotifications().catch(() => {}); // a new Dev Post is a notification too (Alerts badge)
    });
    socket.on("socialCommentChanged", async ({ postId }) => {
      refreshPosts().catch(() => {});
      // A comment on one of my posts means a new notification (backs up the direct notificationsChanged event).
      if (myPostIdsRef.current.has(postId)) loadNotifications().catch(() => {});
      if (postId === activeCommentPostIdRef.current) {
        try {
          const data = await request(`/api/social/posts/${postId}/comments`, readAuth(), token);
          setComments(data.comments);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Unable to refresh comments.");
        }
      }
    });
    socket.on("appStatusChanged", () => { if (appStatusOpened.current) loadAppStatus(); });
    socket.on("notificationsChanged", () => {
      loadNotifications().catch(() => {});
    });
    // A new message in a chat you're looking at arrives with the event itself: shown at once, no reload.
    socket.on("courseGroupMessage", ({ groupId, post }: { groupId: string; post: CourseGroupPost }) => {
      const add = (items: CourseGroupPost[]) => items.some((item) => item.id === post.id) ? items : [post, ...items];
      const cached = courseCache.current.get(groupId);
      if (cached) courseCache.current.set(groupId, add(cached));
      if (groupId === activeCourseGroupIdRef.current) setCourseGroupPosts(add);
    });
    socket.on("courseGroupChanged", async ({ groupId }) => {
      // Activity in courses you're not in isn't yours to reload for (every message on CCConnect sends this).
      if (!myChatIdsRef.current.has(groupId)) return;
      if (!guest) loadNotifications().catch(() => {}); // new messages show up in Notifications right away
      // A message in the chat you're viewing is read immediately, so it never adds to your unread count.
      if (!guest && groupId === activeCourseGroupIdRef.current && chatOnScreenRef.current) await markCourseRead(groupId);
      refreshCourseGroups().catch(() => {});
      if (groupId === activeCourseGroupIdRef.current) {
        try {
          const data = await request(`/api/course-groups/${groupId}/posts`, readAuth(), token);
          courseCache.current.set(groupId, data.posts);
          rememberJoins(groupId, data.joins);
          if (reactionsSaving.current === 0 && groupId === activeCourseGroupIdRef.current) setCourseGroupPosts(data.posts);
        } catch {
          // A background refresh (e.g. right after you left this chat) isn't worth an error message.
        }
      } else if (courseCache.current.has(groupId)) {
        // A chat you've visited stays current while you're elsewhere, so going back to it is instant and up to date.
        request(`/api/course-groups/${groupId}/posts`, readAuth(), token).then((data) => courseCache.current.set(groupId, data.posts)).catch(() => {});
      }
    });
    socket.on("errorMessage", (data) => setNotice(data.message));
    return () => {
      socket.disconnect();
    };
  }, [token, screen, account?.id, guest]);

  // Chats open at the newest message, and follow new messages when you're already at the bottom (or sent it).
  const chatAtBottom = useRef(true);
  const chatKey = tab === "course-group" && activeCourseGroup ? `course:${activeCourseGroup.id}:${courseGroupView}` : tab === "project-room" && activeProject ? `project:${activeProject.id}` : "";
  const newestMessage = tab === "course-group" ? courseGroupPosts[0] : tab === "project-room" ? projectMessages[projectMessages.length - 1] : undefined;
  const newestMine = Boolean(newestMessage && ("isMine" in newestMessage ? newestMessage.isMine : (newestMessage as ProjectMessage).mine));
  const scrollChatToBottom = (smooth = false) => {
    const list = document.querySelector(".mx-messages");
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    chatAtBottom.current = true;
  };
  useEffect(() => {
    if (!chatKey || chatFind !== null) return;
    chatAtBottom.current = true;
    const frame = window.requestAnimationFrame(() => scrollChatToBottom());
    const late = window.setTimeout(() => { if (chatAtBottom.current) scrollChatToBottom(); }, 350); // photos finishing loading
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(late); };
  }, [chatKey, chatFind === null, mobileMain]);
  useEffect(() => {
    if (!chatKey || !newestMessage) return;
    if (chatAtBottom.current || newestMine) window.requestAnimationFrame(() => scrollChatToBottom(true));
  }, [newestMessage?.id]);
  // The typing bubble and reactions add height below the last message: keep it in view when you're at the bottom.
  useEffect(() => {
    if (!chatKey || chatFind !== null) return;
    const list = document.querySelector(".mx-messages");
    if (!list || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => { if (chatAtBottom.current) list.scrollTop = list.scrollHeight; });
    observer.observe(list, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [chatKey, chatFind === null, mobileMain]);
  useEffect(() => {
    if (!chatKey || chatFind !== null || typeof ResizeObserver === "undefined") return;
    const list = document.querySelector(".mx-messages");
    if (!list) return;
    const observer = new ResizeObserver(() => { if (chatAtBottom.current) list.scrollTop = list.scrollHeight; });
    observer.observe(list);
    return () => observer.disconnect();
  }, [chatKey, chatFind === null, mobileMain]);
  // Tapping the message box jumps to the newest message (again once the keyboard has slid up).
  const focusComposer = () => {
    setEmojiPickerFor(null);
    scrollChatToBottom();
    window.setTimeout(() => scrollChatToBottom(true), 320);
  };
  // Phones: swipe right to go back; the screen follows your finger like iOS.
  const swipe = useRef<{ x: number; y: number; t: number; horizontal: boolean | null } | null>(null);
  // Swiping back from a post, iPhone-style: a snapshot of the post follows the finger while the list it came from is
  // already drawn underneath (so there's never a blank or black gap).
  const swipeShot = useRef<HTMLElement | null>(null);
  // Once a sideways swipe is recognised, stop the list/chat from scrolling underneath it (React's touch
  // handlers are passive, so this needs a non-passive listener of its own).
  useEffect(() => {
    const lock = (event: globalThis.TouchEvent) => { if (swipe.current?.horizontal) event.preventDefault(); };
    document.addEventListener("touchmove", lock, { passive: false });
    return () => document.removeEventListener("touchmove", lock);
  }, []);
  useEffect(() => { if (screen === "app" && !guest && token) loadNotifSettings(); }, [screen, guest, token]);
  const mutedUntilOf = (chatId?: string | null) => { const until = chatId ? notifSettings?.mutedUntil?.[chatId] : undefined; return until && new Date(until) > new Date() ? until : null; };
  const isMuted = (chatId?: string | null) => Boolean(chatId && (notifSettings?.mutedChats.includes(chatId) || mutedUntilOf(chatId)));
  useEffect(() => {
    const fresh = courseGroups.filter((group) => group.joined && !pinsSeen[group.id]);
    if (!fresh.length) return;
    setPinsSeen((seen) => { const next = { ...seen }; for (const group of fresh) next[group.id] = new Date().toISOString(); try { localStorage.setItem("mixby-pins-seen", JSON.stringify(next)); } catch { /* private mode */ } return next; });
  }, [courseGroups]);
  useEffect(() => { if (tab === "course-group" && courseGroupView === "pinned" && activeCourseGroup) markPinsSeen(activeCourseGroup.id); }, [tab, courseGroupView, activeCourseGroup?.id, courseGroups]);
  // Chat persistence: remember the chat on screen (or none) and reopen it next launch.
  // Opened from a link (a course QR code, a shared course or post): that link wins over reopening your last chat.
  // (Checked once at start: the link handlers tidy the address bar before this runs.)
  const openedFromLink = useRef(typeof window !== "undefined" && Boolean(window.location.search));
  const pendingRestore = useRef<{ type: "course" | "project"; id: string; groupId?: string } | null | undefined>((() => {
    try { return JSON.parse(localStorage.getItem("mixby-last-chat") || "null"); } catch { return null; }
  })());
  useEffect(() => {
    const saved = pendingRestore.current;
    // Visitors always start on Find your course (owner's call, Oct 31 2026), so they never reopen a course.
    if (saved === undefined || screen !== "app" || !account || courseGroups.length === 0) return;
    pendingRestore.current = undefined; // only once; saving starts after this
    if (!saved || openedFromLink.current || guest) return;
    if (saved.type === "course" && degree && degree.groupId === saved.id) {
      setTab(FORUM_HOME); // the old degree General chat: its Forum replaced it
      setMobileMain(true);
    } else if (saved.type === "course") {
      const group = courseGroups.find((candidate) => candidate.id === saved.id) || (degree && degree.groupId === saved.id ? { id: degree.groupId, courseCode: "General", termName: degree.code, memberCount: degree.memberCount, joined: true, unreadCount: degree.unreadCount, isDegree: true } : null);
      if (group?.joined) { openCourseGroup(group); setMobileMain(true); }
    } else {
      const group = courseGroups.find((candidate) => candidate.id === saved.groupId);
      if (group) setCourseHome(group);
      openProjectRoom(saved.id).then(() => setMobileMain(true)).catch(() => {});
    }
  }, [screen, guest, account?.id, courseGroups, degree?.groupId]);
  useEffect(() => {
    if (pendingRestore.current !== undefined || screen !== "app") return;
    const onScreen = NEW_SHELL && (mobileMain || window.matchMedia("(min-width: 900px)").matches);
    const last = !onScreen ? null : tab === "course-group" && activeCourseGroup ? { type: "course", id: activeCourseGroup.id } : tab === "project-room" && activeProject ? { type: "project", id: activeProject.id, groupId: activeProject.courseGroupId } : null;
    try { localStorage.setItem("mixby-last-chat", JSON.stringify(last)); } catch { /* private mode */ }
  }, [tab, activeCourseGroup?.id, activeProject?.id, mobileMain, screen, guest]);
  const trackChatScroll = (event: SyntheticEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    chatAtBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  };

  const beginSignup = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await request("/api/verification/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setScreen("code");
    } catch (error) {
      if ((error as { status?: number }).status === 409) setScreen("login"); // already has an account: no code sent, log in instead
      setNotice(
        error instanceof Error ? error.message : "Unable to send code.",
      );
    }
  };
  const confirmCode = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const data = await request("/api/verification/confirm", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      localStorage.setItem("mixby-token", data.token);
      setToken(data.token);
      setAccount(data.account);
      setScreen("password");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to verify code.",
      );
    }
  };
  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const data = await request(
        "/api/password",
        { method: "POST", body: JSON.stringify({ password, displayName: signupName.trim() || identity.displayName.trim() || undefined }) },
        token,
      );
      setNameChosen(true);
      setAccount(data.account);
      setScreen(data.account.ageConfirmed && data.account.termsAccepted !== false ? "app" : "age");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to save password.",
      );
    }
  };
  const saveIdentity = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const data = await request("/api/identity", { method: "PATCH", body: JSON.stringify(identity) }, token);
      setIdentity(data.profile);
      if (Number.isInteger(data.profile.avatarColor)) setAvatarColor(data.profile.displayName, data.profile.avatarColor);
      setSavedUsername(data.profile.displayName || "");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save your profile.");
      return false;
    }
  };
  // For accounts created before usernames were required.
  const login = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const data = await request("/api/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem("mixby-token", data.token);
      setToken(data.token);
      setAccount(data.account);
      setScreen(data.account.ageConfirmed && data.account.termsAccepted !== false ? "app" : "age");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to log in.");
    }
  };
  const signInWithGoogle = async (idToken: string) => {
    try {
      const data = await request("/api/auth/google", { method: "POST", body: JSON.stringify({ idToken }) });
      localStorage.setItem("mixby-token", data.token);
      localStorage.removeItem("mixby-guest");
      setToken(data.token);
      setAccount(data.account);
      setScreen(data.account.ageConfirmed && data.account.termsAccepted !== false ? "app" : "age");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Google sign-in failed.");
    }
  };
  const requestPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await request("/api/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setScreen("reset-password");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to request a reset code.",
      );
    }
  };
  const confirmPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const data = await request("/api/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ email, code, password }),
      });
      localStorage.setItem("mixby-token", data.token);
      setToken(data.token);
      setAccount(data.account);
      setScreen(data.account.ageConfirmed && data.account.termsAccepted !== false ? "app" : "age");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to reset your password.",
      );
    }
  };
  // New accounts pick their display name on the Terms screen; it starts as the suggestion made from their email.
  useEffect(() => {
    if ((screen !== "age" && screen !== "password") || !token) return;
    request("/api/identity", {}, token).then((data) => { setIdentity(data.profile); setSignupName((current) => current || data.profile?.displayName || ""); }).catch(() => {});
  }, [screen, token]);
  const finishSignup = async () => {
    try {
      if (!account?.ageConfirmed && !nameChosen && !account?.isGuest) {
        const data = await request("/api/identity", { method: "PATCH", body: JSON.stringify({ ...identity, displayName: signupName.trim() }) }, token);
        setIdentity(data.profile);
        setSavedUsername(data.profile.displayName || "");
      }
      await confirmAge();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save. Try again.");
    }
  };
  const confirmAge = async () => {
    const data = await request(
      "/api/age-confirmation",
      { method: "POST", body: JSON.stringify({ confirmed: true, termsVersion: account?.termsVersion }) },
      token,
    );
    setAccount(data.account);
    setScreen("app");
  };
  const publishPost = async (event: FormEvent) => {
    event.preventDefault();
    if (postSendingRef.current) return;
    postSendingRef.current = true;
    setPostSending(true);
    try {
      // Degree posts have no flair for now.
      const noFlair = editingPost ? Boolean(editingPost.degreeId || editingPost.courseGroupId) : postScope !== "dev";
      if (!postTitle.trim()) throw new Error("Add a title to your post.");
      if (noFlair && countWords(postBody) > DEGREE_POST_MAX_WORDS) throw new Error(`Forum posts can be up to ${DEGREE_POST_MAX_WORDS.toLocaleString()} words.`);
      const imageUrls = await Promise.all(postImages.map(async (image) => image.isNew ? (await request("/api/chat-attachments", { method: "POST", body: JSON.stringify(image.copyFrom ? { scope: "post", copyFrom: image.copyFrom } : { scope: "post", fileData: image.src, fileName: image.name }) }, token)).attachmentUrl as string : image.src));
      const saved = await request(
        editingPost ? `/api/social/posts/${editingPost.id}` : "/api/social/posts",
        {
          method: editingPost ? "PATCH" : "POST",
          body: JSON.stringify({ asTeam: sendAsTeam, kind: postKind, flair: noFlair ? null : postFlair, imageUrls, body: postBody.trim() ? `${postTitle.trim()}\n\n${postBody.trim()}` : postTitle.trim(), externalUrl, ...(!editingPost && postScope === "degree" && degree ? { degreeId: degree.id } : {}), ...(!editingPost && postScope === "course" && activeCourseGroup ? { courseGroupId: activeCourseGroup.id, courseChannel: "questions" } : {}), ...(!editingPost && postScope === "general" ? { general: true } : {}) }),
        },
        token,
      );
      setPostBody("");
      setPostTitle("");
      setExternalUrl("");
      setPostFlair(null);
      setPostImages([]);
      setEditingPost(null);
      const toDegree = editingPost ? Boolean(editingPost.degreeId) : postScope === "degree";
      if (editingPost) {
        // Back to the edited post, showing the new text and photos straight away.
        const row = (saved as { post?: { body?: string; image_urls?: string[] } }).post || {};
        const updated: Post = { ...editingPost, body: row.body ?? editingPost.body, imageUrls: row.image_urls ?? imageUrls };
        const swap = (list: Post[]) => list.map((item) => item.id === updated.id ? updated : item);
        setPosts(swap);
        setDegreePosts(swap);
        // Back where it was edited from: its post page, or the list (a post with no description has no page).
        if (!updated.body.split("\n\n").slice(1).join("").trim()) setTab(postFromGeneral.current || (!updated.courseGroupId && !updated.degreeId) ? "general-forum" : postHome(updated));
        else if (commentPost?.id === updated.id) { setCommentPost(updated); setTab("post"); } else openComments(updated);
      } else if (postScope === "general") { setTab("general-forum"); loadGeneralForum().catch(() => {}); return; } // a General Forum post
      else setTab(postScope === "course" ? "course-group" : toDegree ? "degree-posts" : "social");
      if (toDegree) loadDegreePosts(); else if (postScope === "course" && activeCourseGroup) loadCourseForum(activeCourseGroup.id).catch(() => {}); else loadApp();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to publish.");
    } finally {
      postSendingRef.current = false;
      setPostSending(false);
    }
  };
  const connect = async (id: string) => {
    try {
      await request(
        `/api/social/posts/${id}/connect`,
        { method: "POST" },
        token,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to connect.");
    }
  };
  const editPost = (post: Post) => {
    const [title, ...bodyParts] = post.body.split("\n\n");
    setEditingPost(post);
    setPostTitle(title);
    setPostBody(bodyParts.join("\n\n"));
    setPostKind(post.kind);
    setPostFlair(post.flair || null);
    setPostImages((post.imageUrls || []).map((src) => ({ src, isNew: false })));
    setLinkFormOpen(false);
    setExternalUrl(post.externalUrl || "");
    setOpenPostMenu(null);
    setPostScope(post.courseGroupId ? "course" : post.degreeId ? "degree" : DEV_POSTS_ENABLED ? "dev" : "general");
    setTab("create");
    setMobileMain(true);
  };
  // Every post delete asks first (moderators are told it can be restored).
  const askDeletePost = async (post: Post) => {
    const ok = await askConfirm({ title: "Delete this post?", message: isAdmin ? "It's removed for everyone. You can bring it back from Moderation → Deleted." : "It's removed for everyone, with its comments. This can't be undone.", action: "Delete post" });
    if (ok) deletePost(post);
  };
  const deletePost = async (post: Post) => {
    try {
      await request(`/api/social/posts/${post.id}`, { method: "DELETE" }, token);
      setOpenPostMenu(null);
      setConfirmDeletePost(null);
      // Gone from the screen right away (it used to stay until a reload), and off its page back to the list.
      setPosts((items) => items.filter((item) => item.id !== post.id));
      setDegreePosts((items) => items.filter((item) => item.id !== post.id));
      if (commentPost?.id === post.id || tab === "post") { setCommentPost(null); setTab(postHome(post)); }
      if (post.courseGroupId) return;
      if (post.degreeId) loadDegreePosts().catch(() => {}); else loadApp().catch(() => {});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete your post.");
    }
  };
  // Block whoever wrote this content, then reload what's on screen without them.
  const blockAuthor = (target: ReportTarget) => {
    if (membersOnly("block people")) return;
    setSenderCard(null);
    setOpenPostMenu(null);
    setMessageMenu(null);
    setBlockTarget(target);
  };
  const confirmBlock = async () => {
    const target = blockTarget;
    if (!target || blocking) return;
    setBlocking(true);
    try {
      const data = await request("/api/blocks", { method: "POST", body: JSON.stringify({ targetType: target.type, targetId: target.id }) }, token);
      setBlockedPeople((people) => people.some((person) => person.id === data.blocked.id) ? people : [...people, data.blocked]);
      setProjectMessages((items) => items.filter((item) => item.authorAccountId !== data.blocked.id));
      setRoomMessages((items) => items.filter((item) => item.authorAccountId !== data.blocked.id));
      const [postsData] = await Promise.all([request("/api/social/posts", {}, token)]);
      setPosts(postsData.posts);
      loadDegreePosts().catch(() => {});
      if (commentPost) request(`/api/social/posts/${commentPost.id}/comments`, {}, token).then((result) => setComments(result.comments)).catch(() => {});
      if (activeCourseGroup) request(`/api/course-groups/${activeCourseGroup.id}/posts`, {}, token).then((result) => setCourseGroupPosts(result.posts)).catch(() => {});
      setBlockTarget(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to block this person.");
    } finally {
      setBlocking(false);
    }
  };
  const unblock = async (person: { id: string; name: string }) => {
    try {
      await request(`/api/blocks/${person.id}`, { method: "DELETE" }, token);
      setBlockedPeople((people) => people.filter((item) => item.id !== person.id));
      request("/api/social/posts", {}, token).then((data) => setPosts(data.posts)).catch(() => {});
      loadDegreePosts().catch(() => {});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to unblock.");
    }
  };
  const openReport = (target: ReportTarget) => {
    setSenderCard(null);
    setOpenPostMenu(null);
    setReportTarget(target);
    setReportCategory("");
    setReportDetails("");
    setReportState("form");
  };
  const closeReport = () => setReportTarget(null);
  const submitReport = async (event: FormEvent) => {
    event.preventDefault();
    if (!reportTarget || !reportCategory) return;
    setReportState("sending");
    try {
      const data = await request("/api/reports/content", { method: "POST", body: JSON.stringify({ targetType: reportTarget.type, targetId: reportTarget.id, category: reportCategory, details: reportDetails }) }, token);
      setReportState(data.alreadyReported ? "already" : "done");
    } catch (error) {
      setReportState("form");
      setNotice(error instanceof Error ? error.message : "Unable to submit your report.");
    }
  };
  // The post opens at once (comments seen before show straight away) and its comments load behind it.
  const commentsSeen = useRef(new Map<string, PostComment[]>());
  const openPostId = useRef("");
  // A discussion post (a description or photos) opens its own page, Reddit-style; a title-only post opens the sheet.
  // Back from a post page: the list it was opened from (General Forum, the course forum…), or Alerts on phones.
  const postBack = (post: Post) => {
    if (backToAlerts.current && !isWide()) { backToAlerts.current = false; setRailPanel("alerts"); setTab("alerts"); setMobileMain(true); return; }
    setTab(postFromGeneral.current ? "general-forum" : postHome(post));
    setMobileMain(true);
  };
  const hasDescription = (post: Post) => post.body.split("\n\n").slice(1).join("").trim().length > 0 || (post.imageUrls?.length || 0) > 0;
  const openCommentsSheet = async (post: Post, longPost = false) => {
    // From a long post's page the comments open full screen only (no two-thirds stage, no preview above).
    setSheetLong(longPost);
    setSheetFull(longPost);
    setSheetPost(post);
    setCommentPost(post);
    setReplyTo(null);
    setComments(commentsSeen.current.get(post.id) || []);
    setCommentsLoadedFor(commentsSeen.current.has(post.id) ? post.id : "");
    try {
      const data = await request(`/api/social/posts/${post.id}/comments`, readAuth(), token);
      setComments(data.comments);
      setCommentsLoadedFor(post.id);
    } catch (error) {
      setCommentsLoadedFor(post.id);
      setNotice(error instanceof Error ? error.message : "Unable to load comments.");
    }
  };
  const closeCommentsSheet = () => {
    const post = sheetPost;
    if (!post || sheetClosing) return;
    // Slides down first (.closing), then goes.
    setSheetClosing(true);
    window.setTimeout(() => { setSheetPost(null); setSheetClosing(false); }, 260);
    // The list shows the new comment count straight away.
    const count = comments.filter((comment) => !comment.pending).length;
    const bump = (list: Post[]) => list.map((item) => item.id === post.id ? { ...item, commentCount: count } : item);
    setGeneralPosts((list) => list ? bump(list) : list);
    setCourseForum((forum) => ({ ...forum, posts: bump(forum.posts) }));
    setDegreePosts(bump);
  };
  const openComments = async (post: Post, fromGeneral = false) => {
    if (!hasDescription(post)) { openCommentsSheet(post); return; } // no description: comments open over the list
    postFromGeneral.current = fromGeneral;
    openPostId.current = post.id;
    setComments(commentsSeen.current.get(post.id) || []);
    setCommentPost(post);
    setTab("post");
    setMobileMain(true);
    try {
      const data = await request(`/api/social/posts/${post.id}/comments`, readAuth(), token);
      commentsSeen.current.set(post.id, data.comments);
      if (openPostId.current === post.id) setComments(data.comments);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load comments.");
    }
  };
  // Sending a comment: the box clears at once (a second tap can't post it twice), the comment shows as soon as it's
  // saved, and the post list refreshes in the background instead of the whole app reloading first.
  const commentSending = useRef(false);
  const addComment = async (event: FormEvent) => {
    event.preventDefault();
    if (tooLong(commentDraft)) { setNotice(`Comments can be up to ${MESSAGE_MAX.toLocaleString()} characters.`); return; }
    if (!commentPost || (!commentDraft.trim() && !commentImage) || commentSending.current) return;
    commentSending.current = true;
    const body = commentDraft, parent = replyTo, image = commentImage;
    setCommentImage(null);
    const tempId = `pending-${Date.now()}`;
    const authorName = (sendAsTeam ? TEAM_NAME : identity.displayName) || "York Student";
    setCommentDraft("");
    setReplyTo(null);
    // Shows right away (faded until saved), like a chat message.
    setComments((items) => [...items, { id: tempId, parentCommentId: parent?.id || null, body, imageUrl: image?.src || null, createdAt: new Date().toISOString(), authorName, isMine: true, pending: true }]);
    try {
      const imageUrl = image ? (await request("/api/chat-attachments", { method: "POST", body: JSON.stringify(image.copyFrom ? { scope: "post", copyFrom: image.copyFrom } : { scope: "post", fileData: image.src, fileName: "photo.jpg" }) }, token)).attachmentUrl as string : null;
      const data = await request(`/api/social/posts/${commentPost.id}/comments`, { method: "POST", body: JSON.stringify({ asTeam: sendAsTeam, body, imageUrl, parentCommentId: parent?.id || null }) }, token);
      setComments((items) => items.map((item) => item.id === tempId ? { ...data.comment, authorName: data.comment.authorName || authorName } : item));
      loadApp().catch(() => {});
    } catch (error) {
      setComments((items) => items.filter((item) => item.id !== tempId));
      setCommentDraft((current) => current || body); // nothing lost: the text (and photo) go back in the box
      setCommentImage((current) => current || image);
      setReplyTo(parent);
      setNotice(error instanceof Error ? error.message : "Unable to add your comment.");
    } finally {
      commentSending.current = false;
    }
  };
  // The note picker: one page with every message from all your notes, newest first (owner's call, Nov 3 2026). Shows
  // the device copies at once, then each note fresh from the cloud.
  const openNotePicker = async () => {
    const byNote = new Map<string, NoteEntry[]>();
    const show = (loading?: boolean) => setNotePicker((current) => current && {
      ...current,
      loading: loading ?? current.loading,
      entries: notes.flatMap((note) => (byNote.get(note.id) || []).map((entry) => ({ ...entry, note }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
    for (const note of notes) { const cached = noteCache.current.get(note.id); if (cached) byNote.set(note.id, cached); }
    setNotePicker({ entries: [], loading: notes.length > 0, course: "all", query: "" });
    show();
    const ops = await pendingOps(noteAccount);
    await Promise.all(notes.map(async (note) => { const snapshot = await readNoteSnapshot(noteAccount, note.id); if (snapshot) byNote.set(note.id, noteView(snapshot, ops, note.id)); }));
    show();
    await Promise.all(notes.map(async (note) => {
      try {
        const data = await request(`/api/notes/${note.id}/entries`, readAuth(), token);
        await writeNoteSnapshot(noteAccount, note.id, data.entries);
        const view = noteView(data.entries, await pendingOps(noteAccount), note.id);
        noteCache.current.set(note.id, view);
        byNote.set(note.id, view);
        show();
      } catch { /* offline: the device copy stays */ }
    }));
    show(false);
  };
  // Picking an entry puts its text and photo in the comment box (edit before sending).
  const pickNoteEntry = async (entry: NoteEntry) => {
    setNotePicker(null);
    setCommentDraft(entry.body);
    const url = entry.imageUrl;
    if (!url) setCommentImage(null);
    else if (url.startsWith(DEVICE_PHOTO)) { const src = await loadPhoto(url.slice(DEVICE_PHOTO.length)); setCommentImage(src ? { src } : null); }
    else if (url.startsWith("data:")) setCommentImage({ src: url });
    else setCommentImage({ src: uploadedNotePhotos.get(url) || url, copyFrom: url });
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".mx-comment-row textarea")?.focus(), 60);
  };
  const deleteComment = async (comment: PostComment) => {
    if (!commentPost) return;
    try {
      await request(`/api/social/posts/${commentPost.id}/comments/${comment.id}`, { method: "DELETE" }, token);
      const data = await request(`/api/social/posts/${commentPost.id}/comments`, {}, token);
      setComments(data.comments);
      await loadApp();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete your comment.");
    }
  };
  const saveCommentEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!commentPost || !editingComment || !editedCommentBody.trim()) return;
    try {
      const data = await request(`/api/social/posts/${commentPost.id}/comments/${editingComment.id}`, { method: "PATCH", body: JSON.stringify({ body: editedCommentBody }) }, token);
      setComments((items) => items.map((comment) => comment.id === editingComment.id ? data.comment : comment));
      setEditingComment(null);
      setEditedCommentBody("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to edit your comment.");
    }
  };
  const toggleProfileActivity = async () => {
    const next = !showActivity;
    setShowActivity(next);
    if (!next || profileActivity) return;
    try {
      const data = await request('/api/profile/activity', {}, token);
      setProfileActivity(data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to load your activity.');
    }
  };
  const activityPostToPost = (post: ActivityPost): Post => ({ id: post.id, kind: post.kind, body: post.body, externalUrl: post.external_url, createdAt: post.created_at, author: { displayName: "", program: "", studyYear: null, bio: "", interests: [] }, reactionCounts: {}, commentCount: 0, myReaction: null, isMine: true });
  const editActivityComment = async (comment: ProfileActivity["comments"][number]) => {
    if (!comment.post) return;
    try {
      const post = activityPostToPost({ ...comment.post, created_at: comment.createdAt });
      const data = await request(`/api/social/posts/${post.id}/comments`, readAuth(), token);
      const current = data.comments.find((item: PostComment) => item.id === comment.id);
      setComments(data.comments);
      setCommentPost(post);
      setEditingComment(current || null);
      setEditedCommentBody(current?.body || comment.body);
      setOpenActivityMenu(null);
      setTab("post");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to edit your comment.");
    }
  };
  const deleteActivityComment = async (comment: ProfileActivity["comments"][number]) => {
    try {
      await request(`/api/social/posts/${comment.postId}/comments/${comment.id}`, { method: "DELETE" }, token);
      setProfileActivity((activity) => activity ? { ...activity, comments: activity.comments.filter((item) => item.id !== comment.id) } : activity);
      setOpenActivityMenu(null);
      await loadApp();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete your comment.");
    }
  };
  const renderComments = (parentCommentId: string | null, depth = 0): ReactNode => comments
    .filter((comment) => comment.parentCommentId === parentCommentId)
    .map((comment) => (
      <article key={comment.id} className="thread-comment" style={{ marginLeft: Math.min(depth, 4) * 20 }}>
        <button type="button" className="comment-author-button" disabled={comment.isMine} aria-label={`${comment.authorName || "York Student"}: options`} onClick={(event) => toggleSenderCard(`comment-${comment.id}`, event)}><Avatar name={comment.authorName || "York Student"} seed={comment.authorName || comment.id} /></button>
        {senderCard === `comment-${comment.id}` && <SenderConsole anchor={senderAnchor} name={comment.authorName || "York Student"} seed={comment.authorName || comment.id} onClose={() => setSenderCard(null)} onReport={() => openReport({ type: "comment", id: comment.id, what: "comment", authorName: comment.authorName || "York Student", preview: comment.body })} onBlock={() => blockAuthor({ type: "comment", id: comment.id, what: "comment", authorName: comment.authorName || "York Student", preview: comment.body })} />}
        <div>
          <button type="button" className="comment-author-button name" disabled={comment.isMine} onClick={(event) => toggleSenderCard(`comment-${comment.id}`, event)}><strong>{comment.authorName || "York Student"}</strong></button><time className="post-time" dateTime={comment.createdAt}> · {timeAgo(comment.createdAt)}</time>
          {editingComment?.id === comment.id ? <form className="comment-edit-form" onSubmit={saveCommentEdit}><textarea value={editedCommentBody} onChange={(event) => setEditedCommentBody(event.target.value)} maxLength={20000} required /><button>Save</button><button type="button" onClick={() => setEditingComment(null)}>Cancel</button></form> : <p>{comment.body}</p>}
          <div className="comment-actions"><button onClick={() => { if (membersOnly("reply to comments")) return; setReplyTo(comment); }}>Reply</button>{!comment.isMine && <><button className="comment-report" onClick={() => openReport({ type: "comment", id: comment.id, what: "comment", authorName: comment.authorName || "York Student", preview: comment.body })}>Report</button><button className="comment-report" onClick={() => blockAuthor({ type: "comment", id: comment.id, what: "comment", authorName: comment.authorName || "York Student", preview: comment.body })}>Block</button></>}{comment.isMine && <div className="comment-menu"><button aria-label="Comment actions" onClick={(event) => { event.stopPropagation(); setOpenCommentMenu(openCommentMenu === comment.id ? null : comment.id); }}>...</button>{openCommentMenu === comment.id && <div><button onClick={() => { setEditingComment(comment); setEditedCommentBody(comment.body); setOpenCommentMenu(null); }}>Edit</button><button onClick={() => { deleteComment(comment); setOpenCommentMenu(null); }}>Delete</button></div>}</div>}</div>
          {renderComments(comment.id, depth + 1)}
        </div>
      </article>
    ));
  const createRoom = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await request(
        "/api/rooms",
        {
          method: "POST",
          body: JSON.stringify({ title: roomTitle }),
        },
        token,
      );
      setRoomTitle("");
      await loadApp();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to create Room.",
      );
    }
  };
  const openCourseGroup = async (group: CourseGroup) => {
    setReplyingTo(null);
    // A guest "joins" on this device only.
    const guestCourses = guest ? guestCourseIds() || new Set<string>() : null;
    if (guestCourses) {
      // Recently visited: moved to the end of the list (shown newest first).
      const isNew = !guestCourses.has(group.id);
      guestCourses.delete(group.id);
      guestCourses.add(group.id);
      saveGuestCourses(guestCourses);
      if (isNew) setCourseGroups((groups) => groups.map((item) => item.id === group.id ? { ...item, joined: true } : item));
      group = { ...group, joined: true };
    }
    openingChat.current = `course:${group.id}`;
    const showChat = (posts: CourseGroupPost[]) => {
      clearCourseGroupTypers();
      setActiveCourseGroup({ ...group, joined: !guest });
      setCourseGroupPosts(posts);
      setCourseGroupView("chat");
      setCoursePostMenuId(null);
      setTab("course-group");
    };
    // Already joined: open instantly (from cache when we have it) and refresh behind the scenes.
    const cached = courseCache.current.get(group.id);
    const instant = group.joined || guest;
    if (instant) showChat(cached || []);
    setChatLoading(!cached);
    try {
      if (!group.joined && !guest) await request(`/api/course-groups/${group.id}/join`, { method: "POST" }, token);
      socketRef.current?.emit("courseGroupJoin", { groupId: group.id });
      // Members (header avatars) and the course's project rooms; the new shell needs them on every device.
      if ((isNativeApp || NEW_SHELL) && !guest && !group.isDegree) {
        setCourseHome(group);
        loadCourseHome(group.id).then((rooms) => prefetchProjectRooms(rooms || [])).catch(() => {});
      }
      const data = await request(`/api/course-groups/${group.id}/posts`, readAuth(), token);
      courseCache.current.set(group.id, data.posts);
      rememberJoins(group.id, data.joins);
      if (openingChat.current !== `course:${group.id}`) return; // you've already moved on
      if (instant) setCourseGroupPosts(data.posts);
      else showChat(data.posts);
      if (!guest) markCourseRead(group.id);
      if (!group.joined) loadApp().catch(() => {});
    } catch (error) {
      if (openingChat.current === `course:${group.id}`) setNotice(error instanceof Error ? error.message : "Unable to open Course Group.");
    } finally {
      if (openingChat.current === `course:${group.id}`) setChatLoading(false);
    }
  };
  const requestCourse = async (event: FormEvent) => {
    event.preventDefault();
    const code = courseRequestCode.trim();
    const termId = courseRequestTermId || currentTermId;
    const term = courseTerms.find((option) => option.id === termId);
    if (!term) { setNotice("Choose a semester for this course."); return false; }
    try {
      const data = await request("/api/course-requests", { method: "POST", body: JSON.stringify({ courseCode: code, termId: term.id, instructor: courseRequestInstructor }) }, token);
      setCourseRequestCode("");
      setCourseRequestInstructor("");
      await loadApp();
      if (data.joined) {
        openCourseGroup({ id: data.joined.id, courseCode: data.joined.courseCode, instructor: data.joined.instructor, termName: data.joined.termName, memberCount: 0, joined: true });
        return true;
      }
      if (data.request.status === "approved") {
      } else {
      }
      setTab("browse-courses");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to request that course.");
      return false;
    }
  };
  const joinRequestedCourse = async (item: CourseRequest) => {
    try {
      const data = await request(`/api/course-requests/${item.id}/join`, { method: "POST" }, token);
      await loadApp();
      if (!data.group) return; // still waiting for a moderator: the row now says Requested
      if (NEW_SHELL) {
        // Straight into the new course chat (terms are never shown in the new shell).
        setCreatingCourse(false);
        openCourseGroup({ id: data.group.id, courseCode: data.group.courseCode, instructor: item.instructor, termName: data.group.termName, memberCount: item.requesterCount + 1, joined: true, unreadCount: 0 } as CourseGroup);
        setMobileMain(true);
        return;
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to join that course.");
      await loadApp().catch(() => undefined);
    }
  };
  const chooseChatAttachment = (file: File | undefined, setAttachment: (attachment: ChatAttachment | null) => void) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) && file.type !== "application/pdf") { setNotice("Attach an image or PDF."); return; }
    if (file.size > 5 * 1024 * 1024) { setNotice("Attachments must be 5 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => setAttachment({ data: String(reader.result), name: file.name, isImage: file.type.startsWith("image/") });
    reader.readAsDataURL(file);
  };
  // Sending: the box clears and shrinks at once and a text message shows straight away (faded until the server
  // confirms it). If sending fails, the message comes off the screen and the text goes back in the box.
  const publishCoursePost = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeCourseGroup) return;
    if (tooLong(coursePostBody)) { setNotice(`Messages can be up to ${MESSAGE_MAX.toLocaleString()} characters.`); return; }
    const groupId = activeCourseGroup.id;
    const sentReply = replyingTo;
    const sentBody = coursePostBody;
    const courseAttachmentSent = courseAttachment;
    const pollSent = coursePollOptions;
    if (!sentBody.trim() && !courseAttachmentSent && !pollSent.length) return;
    const tempId = `pending-${Date.now()}`;
    const optimistic = !courseAttachmentSent && !pollSent.length;
    if (optimistic) setCourseGroupPosts((items) => [{ id: tempId, pending: true, replyToId: sentReply?.id || null, replyTo: sentReply ? { id: sentReply.id, name: sentReply.author?.displayName || "York Student", body: sentReply.body } : null, kind: "text", body: sentBody, imageUrl: null, attachmentName: null, pollOptions: [], pinnedAt: null, createdAt: new Date().toISOString(), author: sendAsTeam ? { ...identity, displayName: TEAM_NAME } : identity, reactionCount: 0, reacted: false, reactions: [], myReaction: null, pollVotes: {}, myPollVote: null, isMine: true } as unknown as CourseGroupPost, ...items]);
    setCoursePostBody(""); setCourseAttachment(null); setCoursePollOptions([]); setReplyingTo(null);
    signalCourseTyping(false);
    const here = () => activeCourseGroupIdRef.current === groupId;
    try {
      let attachmentUrl = "";
      if (courseAttachmentSent) attachmentUrl = (await request("/api/chat-attachments", { method: "POST", body: JSON.stringify({ scope: "course-group", parentId: groupId, fileData: courseAttachmentSent.data, fileName: courseAttachmentSent.name }) }, token)).attachmentUrl;
      const kind = pollSent.length ? "poll" : courseAttachmentSent ? (courseAttachmentSent.isImage ? "image" : "attachment") : "text";
      const data = await request(`/api/course-groups/${groupId}/posts`, { method: "POST", body: JSON.stringify({ asTeam: sendAsTeam, replyToId: sentReply?.id, kind, body: sentBody, imageUrl: attachmentUrl, attachmentName: courseAttachmentSent?.name, pollOptions: pollSent }) }, token);
      const confirm = (items: CourseGroupPost[]) => { const rest = items.filter((item) => item.id !== tempId && item.id !== data.post.id); return [data.post, ...rest]; };
      if (here()) setCourseGroupPosts(confirm);
      const cached = courseCache.current.get(groupId);
      if (cached) courseCache.current.set(groupId, confirm(cached));
    } catch (error) {
      if (here()) {
        setCourseGroupPosts((items) => items.filter((item) => item.id !== tempId));
        setCoursePostBody((current) => current || sentBody);
        setCourseAttachment((current) => current || courseAttachmentSent);
        setCoursePollOptions((current) => current.length ? current : pollSent);
        setReplyingTo((current) => current || sentReply);
      }
      setNotice(error instanceof Error ? error.message : "Unable to send your message.");
    }
  };
  // Reply to a course message: close its menu, show "Replying to…" above the message box and focus it.
  const startReply = (post: CourseGroupPost) => {
    setMessageMenu(null);
    setMenuAnchor(null);
    setReplyingTo(post);
    window.setTimeout(() => (document.querySelector(".mx-chat .mx-composer textarea") as HTMLTextAreaElement | null)?.focus(), 30);
  };
  // iOS app: press and hold a course chat message for the message menu.
  const [messageMenu, setMessageMenu] = useState<CourseGroupPost | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null); // website: where the ⋯ dropdown opens (null = bottom sheet)
  const [emojiPop, setEmojiPop] = useState<{ post: CourseGroupPost; anchor: DOMRect } | null>(null);
  const reactionsSaving = useRef(0);
  const holdTimer = useRef<number | null>(null);
  // Press and hold a message for the emoji bar: the iOS app and any touch screen (phone website / home-screen app).
  const holdToOpen = (post: CourseGroupPost) => holdFor(() => { setMenuAnchor(null); setMessageMenu(post); });
  // A real finger always wobbles a little: only a move of more than 10px (a scroll) cancels a press and hold.
  const holdStart = useRef<{ x: number; y: number } | null>(null);
  const movedTooFar = (event: ReactTouchEvent) => { const start = holdStart.current, touch = event.touches[0]; return !start || !touch || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10; };
  const holdFor = (open: () => void) => (isNativeApp || touchScreen) && !guest ? {
    onTouchStart: (event: ReactTouchEvent) => { holdStart.current = { x: event.touches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? 0 }; holdTimer.current = window.setTimeout(() => { holdTimer.current = null; open(); }, 450); },
    onTouchMove: (event: ReactTouchEvent) => { if (!movedTooFar(event)) return; if (holdTimer.current) window.clearTimeout(holdTimer.current); holdTimer.current = null; },
    onTouchEnd: () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); holdTimer.current = null; },
    onContextMenu: (event: SyntheticEvent) => event.preventDefault(),
  } : {};
  // Reactions show instantly; the server answer only corrects it, and live chat reloads wait until it's saved
  // (otherwise a quick add-then-remove flickers between states).
  const withMyReaction = (item: CourseGroupPost, mine: string | null) => {
    const counts = new Map((item.reactions || []).map((reaction) => [reaction.emoji, reaction.count]));
    if (item.myReaction) counts.set(item.myReaction, (counts.get(item.myReaction) || 1) - 1);
    if (mine) counts.set(mine, (counts.get(mine) || 0) + 1);
    return { ...item, myReaction: mine, reactions: [...counts].filter(([, count]) => count > 0).map(([emoji, count]) => ({ emoji, count })) };
  };
  const reactToCoursePost = async (post: CourseGroupPost, emoji: string) => {
    if (!activeCourseGroup || membersOnly("react to messages")) return;
    setMessageMenu(null);
    const current = courseGroupPosts.find((item) => item.id === post.id) || post;
    const next = current.myReaction === emoji ? null : emoji;
    setCourseGroupPosts((items) => items.map((item) => item.id === post.id ? withMyReaction(item, next) : item));
    reactionsSaving.current += 1;
    try {
      const data = await request(`/api/course-groups/${activeCourseGroup.id}/posts/${post.id}/reaction`, { method: "POST", body: JSON.stringify({ emoji }) }, token);
      if ((data.myReaction ?? null) !== next) setCourseGroupPosts((items) => items.map((item) => item.id === post.id ? withMyReaction(item, data.myReaction ?? null) : item));
    } catch (error) {
      setCourseGroupPosts((items) => items.map((item) => item.id === post.id ? withMyReaction(item, current.myReaction ?? null) : item));
      setNotice(error instanceof Error ? error.message : "Unable to react.");
    } finally {
      reactionsSaving.current -= 1;
    }
  };
  const deleteProjectMessage = async (message: ProjectMessage) => {
    const roomId = activeProject?.id;
    setProjectMenu(null);
    if (!roomId || !await askConfirm({ title: "Delete this message?", message: "It's removed for everyone in the group.", action: "Delete" })) return;
    try {
      await request(`/api/project-rooms/${roomId}/messages/${message.id}`, { method: "DELETE" }, token);
      setProjectMessages((items) => items.filter((item) => item.id !== message.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete the message.");
    }
  };
  const deleteCoursePost = async (post: CourseGroupPost) => {
    if (!activeCourseGroup) return;
    setMessageMenu(null);
    setCoursePostMenuId(null);
    if (!await askConfirm({ title: "Delete this message?", message: "It's removed for everyone in the chat.", action: "Delete" })) return;
    try {
      await request(`/api/course-groups/${activeCourseGroup.id}/posts/${post.id}`, { method: "DELETE" }, token);
      setCourseGroupPosts((items) => items.filter((item) => item.id !== post.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete the message.");
    }
  };
  const toggleCoursePostPin = async (post: CourseGroupPost) => {
    if (!activeCourseGroup) return;
    try {
      const data = await request(`/api/course-groups/${activeCourseGroup.id}/posts/${post.id}/pin`, { method: "POST", body: JSON.stringify({ pinned: !post.pinnedAt }) }, token);
      setCourseGroupPosts((items) => items.map((item) => item.id === post.id ? { ...item, pinnedAt: data.pinnedAt } : item));
      markPinsSeen(activeCourseGroup.id); // your own pin isn't news to you
      setCoursePostMenuId(null);
      setMessageMenu(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update the pin.");
    }
  };
  const enterRoom = async (room: Room, openDrawer = true) => {
    try {
      const data = await request(`/api/rooms/${room.id}/messages`, readAuth(), token);
      clearRoomTypers();
      setActiveRoom(room);
      setRoomMessages(data.messages);
      if (openDrawer) setRoomsOpen(true);
      socketRef.current?.emit("roomJoin", { roomId: room.id });
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to enter Room.",
      );
    }
  };
  const sendRoomMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (activeRoom && (roomDraft.trim() || roomPollOptions.length)) {
      socketRef.current?.emit("roomMessage", {
        roomId: activeRoom.id,
        body: roomDraft,
        kind: roomPollOptions.length ? "poll" : "text",
        pollOptions: roomPollOptions,
      });
      setRoomDraft(""); setRoomPollOptions([]);
      signalRoomTyping(false);
    }
  };
  const leaveRoom = () => {
    if (activeRoom) socketRef.current?.emit("roomLeave", { roomId: activeRoom.id });
    clearRoomTypers();
    setActiveRoom(null);
  };
  const clearRoomTypers = () => {
    roomTypingTimers.current.forEach((timer) => window.clearTimeout(timer));
    roomTypingTimers.current.clear();
    setRoomTypers([]);
  };
  const clearCourseGroupTypers = () => {
    courseGroupTypingTimers.current.forEach((timer) => window.clearTimeout(timer));
    courseGroupTypingTimers.current.clear();
    setCourseGroupTypers([]);
  };
  const signalRoomTyping = (typing: boolean) => {
    if (!activeRoom) return;
    if (typing) {
      const now = Date.now();
      if (now - lastRoomTypingSentAt.current < 900) return;
      lastRoomTypingSentAt.current = now;
      socketRef.current?.emit("roomTyping", { roomId: activeRoom.id });
    } else {
      socketRef.current?.emit("roomStopTyping", { roomId: activeRoom.id });
    }
  };
  const signalCourseTyping = (typing: boolean) => {
    if (!activeCourseGroup) return;
    if (typing) {
      const now = Date.now();
      courseKeyAt.current = now;
      if (courseTypingStopped.current) { courseTypingStopped.current = false; lastCourseTypingSentAt.current = 0; }
      if (now - lastCourseTypingSentAt.current < 900) return;
      lastCourseTypingSentAt.current = now;
      socketRef.current?.emit("courseGroupTyping", { groupId: activeCourseGroup.id });
    } else {
      lastCourseTypingSentAt.current = 0;
      socketRef.current?.emit("courseGroupStopTyping", { groupId: activeCourseGroup.id });
    }
  };
  const closeRooms = (after?: () => void) => {
    if (!roomsOpen) { after?.(); return; }
    setClosingRooms(true);
    closingRoomsTimer.current = window.setTimeout(() => {
      closingRoomsTimer.current = null;
      setClosingRooms(false);
      setRoomsOpen(false);
      after?.();
    }, 190);
  };
  const choosePostImages = (files: FileList | null) => {
    const room = MAX_POST_IMAGES - postImages.length;
    const chosen = [...(files || [])];
    if (!chosen.length) return;
    if (room <= 0) { setNotice(`Posts can have up to ${MAX_POST_IMAGES} images.`); return; }
    if (chosen.length > room) setNotice(`Only the first ${room} image${room === 1 ? "" : "s"} were added. Posts can have up to ${MAX_POST_IMAGES}.`);
    for (const file of chosen.slice(0, room)) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setNotice("Choose PNG, JPG, WebP or GIF images."); continue; }
      if (file.size > (file.type === "image/gif" ? 5 : 30) * 1024 * 1024) { setNotice(file.type === "image/gif" ? "GIFs must be 5 MB or smaller." : "Images must be 30 MB or smaller."); continue; }
      shrinkImage(file).then((src) => {
        if (src.length > 7 * 1024 * 1024) { setNotice("That image is too big to upload."); return; }
        const name = src.startsWith("data:image/jpeg") && !/\.jpe?g$/i.test(file.name) ? `${file.name.replace(/\.[^.]+$/, "")}.jpg` : file.name;
        setPostImages((current) => current.length >= MAX_POST_IMAGES ? current : [...current, { src, name, isNew: true }]);
      }).catch((error) => setNotice(error.message));
    }
  };
  const insertPostLink = () => {
    const url = linkUrl.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(url)) { setNotice("Enter a full link starting with https://"); return; }
    const snippet = linkText.trim() ? `[${linkText.trim()}](${url})` : url;
    const textarea = postBodyRef.current;
    const start = textarea?.selectionStart ?? postBody.length;
    const end = textarea?.selectionEnd ?? postBody.length;
    const before = postBody.slice(0, start);
    const spacer = before && !/\s$/.test(before) ? " " : "";
    setPostBody(`${before}${spacer}${snippet}${postBody.slice(end)}`);
    setLinkUrl("");
    setLinkText("");
    setLinkFormOpen(false);
    requestAnimationFrame(() => {
      const caret = start + spacer.length + snippet.length;
      textarea?.focus();
      textarea?.setSelectionRange(caret, caret);
    });
  };
  // From guest mode to a real account: sign the guest out, then sign up or log in.
  const leaveGuest = (next: "auth" | "login") => {
    localStorage.removeItem("mixby-guest");
    setGuestPrompt(null);
    if (account?.isGuest) {
      // The visitor's login and recently visited courses are put aside: Back from sign-up / log-in brings them back,
      // and they're deleted once a real account signs in.
      try { localStorage.setItem(VISITOR_KEY, JSON.stringify({ token, courses: [...(guestCourseIds() || [])] })); } catch { /* storage full or blocked */ }
      localStorage.removeItem("mixby-token");
      localStorage.removeItem(GUEST_COURSES_KEY);
      clearSnapshot();
      setToken("");
      setAccount(null);
    }
    setScreen(next);
  };
  // Returns true (and explains why) when a guest tries something that needs an account.
  // Project room invites: accept to join (and open the room), or decline.
  const acceptInvite = async (item: AppNotification) => {
    if (!item.projectRoomId) return;
    try {
      const data = await request(`/api/project-rooms/${item.projectRoomId}/invite/accept`, { method: "POST" }, token);
      setNotifications((items) => items.filter((other) => other.id !== item.id));
      setNotificationsOpen(false);
      const group = courseGroups.find((candidate) => candidate.id === data.projectRoom.courseGroupId);
      if (group) setCourseHome(group);
      projectReturn.current = "your-courses";
      closeRooms(() => { leaveRoom(); openProjectRoom(data.projectRoom.id); });
      if (NEW_SHELL) {
        // Show the room you just joined (back goes to your courses, where it now appears).
        setRailPanel("courses");
        setMobileMain(true);
        request("/api/chats", {}, token).then((chats) => setChatPreviews(chats)).catch(() => {});
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to accept the invite.");
      loadNotifications().catch(() => {});
    }
  };
  const declineInvite = async (item: AppNotification) => {
    if (!item.projectRoomId) return;
    setNotifications((items) => items.filter((other) => other.id !== item.id));
    request(`/api/project-rooms/${item.projectRoomId}/invite/decline`, { method: "POST" }, token).catch(() => loadNotifications().catch(() => {}));
  };
  // Notifications list: back-to-back messages from the same chat become one row ("5 new" + the latest message),
  // and rows are grouped under Today / Yesterday / This week / Earlier.
  const renderNotificationList = (items: AppNotification[]) => {
    const collapsed: AppNotification[] = [];
    for (const item of items) {
      const last = collapsed[collapsed.length - 1];
      const chat = (entry: AppNotification) => entry.kind === "chat_message" ? `${entry.projectRoomId || ""}:${entry.courseGroupId || ""}` : null;
      if (last && chat(item) && chat(item) === chat(last)) collapsed[collapsed.length - 1] = { ...last, count: (last.count || 1) + 1, unread: last.unread || item.unread };
      else collapsed.push(item);
    }
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const bucket = (iso: string) => {
      const days = (startOfToday.getTime() - new Date(iso).getTime()) / 86400000;
      return days <= 0 ? "Today" : days <= 1 ? "Yesterday" : days <= 7 ? "This week" : "Earlier";
    };
    const sections: { label: string; items: AppNotification[] }[] = [];
    for (const item of collapsed) {
      const label = bucket(item.createdAt);
      if (sections[sections.length - 1]?.label !== label) sections.push({ label, items: [] });
      sections[sections.length - 1].items.push(item);
    }
    return sections.map((section) => (
      <section className="notif-section" key={section.label}>
        <h3 className="notif-day">{section.label}</h3>
        <div className="notifications-list">{section.items.map(renderNotification)}</div>
      </section>
    ));
  };
  const renderNotification = (item: AppNotification) => item.kind === "chat_message" ? (
    <button type="button" className={item.unread ? "notification-item message unread" : "notification-item message"} key={item.id} onClick={() => openNotification(item)}>
      <span className="notif-avatar"><Avatar name={item.actorName} seed={item.actorName} /><span className="notif-kind" aria-hidden="true">{item.projectRoomId ? <Lock size={10} strokeWidth={2.6} /> : <MessageCircle size={10} strokeWidth={2.6} />}</span></span>
      <span className="notification-text">
        <span><strong>{item.actorName}</strong> in <strong>{item.projectRoomId ? item.postTitle : item.postTitle === "general" ? "# general" : item.postTitle}</strong>{item.projectRoomId && item.courseCode ? <span className="notification-where"> · {item.courseCode}</span> : null}</span>
        <small>{(item.count || 1) > 1 && <b className="notif-count">{item.count} new</b>}{item.preview}</small>
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </button>
  ) : item.kind === "new_post" ? (
    <button type="button" className={item.unread ? "notification-item post unread" : "notification-item post"} key={item.id} onClick={() => openNotification(item)}>
      <span className="notification-icon post" aria-hidden="true"><Newspaper size={19} /></span>
      <span className="notification-text">
        <span>New dev post: <strong>{item.postTitle}</strong></span>
        {item.preview && <small>{item.preview}</small>}
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </button>
  ) : item.kind === "course_post" ? (
    <button type="button" className={item.unread ? "notification-item unread" : "notification-item"} key={item.id} onClick={() => openNotification(item)}>
      <Avatar name={item.actorName} seed={item.actorName} />
      <span className="notification-text">
        <span><strong>{item.actorName}</strong> posted in <strong>{item.courseCode}</strong></span>
        {item.postTitle && <small>"{item.postTitle}"</small>}
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </button>
  ) : item.kind === "comment_reply" ? (
    <button type="button" className={item.unread ? "notification-item unread" : "notification-item"} key={item.id} onClick={() => openNotification(item)}>
      <Avatar name={item.actorName} seed={item.actorName} />
      <span className="notification-text">
        <span><strong>{item.actorName}</strong> replied to your comment on <em>{item.postTitle}</em></span>
        {item.preview && <small>"{item.preview}"</small>}
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </button>
  ) : item.kind === "public_group" ? (
    <button type="button" className={item.unread ? "notification-item unread" : "notification-item"} key={item.id} onClick={() => openNotification(item)}>
      <span className="notification-icon" aria-hidden="true"><Users size={19} /></span>
      <span className="notification-text">
        <span><strong>{item.actorName}</strong> started a public group in <strong>{item.courseCode}</strong>: {item.postTitle}</span>
        <small>Anyone in the course can join.</small>
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </button>
  ) : item.kind === "new_course" ? (
    <button type="button" className={item.unread ? "notification-item unread" : "notification-item"} key={item.id} onClick={() => openNotification(item)}>
      <span className="notification-icon" aria-hidden="true"><GraduationCap size={19} /></span>
      <span className="notification-text">
        <span>New course on CCConnect: <strong>{item.courseCode}</strong></span>
        <small>Taking it? Tap to open the chat and join.</small>
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </button>
  ) : item.kind === "course_declined" ? (
    <div className={item.unread ? "notification-item unread" : "notification-item"} key={item.id}>
      <span className="notification-icon" aria-hidden="true"><GraduationCap size={19} /></span>
      <span className="notification-text">
        <span>Your request for <strong>{item.courseCode}</strong> wasn't accepted</span>
        <small>Check the course code. You can ask for it again from Add a course.</small>
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </div>
  ) : item.kind === "course_live" ? (
    <button type="button" className={item.unread ? "notification-item unread" : "notification-item"} key={item.id} onClick={() => openNotification(item)}>
      <span className="notification-icon" aria-hidden="true"><GraduationCap size={19} /></span>
      <span className="notification-text">
        <span><strong>{item.courseCode}</strong> is on CCConnect</span>
        <small>Your course request was accepted. Tap to open it.</small>
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </button>
  ) : item.kind === "posting_ban" ? (
    // From the moderators: why you can't post, and until when (not tappable; it's information).
    <div className={`notification-item ban${item.unread ? " unread" : ""}`} key={item.id} role="note">
      <span className="notification-icon" aria-hidden="true"><Ban size={19} /></span>
      <span className="notification-text">
        <span><strong>{item.active ? "You can't post for 24 hours" : "Your 24-hour posting ban has ended"}</strong></span>
        <small>Reason: {item.preview}{item.active && item.bannedUntil ? ` · You can post again ${formatBanDate(item.bannedUntil)}.` : ""} You can still browse and read.</small>
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </div>
  ) : item.kind === "course_reset" ? (
    <button type="button" className={item.unread ? "notification-item reset unread" : "notification-item reset"} key={item.id} onClick={() => openNotification(item)}>
      <span className="notification-icon" aria-hidden="true"><Clock size={19} /></span>
      <span className="notification-text">
        <span><strong>{item.courseCode}</strong>, its forum and its project rooms reset on <strong>{item.endsOn ? new Date(`${item.endsOn}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "the end of term"}</strong></span>
        <small>Save anything you need. Retaking it? Just rejoin next term.</small>
      </span>
    </button>
  ) : item.kind === "join_request" ? (
    <div className={item.unread ? "notification-item invite unread" : "notification-item invite"} key={item.id}>
      <Avatar name={item.actorName} seed={item.actorName} />
      <span className="notification-text">
        <span><strong>{item.actorName}</strong> wants to join <em>{item.postTitle}</em>{item.courseCode ? ` in ${item.courseCode}` : ""}</span>
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
        <span className="invite-actions"><button type="button" className="invite-accept" onClick={() => answerJoinRequest(item.projectRoomId as string, item.requesterId as string, item.actorName, true)}>Approve</button><button type="button" className="invite-decline" onClick={() => answerJoinRequest(item.projectRoomId as string, item.requesterId as string, item.actorName, false)}>Decline</button></span>
      </span>
    </div>
  ) : item.pending ? (
    <div className={item.unread ? "notification-item invite unread" : "notification-item invite"} key={item.id}>
      <Avatar name={item.actorName} seed={item.actorName} />
      <span className="notification-text">
        <span><strong>{item.actorName}</strong> invited you to <em>{item.postTitle}</em>{item.courseCode ? ` in ${item.courseCode}` : ""}</span>
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
        <span className="invite-actions"><button type="button" className="invite-accept" onClick={() => acceptInvite(item)}>Accept</button><button type="button" className="invite-decline" onClick={() => declineInvite(item)}>Decline</button></span>
      </span>
    </div>
  ) : (
    <button type="button" className={item.unread ? "notification-item unread" : "notification-item"} key={item.id} onClick={() => openNotification(item)}>
      <Avatar name={item.actorName} seed={item.actorName} />
      <span className="notification-text">
        <span><strong>{item.actorName}</strong> {item.kind === "project_invite" ? <>added you to <em>{item.postTitle}</em>{item.courseCode ? ` in ${item.courseCode}` : ""}</> : <>commented on <em>{item.postTitle}</em></>}</span>
        {item.preview && <small>"{item.preview}"</small>}
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </button>
  );
  const membersOnly = (action: string) => {
    if (!guest) return false;
    setGuestPrompt(action);
    return true;
  };
  // iOS app: which screens are top-level (title bar + tab bar) versus full-screen detail views.
  const appRootTab = tab === "social" || tab === "alerts" || (tab === "rooms" && !activeRoom) || tab === "browse-courses" || tab === "your-courses" || tab === "profile" || (tab === "moderation" && isAdmin);
  const appTitle = tab === "alerts" ? "Alerts" : tab === "rooms" ? "Rooms" : tab === "browse-courses" ? (POSTS_ENABLED ? "Browse courses" : "Discover") : tab === "your-courses" ? "Chats" : tab === "profile" ? "Profile" : tab === "moderation" ? "Moderation" : tab === "create" ? (editingPost ? "Edit post" : "New post") : "";
  const goTab = (next: typeof tab) => closeRooms(() => { leaveRoom(); setTab(next); });
  // iOS app: one scrollable chip row shared by a course chat and its project rooms —
  // the main chat, its pinned comments, each project room, and + Room. The chat you're in is highlighted.
  const goToCourseChat = (group: CourseGroup, view: "chat" | "pinned") => {
    if (tab === "project-room" && activeCourseGroup?.id === group.id) { projectReturn.current = "course-group"; closeProjectRoom(); setCourseGroupView(view); return; }
    if (tab === "project-room") { closeProjectRoom(); openCourseGroup(group).then(() => setCourseGroupView(view)); return; }
    setCourseGroupView(view);
  };
  const renderCourseChips = (group: CourseGroup) => {
    const inChat = tab === "course-group";
    const pinnedCount = activeCourseGroup?.id === group.id ? courseGroupPosts.filter((post) => post.pinnedAt).length : 0;
    return (
      <div className="course-chat-chips">
        <button type="button" className={inChat && courseGroupView === "chat" ? "chip main active" : "chip main"} onClick={() => goToCourseChat(group, "chat")}><MessageCircle size={13} />{group.courseCode}</button>
        <button type="button" className={inChat && courseGroupView === "pinned" ? "chip pinned active" : "chip pinned"} onClick={() => goToCourseChat(group, inChat && courseGroupView === "pinned" ? "chat" : "pinned")}><Pin size={13} />Pinned{pinnedCount > 0 ? ` ${pinnedCount}` : ""}</button>
        {projectRooms.filter((room) => room.courseGroupId === group.id).map((room) => (
          <button type="button" className={tab === "project-room" && activeProject?.id === room.id ? "chip active" : "chip"} key={room.id} onClick={() => { if (activeProject?.id === room.id) return; if (tab === "course-group") projectReturn.current = "course-group"; if (activeProject) socketRef.current?.emit("projectRoomLeave", { projectRoomId: activeProject.id }); openProjectRoom(room.id); }}><FolderKanban size={13} />{room.name}{room.unreadCount > 0 && activeProject?.id !== room.id && <b>{capCount(room.unreadCount)}</b>}</button>
        ))}
        <button type="button" className="chip add" onClick={() => { if (postingBannedUntil) { setNotice("You can't create rooms while you're banned from posting."); return; } setCourseHome(group); openProjectPicker("create", group); }}><Plus size={13} />Room</button>
      </div>
    );
  };
  // Leaving the Alerts tab clears the "new" dots (like closing the website's bell panel).
  const previousTab = useRef(tab);
  useEffect(() => {
    if (previousTab.current === "alerts" && tab !== "alerts") setNotifications((items) => items.map((item) => ({ ...item, unread: false })));
    previousTab.current = tab;
  }, [tab]);
  // iOS app: the Alerts tab is the notifications list; opening it marks everything seen (items keep their dot until you leave).
  const alertsReturn = useRef<typeof tab>("your-courses");
  const openAlerts = () => {
    if (tab !== "alerts") alertsReturn.current = tab;
    if (unreadNotifications > 0) {
      markNotificationsSeen();
    }
    goTab("alerts");
  };
  const startNewPost = () => { if (membersOnly("create a post")) return; closeRooms(() => { leaveRoom(); setEditingPost(null); setPostScope("dev"); setPostKind("info"); setPostFlair(null); setPostImages([]); setLinkFormOpen(false); setPostTitle(""); setPostBody(""); setExternalUrl(""); setTab("create"); }); };
  // Permanently delete the account (Apple requires this in the app), then sign out.
  const deleteAccount = async () => {
    if (!await askConfirm({ title: "Delete your CCConnect account?", message: "This permanently deletes your profile, posts, comments and messages. It can't be undone.", action: "Continue" })) return;
    if (!await askConfirm({ title: "Are you sure?", message: "Your account will be gone for good.", action: "Delete my account" })) return;
    try {
      await request("/api/account", { method: "DELETE" }, token);
      localStorage.removeItem("mixby-token");
      clearSnapshot();
      setToken("");
      setAccount(null);
      setLanding(false);
      setScreen("auth");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete your account.");
    }
  };
  // Browse as guest (migration 048): a guest account whose login is kept on this device (app storage in the iPhone app,
  // browser storage on the website), like any login. Guests read but can't send or create; senders show as "York Student".
  const startGuest = async () => {
    try {
      const data = await request("/api/auth/guest", { method: "POST", body: "{}" });
      localStorage.setItem("mixby-token", data.token);
      saveGuestCourses(new Set());
      setToken(data.token);
      setAccount(data.account);
      setNotice((current) => current.startsWith("Can't reach CCConnect") ? "" : current);
      // Visitors land in the General Forum: posts from every course, so it's clear people are here.
      setTab("general-forum");
      setMobileMain(true);
      setScreen("app");
    } catch (error) {
      // Can't reach CCConnect (a phone just waking up, a fresh install whose network isn't ready, a server restart): keep
      // the loading screen and try again, instead of dropping a new visitor on the sign-up page. A real refusal
      // (e.g. too many new visitors from one address) still shows sign-up with the reason.
      const status = (error as Error & { status?: number }).status;
      if (!status) {
        setNotice("Can't reach CCConnect right now. Retrying…");
        window.setTimeout(() => { if (!localStorage.getItem("mixby-token")) startGuest(); }, 3000);
        return;
      }
      setNotice(error instanceof Error ? error.message : "Unable to start guest browsing.");
      setScreen((current) => current === "loading" ? "auth" : current);
    }
  };
  // Back to browsing as a visitor: the visitor login put aside at sign-up / log-in, or a new one.
  const enterAsVisitor = () => {
    let saved: { token?: string; courses?: string[] } | null = null;
    try { saved = JSON.parse(localStorage.getItem(VISITOR_KEY) || "null"); } catch { saved = null; }
    localStorage.removeItem(VISITOR_KEY);
    setNotice("");
    if (saved?.token) {
      localStorage.setItem("mixby-token", saved.token);
      saveGuestCourses(new Set(saved.courses || []));
      setScreen("loading");
      setToken(saved.token);
      return;
    }
    setScreen("loading");
    startGuest();
  };
  // A real account signed in: the visitor login put aside earlier isn't needed any more.
  const forgetVisitor = () => {
    let saved: { token?: string } | null = null;
    try { saved = JSON.parse(localStorage.getItem(VISITOR_KEY) || "null"); } catch { saved = null; }
    if (!saved) return;
    localStorage.removeItem(VISITOR_KEY);
    if (saved.token) request("/api/account", { method: "DELETE" }, saved.token).catch(() => {});
  };
  const logout = () => {
    // Stop pushes to this device for the account that's signing out.
    if (currentDeviceToken()) request("/api/push-tokens", { method: "DELETE", body: JSON.stringify({ token: currentDeviceToken() }) }, token).catch(() => {});
    // Website: this browser stops getting this account's notifications (it's re-linked when someone signs in again).
    const signingOut = token;
    if (!isNativeApp) currentSubscription().then((subscription) => { if (subscription) request("/api/web-push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }, signingOut).catch(() => {}); }).catch(() => {});
    localStorage.removeItem("mixby-token");
    localStorage.removeItem(GUEST_COURSES_KEY);
    clearSnapshot();
    setToken("");
    setAccount(null);
    setSignupName("");
    setNameChosen(false);
    // Signed out: carry on as a visitor.
    enterAsVisitor();
  };
  const filteredPosts = posts.filter(
    (post) =>
      (feedKind === "all" || post.kind === feedKind) &&
      `${post.body} ${post.author.displayName} ${post.author.program}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const myCourses = courseGroups.filter((group) => group.joined);
  const totalCourseUnread = myCourses.reduce((total, group) => total + (group.unreadCount || 0), 0);
  const pendingRequests = courseRequests.filter((item) => item.status === "pending");
  const upcomingCourses = courseRequests.filter(
    (item) => item.status === "approved" && item.termName !== currentTermName,
  );
  const browseCourses = [...courseGroups].sort((a, b) => b.memberCount - a.memberCount).filter(
    (group) =>
      (!group.joined || courseQuery.trim().length > 0) &&
      `${group.courseCode} ${group.termName}`
        .toLowerCase()
        .includes(courseQuery.trim().toLowerCase()),
  );
  // Add a course: the York list is filtered only when the search (or the course list) changes, and from a deferred copy
  // of the search, so typing never waits for 5,000 courses to be checked.
  // Smart search (search.ts): while you type in a course chat, the server searches the whole term (full-text + typos,
  // migration 045) and sends back the matches with their replies and the messages around them; the app ranks those
  // together with what's on the phone. `searchThread`: a conversation opened from search that isn't loaded in the chat.
  // ---- The Feed (replaces Dev Posts) ----
  const [feedPosts, setFeedPosts] = useState<FeedPost[] | null>(null);
  const [feedCaughtUpAt, setFeedCaughtUpAt] = useState(0);
  const [feedSheet, setFeedSheet] = useState<FeedPost | null>(null); // comments sheet over the feed
  // Instagram-style comments (owner's call, Oct 28 2026): a post with no description (a title, maybe photos) opens its
  // comments in a sheet over the list instead of its own page, so the post stays on screen above it.
  const [sheetPost, setSheetPost] = useState<Post | null>(null);
  // Course notes: mine (all courses), the open one, its entries, and the "name your note" window.
  const [notes, setNotes] = useState<CourseNote[]>([]);
  const [activeNote, setActiveNote] = useState<CourseNote | null>(null);
  const [noteEntries, setNoteEntries] = useState<NoteEntry[] | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteImage, setNoteImage] = useState<string | null>(null);
  const [noteNaming, setNoteNaming] = useState<{ group: CourseGroup; name: string } | null>(null);
  const noteCache = useRef(new Map<string, NoteEntry[]>());
  const noteListRef = useRef<HTMLDivElement | null>(null);
  const noteHold = useRef<number | null>(null);
  // Press and hold (or right-click) a note entry: Post about this, Copy, Delete.
  const [noteEntryMenu, setNoteEntryMenu] = useState<{ entry: NoteEntry; x: number; y: number; sheet: boolean } | null>(null);
  // Share in a note's header: select mode (owner's call, Nov 2 2026). The messages wobble; tapping one posts about it.
  const [noteSelecting, setNoteSelecting] = useState(false);
  useEffect(() => { setNoteSelecting(false); }, [tab, activeNote?.id]);
  // Each message wiggles on its own: the angle comes from its size so every edge travels about the same distance
  // (edge travel = radius x angle, so a fixed angle shakes big photos and barely moves small text), with its own
  // speed, phase and pivot so they never move in step.
  useEffect(() => {
    if (!noteSelecting) return;
    document.querySelectorAll<HTMLElement>(".mx-note-page .mx-note-bubble").forEach((bubble) => {
      const radius = Math.hypot(bubble.offsetWidth, bubble.offsetHeight) / 2 || 40;
      const vary = (spread: number) => 1 + (Math.random() * 2 - 1) * spread;
      const degrees = Math.min(3, ((1.7 * vary(0.15)) / radius) * (180 / Math.PI));
      const period = 0.34 * vary(0.14);
      bubble.style.setProperty("--wa", `${degrees.toFixed(2)}deg`);
      bubble.style.setProperty("--wx", `${(0.55 * vary(0.25)).toFixed(2)}px`);
      bubble.style.setProperty("--wy", `${(0.45 * vary(0.25)).toFixed(2)}px`);
      bubble.style.setProperty("--wd", `${period.toFixed(3)}s`);
      bubble.style.setProperty("--wo", `${(-Math.random() * period).toFixed(3)}s`);
      bubble.style.transformOrigin = `${44 + Math.random() * 12}% ${44 + Math.random() * 12}%`;
    });
  }, [noteSelecting, noteEntries]);
  useEffect(() => {
    if (!noteSelecting) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setNoteSelecting(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [noteSelecting]);
  const scrollNoteToEnd = () => window.requestAnimationFrame(() => { const list = noteListRef.current; if (list) list.scrollTop = list.scrollHeight; });
  // Notes are local first (notesync.ts): the device copy shows at once, changes are saved here and then synced to
  // the cloud in the background (`syncNotes`), now or when the connection is back.
  const noteAccount = account?.id || "";
  const activeNoteId = useRef<string | null>(null);
  // A note opens behind a loading overlay and appears once its entries and photos have loaded (at most 5 s).
  const [noteReady, setNoteReady] = useState(false);
  useEffect(() => {
    if (tab !== "note" || noteReady || noteEntries === null) return;
    let live = true;
    const frame = window.requestAnimationFrame(() => {
      const images = [...(noteListRef.current?.querySelectorAll("img") || [])];
      const loaded = Promise.all(images.map((image) => image.complete ? null : new Promise((done) => { image.addEventListener("load", done, { once: true }); image.addEventListener("error", done, { once: true }); })));
      Promise.race([loaded, new Promise((done) => window.setTimeout(done, 5000))]).then(() => {
        if (!live) return;
        setNoteReady(true);
        scrollNoteToEnd();
      });
    });
    return () => { live = false; window.cancelAnimationFrame(frame); };
  }, [tab, noteReady, noteEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  const noteSyncRunning = useRef(false);
  const refreshNoteView = async (noteId: string) => {
    const [snapshot, ops] = await Promise.all([readNoteSnapshot(noteAccount, noteId), pendingOps(noteAccount)]);
    if (activeNoteId.current !== noteId || (snapshot === null && !ops.some((op) => op.noteId === noteId))) return;
    const view = noteView(snapshot || [], ops, noteId);
    noteCache.current.set(noteId, view);
    setNoteEntries(view);
  };
  const openNote = async (note: CourseNote) => {
    setActiveNote(note);
    activeNoteId.current = note.id;
    setNoteReady(false);
    setNoteDraft(""); setNoteImage(null);
    setNoteEntries(noteCache.current.get(note.id) || null);
    setTab("note");
    setMobileMain(true);
    scrollNoteToEnd();
    refreshNoteView(note.id).then(scrollNoteToEnd);
    try {
      const data = await request(`/api/notes/${note.id}/entries`, readAuth(), token);
      await writeNoteSnapshot(noteAccount, note.id, data.entries);
      setActiveNote((current) => current?.id === note.id ? { ...current, ...data.note } : current);
      // Photos from when note photos stayed on the phone go up to the cloud too, if this is the phone that has them.
      const ops = await pendingOps(noteAccount);
      for (const entry of data.entries as NoteEntry[]) {
        if (!entry.imageUrl?.startsWith(DEVICE_PHOTO) || ops.some((op) => op.kind === "photo" && op.entryId === entry.id)) continue;
        const photoId = entry.imageUrl.slice(DEVICE_PHOTO.length);
        if (await loadPhoto(photoId)) await queueOp({ id: `photo-${entry.id}`, kind: "photo", account: noteAccount, noteId: note.id, entryId: entry.id, photoId, createdAt: new Date().toISOString() });
      }
      await refreshNoteView(note.id);
      scrollNoteToEnd();
      syncNotes();
    } catch {
      // Offline: the device copy stays on screen.
      setNoteEntries((current) => current || []);
    }
  };
  const createNote = async () => {
    if (!noteNaming) return;
    const name = noteNaming.name.trim();
    if (!name) return;
    try {
      const data = await request(`/api/course-groups/${noteNaming.group.id}/notes`, { method: "POST", body: JSON.stringify({ name }) }, token);
      setNoteNaming(null);
      setNotes((list) => [...list, data.note]);
      setOpenCourses([data.note.courseGroupId]); // show it under its course
      noteCache.current.set(data.note.id, []);
      openNote(data.note);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create the note.");
    }
  };
  const sendNoteEntry = async () => {
    const note = activeNote;
    const body = noteDraft.trim(), image = noteImage;
    if (!note || !noteAccount || (!body && !image)) return;
    const photoId = image ? crypto.randomUUID() : null;
    setNoteDraft(""); setNoteImage(null);
    try {
      if (photoId && image) await savePhoto(photoId, note.id, image);
      await queueOp({ id: `local-${crypto.randomUUID()}`, kind: "add", account: noteAccount, noteId: note.id, body, photoId, createdAt: new Date().toISOString() });
    } catch {
      setNoteDraft((current) => current || body); setNoteImage((current) => current || image);
      setNotice("That couldn't be saved on this device.");
      return;
    }
    await refreshNoteView(note.id);
    scrollNoteToEnd();
    syncNotes();
  };
  // Sends this device's note changes to the cloud, oldest first. Stops at the first network problem and tries again
  // later (back online, app reopened, or in 20 s); a change the cloud refuses for good is dropped.
  const syncNotes = async () => {
    if (noteSyncRunning.current || !token || !noteAccount || account?.isGuest) return;
    noteSyncRunning.current = true;
    try {
      const ops = await pendingOps(noteAccount);
      for (const op of ops) {
        try {
          await syncNoteOp(op);
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (!status || status === 429 || status === 403 || status >= 500) throw error; // try again later
          await dropOp(op.id);
          if ("photoId" in op && op.photoId && op.kind === "add") forgetPhoto(op.photoId);
        }
        await refreshNoteView(op.noteId);
      }
    } catch {
      window.setTimeout(() => { syncNotes(); }, 20000);
    } finally {
      noteSyncRunning.current = false;
    }
  };
  const uploadNotePhoto = async (noteId: string, photoId: string) => {
    const dataUrl = await loadPhoto(photoId);
    return dataUrl ? (await request("/api/chat-attachments", { method: "POST", body: JSON.stringify({ scope: "note", parentId: noteId, fileData: dataUrl, fileName: "photo.jpg" }) }, token)).attachmentUrl as string : null;
  };
  const syncNoteOp = async (op: NoteOp) => {
    const snapshot = (await readNoteSnapshot(noteAccount, op.noteId)) || [];
    if (op.kind === "add") {
      const imageUrl = op.photoId ? await uploadNotePhoto(op.noteId, op.photoId) : null;
      if (!op.body && !imageUrl) { await dropOp(op.id); return; }
      const data = await request(`/api/notes/${op.noteId}/entries`, { method: "POST", body: JSON.stringify({ body: op.body, imageUrl }) }, token);
      // Deleted here while it was being sent: delete it in the cloud too.
      const stillWanted = (await pendingOps(noteAccount)).some((item) => item.id === op.id);
      await dropOp(op.id);
      if (stillWanted) await writeNoteSnapshot(noteAccount, op.noteId, [...snapshot, data.entry]);
      else await request(`/api/notes/${op.noteId}/entries/${data.entry.id}`, { method: "DELETE" }, token).catch(() => {});
      if (op.photoId) { if (imageUrl) cachePhotoUrl(imageUrl, op.photoId); forgetPhoto(op.photoId); }
    } else if (op.kind === "delete") {
      await request(`/api/notes/${op.noteId}/entries/${op.entryId}`, { method: "DELETE" }, token).catch((error) => { if ((error as { status?: number }).status !== 404) throw error; });
      await dropOp(op.id);
      await writeNoteSnapshot(noteAccount, op.noteId, snapshot.filter((entry) => entry.id !== op.entryId));
    } else {
      const imageUrl = await uploadNotePhoto(op.noteId, op.photoId);
      if (imageUrl) {
        const data = await request(`/api/notes/${op.noteId}/entries/${op.entryId}`, { method: "PATCH", body: JSON.stringify({ imageUrl }) }, token);
        await writeNoteSnapshot(noteAccount, op.noteId, snapshot.map((entry) => entry.id === op.entryId ? data.entry : entry));
        cachePhotoUrl(imageUrl, op.photoId);
      }
      await dropOp(op.id);
      forgetPhoto(op.photoId);
    }
  };
  // The photo just uploaded is already in memory: show it from there instead of downloading it again.
  const cachePhotoUrl = (url: string, photoId: string) => { const dataUrl = cachedPhoto(photoId); if (dataUrl) uploadedNotePhotos.set(url, dataUrl); };
  const deleteNoteEntry = async (entry: NoteEntry) => {
    const note = activeNote;
    if (!note || !noteAccount) return;
    if (!await askConfirm({ title: "Delete this?", message: "It's removed from your note.", action: "Delete" })) return;
    if (entry.id.startsWith("local-")) {
      // Never reached the cloud: just drop it here.
      await dropOp(entry.id);
      if (entry.imageUrl?.startsWith(DEVICE_PHOTO)) forgetPhoto(entry.imageUrl.slice(DEVICE_PHOTO.length));
    } else {
      await queueOp({ id: `del-${entry.id}`, kind: "delete", account: noteAccount, noteId: note.id, entryId: entry.id, createdAt: new Date().toISOString() });
    }
    await refreshNoteView(note.id);
    syncNotes();
  };
  const deleteNote = async (note: CourseNote) => {
    if (!await askConfirm({ title: `Delete "${note.name}"?`, message: "The note and everything in it are deleted for good.", action: "Delete note" })) return;
    try {
      await request(`/api/notes/${note.id}`, { method: "DELETE" }, token);
      setNotes((list) => list.filter((item) => item.id !== note.id));
      noteCache.current.delete(note.id);
      forgetNote(noteAccount, note.id);
      if (activeNote?.id === note.id) { setActiveNote(null); setTab(FORUM_HOME); setMobileMain(false); }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete the note.");
    }
  };
  // Share a note in its course's forum: a new post with the note's name, its text and up to 6 of its photos.
  // Cancel (or Back) goes back to the note.
  const sharedNote = useRef<CourseNote | null>(null);
  const backToSharedNote = () => { const note = sharedNote.current; sharedNote.current = null; if (!note) return false; setEditingPost(null); openNote(note); return true; };
  useEffect(() => { if (tab !== "create") sharedNote.current = null; }, [tab]);
  // Post about one entry (owner's call, Nov 1 2026): its photo is attached; text that fits the title (120 characters,
  // line breaks become spaces) becomes the title, longer text goes in the description and you write the title.
  const postAboutEntry = (note: CourseNote, entry: NoteEntry) => {
    const text = entry.body.trim();
    const asTitle = text.replace(/\s*\n\s*/g, " ");
    const fits = text.length > 0 && asTitle.length <= 120;
    postFromNote(note, [{ ...entry, body: fits ? "" : text }], fits ? asTitle : "");
  };
  const postFromNote = async (note: CourseNote, entries: NoteEntry[], title: string) => {
    const course = courseGroups.find((group) => group.id === note.courseGroupId);
    if (!course) return;
    const text = entries.map((entry) => entry.body).filter(Boolean).join("\n\n");
    // Photos already in the cloud are copied there by the server when you post (fast); ones still only on this phone
    // go up with the post like any new photo.
    const photos = await Promise.all(entries.filter((entry) => entry.imageUrl).slice(-MAX_POST_IMAGES).map(async (entry) => {
      const url = entry.imageUrl as string;
      if (url.startsWith("data:")) return { src: url, name: "photo.jpg", isNew: true };
      if (url.startsWith(DEVICE_PHOTO)) { const src = await loadPhoto(url.slice(DEVICE_PHOTO.length)); return src ? { src, name: "photo.jpg", isNew: true } : null; }
      return { src: url, isNew: true, copyFrom: url };
    }));
    setActiveCourseGroup({ ...course });
    loadCourseForum(course.id).catch(() => {});
    setEditingPost(null); setPostScope("course"); setPostKind("info"); setPostFlair(null); setExternalUrl("");
    setPostTitle(title); setPostBody(text);
    setPostImages(photos.filter((photo): photo is NonNullable<typeof photo> => Boolean(photo)));
    setTab("create");
    setMobileMain(true);
    sharedNote.current = note;
  };
  // Note changes waiting on this device go up when the app starts, comes back to the screen or gets its connection back.
  useEffect(() => {
    if (!token || !noteAccount || account?.isGuest) return;
    const kick = () => { if (document.visibilityState !== "hidden") syncNotes(); };
    kick();
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    return () => { window.removeEventListener("online", kick); document.removeEventListener("visibilitychange", kick); };
  }, [token, noteAccount, account?.isGuest]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sheetFull, setSheetFull] = useState(false); // comments swiped up to full screen
  const [sheetClosing, setSheetClosing] = useState(false); // playing the close animation
  const [sheetLong, setSheetLong] = useState(false); // opened from a long post: full screen only
  const sheetRef = useRef<HTMLDivElement>(null); // the comments panel (follows the finger while dragged)
  const sheetGrabRef = useRef<HTMLDivElement>(null); // its handle + header: where a drag starts
  const closeSheetRef = useRef<() => void>(() => {});
  closeSheetRef.current = () => closeCommentsSheet(); // the latest one (it reads the current sheet)
  const sheetLongRef = useRef(false);
  sheetLongRef.current = sheetLong;
  // Drag the comments panel like Instagram: it follows the finger, then snaps to full screen, two thirds, or closes.
  // Native listeners so the move can stop the page itself from scrolling (React's touch handlers can't).
  useEffect(() => {
    const grab = sheetGrabRef.current, sheet = sheetRef.current, layer = sheet?.parentElement;
    if (!grab || !sheet || !layer) return;
    let startY = 0, startTop = 0, lastY = 0, dragging = false;
    const topNow = () => sheet.getBoundingClientRect().top - layer.getBoundingClientRect().top;
    const start = (event: TouchEvent) => { dragging = true; startY = lastY = event.touches[0]?.clientY ?? 0; startTop = topNow(); sheet.style.transition = "none"; };
    const move = (event: TouchEvent) => {
      if (!dragging) return;
      event.preventDefault();
      lastY = event.touches[0]?.clientY ?? lastY;
      sheet.style.top = `${Math.min(layer.clientHeight, Math.max(0, startTop + lastY - startY))}px`;
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      const height = layer.clientHeight, moved = lastY - startY, top = topNow();
      sheet.style.transition = "";
      const wasFull = startTop < height * 0.1;
      const outcome = sheetLongRef.current ? (moved > 80 ? "close" : "full") : wasFull ? (top > height * 0.66 ? "close" : moved > 60 ? "normal" : "full") : (moved < -50 ? "full" : moved > 80 ? "close" : "normal");
      if (outcome === "close") { closeSheetRef.current(); return; } // slides down from where the finger left it
      sheet.style.top = "";
      setSheetFull(outcome === "full");
    };
    grab.addEventListener("touchstart", start, { passive: true });
    grab.addEventListener("touchmove", move, { passive: false });
    grab.addEventListener("touchend", end);
    grab.addEventListener("touchcancel", end);
    return () => { grab.removeEventListener("touchstart", start); grab.removeEventListener("touchmove", move); grab.removeEventListener("touchend", end); grab.removeEventListener("touchcancel", end); };
  }, [sheetPost?.id]);
  const [feedComposer, setFeedComposer] = useState(false);
  const [feedDraft, setFeedDraft] = useState("");
  const [feedPoll, setFeedPoll] = useState<[string, string] | null>(null);
  const [feedMenu, setFeedMenu] = useState<string | null>(null); // ⋯ menu open on this post
  const feedPosition = useRef(""); // the post on screen, so coming back to the feed returns to it
  // Desktop page or phone panel (the Feed is drawn in only one of them); follows rotating / folding the screen.
  // (The width is read on every draw; this only makes sure crossing 900px causes a redraw.)
  const [, setFeedWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches);
  useEffect(() => { const query = window.matchMedia("(min-width: 900px)"); const update = () => setFeedWide(query.matches); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  const feedSeenQueue = useRef(new Set<string>());
  const feedAsPost = (post: FeedPost): Post => ({ id: post.id, kind: "info", body: post.body, imageUrls: post.imageUrls, externalUrl: null, createdAt: post.createdAt, author: post.author, reactionCounts: { like: post.likes }, commentCount: post.commentCount, myReaction: post.liked ? "like" : null, isMine: post.isMine });
  const loadFeed = async () => {
    try {
      const data = await request("/api/feed", readAuth(), token);
      setFeedPosts(data.posts);
      setFeedCaughtUpAt(data.caughtUpAt ?? data.posts.length);
    } catch (error) {
      setFeedPosts((current) => current || []);
      setNotice(error instanceof Error ? error.message : "Unable to load the feed.");
    }
  };
  const feedShowing = FEED_ENABLED && !guest && (tab === "social" || railPanel === "posts");
  useEffect(() => { if (feedShowing && feedPosts === null) loadFeed(); }, [feedShowing]);
  // Seen: a post that stays on screen for a moment moves behind unseen ones next time (sent in small batches).
  useEffect(() => {
    if (!feedShowing || typeof IntersectionObserver === "undefined") return;
    const timers = new Map<Element, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.post;
        if (!id) continue;
        if (entry.isIntersecting) {
          feedPosition.current = id;
          timers.set(entry.target, window.setTimeout(() => feedSeenQueue.current.add(id), 900));
        } else window.clearTimeout(timers.get(entry.target));
      }
    }, { threshold: 0.6 });
    document.querySelectorAll(".mx-reel-item[data-post]").forEach((item) => observer.observe(item));
    const flush = window.setInterval(() => {
      const ids = [...feedSeenQueue.current];
      if (!ids.length) return;
      feedSeenQueue.current.clear();
      request("/api/feed/seen", { method: "POST", body: JSON.stringify({ ids }) }, token).catch(() => {});
    }, 2500);
    return () => { observer.disconnect(); timers.forEach((timer) => window.clearTimeout(timer)); window.clearInterval(flush); };
  }, [feedShowing, feedPosts]);
  // Coming back to the feed: back to the post you were on.
  useEffect(() => {
    if (!feedShowing || !feedPosts?.length || !feedPosition.current) return;
    const item = document.querySelector(`.mx-reel-item[data-post="${CSS.escape(feedPosition.current)}"]`);
    item?.scrollIntoView({ block: "start" });
  }, [feedShowing, Boolean(feedPosts?.length)]);
  const updateFeedPost = (id: string, change: Partial<FeedPost>) => setFeedPosts((list) => list && list.map((post) => post.id === id ? { ...post, ...change } : post));
  const likeFeedPost = async (post: FeedPost) => {
    if (membersOnly("like posts")) return;
    const liked = !post.liked;
    updateFeedPost(post.id, { liked, likes: Math.max(0, post.likes + (liked ? 1 : -1)) });
    try {
      const data = await request(`/api/social/posts/${post.id}/like`, { method: "POST", body: JSON.stringify({ liked }) }, token);
      updateFeedPost(post.id, { liked: data.liked, likes: data.likes });
    } catch (error) {
      updateFeedPost(post.id, { liked: post.liked, likes: post.likes });
      setNotice(error instanceof Error ? error.message : "Unable to like that.");
    }
  };
  const voteFeedPoll = async (post: FeedPost, option: number) => {
    if (membersOnly("vote") || post.myVote !== null) return;
    updateFeedPost(post.id, { myVote: option, pollCounts: post.pollCounts.map((count, index) => count + (index === option ? 1 : 0)) });
    try {
      const data = await request(`/api/social/posts/${post.id}/poll`, { method: "POST", body: JSON.stringify({ option }) }, token);
      updateFeedPost(post.id, { myVote: data.myVote, pollCounts: data.pollCounts });
    } catch (error) {
      updateFeedPost(post.id, { myVote: null, pollCounts: post.pollCounts });
      setNotice(error instanceof Error ? error.message : "Unable to vote.");
    }
  };
  const openFeedComments = async (post: FeedPost) => {
    setFeedMenu(null);
    setFeedSheet(post);
    setCommentPost(feedAsPost(post));
    setComments([]);
    setReplyTo(null);
    try {
      const data = await request(`/api/social/posts/${post.id}/comments`, readAuth(), token);
      setComments(data.comments);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load comments.");
    }
  };
  const closeFeedComments = () => {
    const post = feedSheet;
    setFeedSheet(null);
    if (post) updateFeedPost(post.id, { commentCount: comments.filter((comment) => !comment.pending).length });
  };
  const publishFeedPost = async () => {
    const text = feedDraft.trim();
    const poll = feedPoll && feedPoll.map((option) => option.trim());
    if (!text) return;
    if (poll && (!poll[0] || !poll[1])) { setNotice("Write both answers for the poll."); return; }
    try {
      const data = await request("/api/social/posts", { method: "POST", body: JSON.stringify({ asTeam: sendAsTeam, kind: "info", body: text, externalUrl: "", ...(poll ? { pollOptions: poll } : {}) }) }, token);
      setFeedDraft(""); setFeedPoll(null); setFeedComposer(false);
      if (data.post?.id) feedPosition.current = data.post.id;
      await loadFeed();
      window.requestAnimationFrame(() => document.querySelector(`.mx-reel-item[data-post="${CSS.escape(data.post?.id || "")}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to post.");
    }
  };
  const [serverSearch, setServerSearch] = useState<{ groupId: string; key: string; messages: CourseGroupPost[]; clicks: Record<string, number> } | null>(null);
  const [searchThread, setSearchThread] = useState<{ ids: string[]; focus: string } | null>(null);
  const searchText = tab === "course-group" && activeCourseGroup && !activeCourseGroup.isDegree && !guest ? (chatFind ?? coursePostBody).trim() : "";
  // The bar on the phone starts from the first letter (it costs nothing); the server only from 3 letters, or 2 for a
  // short word the campus dictionary knows ("mt"), 300 ms after you stop typing.
  useEffect(() => {
    if (!activeCourseGroup || (searchText.length < 3 && !(searchText.length === 2 && isDictionaryWord(searchText)))) return;
    const groupId = activeCourseGroup.id;
    const timer = window.setTimeout(() => {
      const key = queryKey(searchText);
      request(`/api/course-groups/${groupId}/search?g=${encodeURIComponent(JSON.stringify(queryGroups(searchText)))}&q=${encodeURIComponent(searchText)}&key=${encodeURIComponent(key)}`, readAuth(), token)
        .then((data) => setServerSearch({ groupId, key, messages: data.messages || [], clicks: data.clicks || {} }))
        .catch(() => {});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText, activeCourseGroup?.id]);
  useEffect(() => { setSearchThread(null); }, [activeCourseGroup?.id, tab]);
  const deferredCourseQuery = useDeferredValue(courseQuery);
  const courseSearch = useMemo(() => {
    const query = deferredCourseQuery.trim().toUpperCase();
    const squash = (value: string) => value.toUpperCase().replace(/\s+/g, "");
    const needle = squash(query);
    const titleOf = new Map(courseCatalog);
    const liveCodes = new Set([...courseGroups.map((group) => squash(group.courseCode)), ...pendingRequests.map((item) => squash(item.courseCode))]);
    const words = query.split(/\s+/).filter(Boolean);
    const unlisted = courseCatalog.filter(([code]) => !liveCodes.has(squash(code)));
    const allCatalog = !query ? unlisted : query.length >= 2 ? unlisted.filter(([code, title]) => squash(code).includes(needle) || words.every((word) => title.toUpperCase().includes(word)))
      // Code matches before title matches, then undergraduate (1000-4999) before graduate courses.
      .map((course) => ({ course, rank: (squash(course[0]).includes(needle) ? 0 : 2) + (Number(course[0].match(/\d{4}/)?.[0]) >= 5000 ? 1 : 0) }))
      .sort((a, b) => a.rank - b.rank || a.course[0].localeCompare(b.course[0])).map(({ course }) => course) : [];
    return { titleOf, allCatalog };
  }, [deferredCourseQuery, courseCatalog, courseGroups, pendingRequests]);
  const visibleCoursePosts = (courseGroupView === "pinned" ? courseGroupPosts.filter((post) => post.pinnedAt) : courseGroupPosts).slice().reverse();
  // Signed in: a plain loading screen while the saved login is checked, instead of flashing the login page.
  // Website: opening course things from a full page (a notification, a course link) switches back to the Degree view.
  useEffect(() => {
    if (railPanel !== "courses" && ["course-group", "project-room", "degree-posts", "browse-courses", "general-forum"].includes(tab) && typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches) setRailPanel("courses");
  }, [tab, railPanel]);
  if (screen === "loading")
    return (
      <main className="app-loading" aria-busy="true">
        <span className="brand">MIXBY<span>.</span></span>
        {notice && <p role="status">{notice}</p>}
      </main>
    );
  if (screen === "auth" && landing && !isNativeApp)
    return (
        <>
        <Landing
          onLogin={() => { setNotice(""); setScreen("login"); }}
          onJoin={(choice) => { savePendingDegree(choice); setJoinDegree(choice); setNotice(""); setLanding(false); }}
          onInstall={startInstall}
          onGuest={startGuest}
        />
        {installHelpOpen && <InstallHelp onClose={() => setInstallHelpOpen(false)} />}
        </>
    );
  if (screen !== "app") {
    const authNotice = notice && noticeScreen === screen ? <p className="auth-notice" role="alert">{notice}</p> : null;
    const logo = <img src="/logo.png" alt="" aria-hidden="true" />;
    if (screen !== "age") {
      const mxNotice = notice && noticeScreen === screen ? <p className="mxa-notice" role="alert">{notice}</p> : null;
      const go = (to: typeof screen) => { setNotice(""); setScreen(to); };
      const mxBack = (label: string, onClick: () => void) => <button type="button" className="mxa-back" aria-label={label} onClick={onClick}><ChevronLeft size={20} /></button>;
      // Six boxes drawn over one real input, so paste and the phone's "from Messages" code still work.
      const codeField = (label: string) => (
        <label className="mxa-field"><span>{label}</span>
          <span className="mxa-otp">
            <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
            <span className="mxa-otp-cells" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((n) => <i key={n} className={n === Math.min(code.length, 5) ? "next" : ""}>{code[n] || ""}</i>)}</span>
          </span>
        </label>
      );
      const secretField = (label: ReactNode, autoComplete: string, placeholder: string, hint?: string) => (
        <label className="mxa-field"><span>{label}</span>
          <span className="mxa-secret"><input type={showPassword ? "text" : "password"} autoComplete={autoComplete} minLength={hint ? 10 : undefined} placeholder={placeholder} value={password} onChange={(e) => setPassword(e.target.value)} required /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
          {hint && <small>{hint}</small>}
        </label>
      );
      const guestLink = <button type="button" className="mxa-link" onClick={enterAsVisitor}>Continue as guest<ArrowRight size={15} /></button>;
      return (
        <main className={`mxa mxa-${screen}`}>
          <section className="mxa-panel">
            <div className="mxa-column" key={screen}>
              {screen === "auth" && (
                <>
                  <div className="mxa-top">{mxBack("Back to browsing", enterAsVisitor)}</div>
                  <span className="mxa-mark">{logo}</span>
                  <h1>Create your account</h1>
                  {joinDegree && <p className="mxa-chip"><GraduationCap size={15} />Joining {joinDegree.name}</p>}
                  {mxNotice}
                  <form onSubmit={beginSignup}>
                    <label className="mxa-field"><span>York email</span><input type="email" autoComplete="email" placeholder="you@my.yorku.ca" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
                    <button className="mxa-primary">Continue</button>
                  </form>
                  <div className="mxa-or"><span>or</span></div>
                  <GoogleButton onIdToken={signInWithGoogle} onError={setNotice} />
                  <div className="mxa-foot">
                    <p>Already on CCConnect? <button type="button" onClick={() => go("login")}>Log in</button></p>
                    {guestLink}
                  </div>
                </>
              )}
              {screen === "login" && (
                <>
                  <div className="mxa-top">{mxBack("Back to browsing", enterAsVisitor)}</div>
                  <span className="mxa-mark">{logo}</span>
                  <h1>Log in to CCConnect</h1>
                  {mxNotice}
                  <form onSubmit={login}>
                    <label className="mxa-field"><span>York email</span><input type="email" autoComplete="username" placeholder="you@my.yorku.ca" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
                    {secretField(<span className="mxa-label-row">Password<button type="button" onClick={(event) => { event.preventDefault(); go("reset-request"); }}>Forgot password?</button></span>, "current-password", "Your password")}
                    <button className="mxa-primary">Log in</button>
                  </form>
                  <div className="mxa-or"><span>or</span></div>
                  <GoogleButton onIdToken={signInWithGoogle} onError={setNotice} />
                  <div className="mxa-foot">
                    <p>New here? <button type="button" onClick={() => { setNotice(""); setLanding(false); setScreen("auth"); }}>Create an account</button></p>
                    {guestLink}
                  </div>
                </>
              )}
              {screen === "code" && (
                <>
                  <div className="mxa-top">{mxBack("Back", () => go("auth"))}</div>
                  <h1>Check your email</h1>
                  <p className="mxa-lede">Enter the 6-digit code we sent to <strong>{email || "your York email"}</strong>.</p>
                  {mxNotice}
                  <form onSubmit={confirmCode}>
                    {codeField("Verification code")}
                    <p className="mxa-hint">It expires in 10 minutes. Not there? Check your spam folder.</p>
                    <button className="mxa-primary" disabled={code.length !== 6}>Verify</button>
                  </form>
                  <div className="mxa-foot"><p><button type="button" onClick={() => go("auth")}>Use a different email</button></p></div>
                </>
              )}
              {screen === "password" && (
                <>
                  <div className="mxa-top">{mxBack("Cancel sign-up", () => { setNotice(""); logout(); })}</div>
                  <h1>Set up your account</h1>
                  <p className="mxa-lede">Your email is verified. Choose a name and a password.</p>
                  {mxNotice}
                  <form onSubmit={savePassword}>
                    <label className="mxa-field"><span>Display name</span><input autoComplete="nickname" maxLength={32} value={signupName} onChange={(event) => setSignupName(event.target.value)} placeholder="How classmates will see you" required /><small>You can change this later in Profile.</small></label>
                    {secretField("Password", "new-password", "Create a password", "At least 10 characters.")}
                    <button className="mxa-primary" disabled={password.length < 10 || !signupName.trim()}>Continue</button>
                    <p className="mxa-fine">By continuing you agree to the <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>
                  </form>
                </>
              )}
              {screen === "reset-request" && (
                <>
                  <div className="mxa-top">{mxBack("Back", () => go("login"))}</div>
                  <h1>Reset your password</h1>
                  <p className="mxa-lede">We'll email a reset code to your York email.</p>
                  {mxNotice}
                  <form onSubmit={requestPasswordReset}>
                    <label className="mxa-field"><span>York email</span><input type="email" autoComplete="username" placeholder="you@my.yorku.ca" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
                    <button className="mxa-primary">Send reset code</button>
                  </form>
                </>
              )}
              {screen === "reset-password" && (
                <>
                  <div className="mxa-top">{mxBack("Back", () => go("reset-request"))}</div>
                  <h1>Choose a new password</h1>
                  <p className="mxa-lede">Enter the code we sent to <strong>{email || "your York email"}</strong>, then pick a new password.</p>
                  {mxNotice}
                  <form onSubmit={confirmPasswordReset}>
                    {codeField("Reset code")}
                    {secretField("New password", "new-password", "Create a password", "At least 10 characters.")}
                    <button className="mxa-primary">Reset password</button>
                  </form>
                </>
              )}
            </div>
          </section>
        </main>
      );
    }
    return (
      <main key={screen} className={`auth-screen auth-${screen}`}>
        {screen === "age" && (
          <section className="auth-page">
            <button type="button" className="auth-back" aria-label={account?.ageConfirmed ? "Log out" : "Cancel sign-up"} onClick={() => { setNotice(""); logout(); }}><ChevronLeft size={22} /></button>
            <h1>{account?.ageConfirmed ? "Our Terms have been updated" : "Before you start"}</h1>
            {!account?.ageConfirmed && !nameChosen && !account?.isGuest && (
              <label className="signup-name">Display name<input autoComplete="nickname" maxLength={32} value={signupName} onChange={(event) => setSignupName(event.target.value)} placeholder="How classmates will see you" /><small>Shown to classmates instead of your email. You can change it later in Profile.</small></label>
            )}
            <p className="auth-lede">Please read CCConnect's Terms of Service and Privacy Policy to the end.</p>
            {authNotice}
            <div className="legal-tabs" role="tablist">
              {(["terms", "privacy"] as const).map((page) => <button type="button" role="tab" key={page} aria-selected={legalTab === page} className={legalTab === page ? "active" : ""} onClick={() => setLegalTab(page)}>{page === "terms" ? "Terms of Service" : "Privacy Policy"}{legalRead[page] && <Check size={14} strokeWidth={3} aria-label="read" />}</button>)}
            </div>
            <LegalDoc key={legalTab} page={legalTab} className="legal-gate" onReadToEnd={() => setLegalRead((read) => read[legalTab] ? read : { ...read, [legalTab]: true })} />
            {!(legalRead.terms && legalRead.privacy) && <p className="legal-hint">{legalRead.terms ? "Now scroll to the end of the Privacy Policy." : legalRead.privacy ? "Now scroll to the end of the Terms of Service." : "Scroll to the end of both documents to continue."}</p>}
            <label className={legalRead.terms && legalRead.privacy ? "legal-agree" : "legal-agree disabled"}><input type="checkbox" disabled={!(legalRead.terms && legalRead.privacy)} checked={legalAgree} onChange={(event) => setLegalAgree(event.target.checked)} /><span>I'm 18 or older, I agree to the Terms of Service, and I've read the Privacy Policy.</span></label>
            <button className="auth-primary" disabled={!(legalRead.terms && legalRead.privacy && legalAgree) || (!account?.ageConfirmed && !nameChosen && !account?.isGuest && !signupName.trim())} onClick={finishSignup}>Agree and continue</button>
          </section>
        )}
      </main>
    );
  }

  // Pop-ups shared by the old dashboard and the new shell (message menu, report sheet, pickers, prompts...).
  const renderOverlays = () => (
    <>
      {projectMenu && activeProject && (() => {
        const message = projectMenu;
        const target = { type: "project_message" as const, id: message.id, what: "message", authorName: message.author.displayName || "York Student", preview: message.body || message.attachmentName || "Attachment" };
        const asPost = { id: message.id, body: message.body, attachmentName: message.attachmentName, isMine: message.mine, myReaction: null, author: { displayName: message.author.displayName } } as unknown as CourseGroupPost;
        return <MessageMenu post={asPost} reactions={false} anchor={menuAnchor} canModerate={isAdmin} onClose={() => setProjectMenu(null)} onReact={() => {}} onDelete={() => deleteProjectMessage(message)} onReport={() => { setProjectMenu(null); openReport(target); }} onBlock={() => { setProjectMenu(null); blockAuthor(target); }} onBan={() => { setProjectMenu(null); startBan(target); }} />;
      })()}
      {emojiPop && <EmojiPopover anchor={emojiPop.anchor} picked={emojiPop.post.myReaction} onClose={() => setEmojiPop(null)} onPick={(emoji) => { reactToCoursePost(emojiPop.post, emoji); setEmojiPop(null); }} />}
      {messageMenu && <MessageMenu post={messageMenu} anchor={menuAnchor} canModerate={isAdmin} onClose={() => setMessageMenu(null)} onReact={(emoji) => reactToCoursePost(messageMenu, emoji)} onReply={() => startReply(messageMenu)} onDelete={() => deleteCoursePost(messageMenu)} onReport={() => { const post = messageMenu; setMessageMenu(null); openReport({ type: "course_message", id: post.id, what: "message", authorName: post.author?.displayName || "York Student", preview: post.body || post.attachmentName || "Image" }); }} onBlock={() => blockAuthor({ type: "course_message", id: messageMenu.id, what: "message", authorName: messageMenu.author?.displayName || "York Student", preview: messageMenu.body || messageMenu.attachmentName || "Image" })} onBan={() => startBan({ type: "course_message", id: messageMenu.id, what: "message", authorName: messageMenu.author?.displayName || "York Student", preview: messageMenu.body || messageMenu.attachmentName || "Image" })} />}
      {guestPrompt && (
        <div className="guest-prompt-backdrop" onClick={() => setGuestPrompt(null)}>
          <section className="guest-prompt" role="dialog" aria-modal="true" aria-labelledby="guest-prompt-title" onClick={(event) => event.stopPropagation()}>
            <span className="feed-empty-icon" aria-hidden="true"><UserRound size={22} /></span>
            <h2 id="guest-prompt-title">Sign up to {guestPrompt}</h2>
            <p>Guests can look around, but you need a verified York account to {guestPrompt}.</p>
            <footer>
              <button type="button" className="text-button" onClick={() => setGuestPrompt(null)}>Keep browsing</button>
              <button type="button" className="post-button" onClick={() => leaveGuest("auth")}>Sign up</button>
            </footer>
            <button type="button" className="guest-prompt-login" onClick={() => leaveGuest("login")}>Already have an account? <b>Log in</b></button>
          </section>
        </div>
      )}
      {showFlairPicker && (
        <div className="flair-backdrop">
          <section className="flair-picker" role="dialog" aria-modal="true" aria-label="Add flair">
            <header><h2>Add flair</h2><button type="button" onClick={() => setShowFlairPicker(false)}>Close</button></header>
            <p>Choose a flair for your post.</p>
            {[{ id: null, label: "No flair", description: "Just a regular post" }, ...POST_FLAIRS].map((flair) => <button className={postFlair === flair.id ? "selected" : ""} type="button" onClick={() => { setPostFlair(flair.id); if (postKind === "connection") setPostKind("info"); setShowFlairPicker(false); }} key={flair.label}><span>{postFlair === flair.id ? "◉" : "○"}</span><span className="flair-option-text"><strong>{flair.label}</strong><small>{flair.description}</small></span></button>)}
          </section>
        </div>
      )}
      {confirmDeletePost && (
        <div className="delete-dialog-backdrop">
          <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-post-title">
            <h2 id="delete-post-title">Delete post?</h2>
            <p>This action cannot be undone.</p>
            <footer><button onClick={() => setConfirmDeletePost(null)}>Cancel</button><button onClick={() => deletePost(confirmDeletePost)}>Delete</button></footer>
          </section>
        </div>
      )}
      {filtersDraft && isNativeApp && (() => {
        // Every semester from the current one on (Fall, Winter, Summer), in calendar order.
        const currentStart = courseTerms.find((term) => term.id === currentTermId)?.starts_at || "";
        const terms = [...courseTerms].filter((term) => !currentStart || !term.starts_at || term.starts_at >= currentStart).sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || "")).map((term) => term.name);
        const pick = (change: Partial<NonNullable<typeof filtersDraft>>) => setFiltersDraft((draft) => draft ? { ...draft, ...change } : draft);
        return (
          // iOS app: Discover filters as a full page; nothing changes until Apply.
          <section className="filters-page" aria-label="Filters">
            <header className="filters-header">
              <button type="button" aria-label="Close filters" onClick={() => setFiltersDraft(null)}><X size={24} /></button>
              <h2>Filters</h2>
              <button type="button" className="filters-reset" onClick={() => setFiltersDraft({ show: "available", term: "", sort: "members" })}>Reset</button>
            </header>
            <div className="filters-scroll">
              <section className="filters-section">
                <h3>Show</h3>
                <div className="filters-chips">
                  <button type="button" className={filtersDraft.show === "available" ? "active" : ""} onClick={() => pick({ show: "available" })}><GraduationCap size={15} />Available courses</button>
                  <button type="button" className={filtersDraft.show === "requested" ? "active" : ""} onClick={() => pick({ show: "requested" })}><Plus size={15} />Requested courses</button>
                </div>
              </section>
              <section className="filters-section">
                <h3>Semester</h3>
                <div className="filters-chips">
                  <button type="button" className={!filtersDraft.term ? "active" : ""} onClick={() => pick({ term: "" })}>All terms</button>
                  {terms.map((term) => <button type="button" key={term} className={filtersDraft.term === term ? "active" : ""} onClick={() => pick({ term })}>{term}</button>)}
                </div>
              </section>
              <section className="filters-section">
                <h3>Sort by</h3>
                <div className="filters-chips">
                  <button type="button" className={filtersDraft.sort === "members" ? "active" : ""} onClick={() => pick({ sort: "members" })}>{filtersDraft.show === "available" ? "Most members" : "Most requested"}</button>
                  <button type="button" className={filtersDraft.sort === "az" ? "active" : ""} onClick={() => pick({ sort: "az" })}>A–Z</button>
                </div>
              </section>
            </div>
            <footer className="filters-footer">
              <button type="button" onClick={() => { setDiscoverFilter(filtersDraft.show); setDiscoverTerm(filtersDraft.term); setDiscoverSort(filtersDraft.sort); setFiltersDraft(null); }}>Apply filters</button>
            </footer>
          </section>
        );
      })()}
      {requestPageOpen && isNativeApp && (
        // iOS app: requesting a course is its own page.
        <form className="picker-page" onSubmit={async (event) => { if (await requestCourse(event)) setRequestPageOpen(false); }}>
          <header className="picker-header">
            <button type="button" className="picker-cancel" onClick={() => setRequestPageOpen(false)}>Cancel</button>
            <h2>Request a course</h2>
            <button className="picker-done" disabled={!courseRequestCode.trim()}>Request</button>
          </header>
          <div className="picker-scroll">
            <div className="picker-hero"><span className="room-info-icon" aria-hidden="true"><GraduationCap size={30} /></span><p>Can't find your course? Request it. It becomes an official group chat as soon as another student joins.</p></div>
            <h3 className="picker-label">Course</h3>
            <div className="picker-card"><input className="picker-name" autoFocus placeholder="BIOL 1000" value={courseRequestCode} onChange={(event) => setCourseRequestCode(event.target.value.toUpperCase())} required /></div>
            <h3 className="picker-label">Semester</h3>
            <div className="request-terms">
              {courseTerms.filter((term) => !term.starts_at || !courseTerms.find((current) => current.id === currentTermId)?.starts_at || term.starts_at >= (courseTerms.find((current) => current.id === currentTermId)?.starts_at || "")).sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || "")).map((term) => (
                <button type="button" key={term.id} className={(courseRequestTermId || currentTermId) === term.id ? "chip active" : "chip"} onClick={() => setCourseRequestTermId(term.id)}>{term.name}</button>
              ))}
            </div>
            <p className="room-info-note">Use the course code as it appears on your timetable, like EECS 2030.</p>
          </div>
        </form>
      )}
      {projectPicker && (isNativeApp || NEW_SHELL) && (() => {
        // iOS app: creating a project room (or inviting to one) is a full page, not a sheet.
        const creating = projectPicker === "create";
        const groupForPicker = creating ? courseHome : courseGroups.find((group) => group.id === activeProject?.courseGroupId) || courseHome;
        const classmates = (courseMembers || []).filter((member) => creating || !(activeProject?.members.some((existing) => existing.id === member.id) || activeProject?.pendingInvites?.some((invite) => invite.id === member.id)));
        const searching = Boolean(memberSearch.trim());
        const shown = classmates.filter((member) => member.name.toLowerCase().includes(memberSearch.trim().toLowerCase()));
        // First 5 classmates (plus anyone already ticked) until "Show all"; a search always looks through everyone.
        const firstFive = shown.slice(0, 5);
        const listed = searching || allClassmatesShown ? shown : [...firstFive, ...shown.filter((member) => pickedMemberIds.includes(member.id) && !firstFive.includes(member))];
        const hiddenCount = shown.length - listed.length;
        return (
          <form className="picker-page" onSubmit={submitProjectPicker}>
            <header className="picker-header">
              <button type="button" className="picker-cancel" onClick={() => setProjectPicker(null)}>Cancel</button>
              <h2>{creating ? "New group" : "Invite classmates"}<small>{groupForPicker?.courseCode || ""}</small></h2>
              <button className="picker-done" disabled={pickerBusy || (creating && (inviteOnly ? !projectNameDraft.trim() : !professorName(profNameDraft))) || (pickedMemberIds.length === 0 && (!creating || inviteOnly))}>{pickerBusy ? (creating ? "Creating…" : "Inviting…") : creating ? "Create" : `Invite${pickedMemberIds.length ? ` ${pickedMemberIds.length}` : ""}`}</button>
            </header>
            <div className="picker-scroll">
              {creating && (
                <>
                  {/* CCConnect: private groups only (the professor-group choice is removed). */}
                  {inviteOnly ? <>
                    <h3 className="picker-label">Group name</h3>
                    <div className="picker-card"><input className="picker-name" autoFocus maxLength={60} placeholder="Lab 3 group" value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} required /></div>
                  </> : <>
                    <h3 className="picker-label">Professor's full name</h3>
                    <div className="picker-card picker-prof"><span aria-hidden="true">Prof.</span><input className="picker-name" autoFocus maxLength={54} aria-label="Professor's full name" placeholder="First and last name" value={profNameDraft} onChange={(event) => setProfNameDraft(event.target.value.replace(/^prof(essor)?\.?\s*/i, ""))} /></div>
                    <p className={profNameDraft.trim() && !professorName(profNameDraft) ? "picker-hint warn" : "picker-hint"}>{profNameDraft.trim() && !professorName(profNameDraft) ? "Type the professor's full name, first and last (letters only)." : "Use the professor's full name so classmates can find the right group."} Closes after 30 days without messages.</p>
                  </>}
                </>
              )}
              {/* Professor groups are public (anyone in the course joins from Discover), so there's nobody to invite. */}
              {(!creating || inviteOnly) && <>
              <h3 className="picker-label">{creating ? (inviteOnly ? "Invite classmates" : "Invite classmates (optional)") : `Classmates in ${groupForPicker?.courseCode || "this course"}`}{pickedMemberIds.length > 0 ? ` · ${pickedMemberIds.length} selected` : ""}</h3>
              <label className="picker-search"><Search size={16} aria-hidden="true" /><input placeholder="Search classmates" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} /></label>
              <ul className="picker-card picker-people">
                {courseMembers === null && <li className="picker-empty">Loading classmates…</li>}
                {courseMembers !== null && classmates.length === 0 && <li className="picker-empty">{creating ? `No other classmates have joined ${groupForPicker?.courseCode || "this course"} yet, so there's no one to invite.` : "Everyone in this course is already in the room or invited."}</li>}
                {classmates.length > 0 && shown.length === 0 && <li className="picker-empty">No classmates match that search.</li>}
                {listed.map((member) => {
                  const picked = pickedMemberIds.includes(member.id);
                  return (
                    <li key={member.id}>
                      <button type="button" className={picked ? "picker-person picked" : "picker-person"} aria-pressed={picked} onClick={() => setPickedMemberIds((ids) => picked ? ids.filter((id) => id !== member.id) : [...ids, member.id])}>
                        <Avatar name={member.name} seed={member.name} />
                        <span>{member.name}</span>
                        <span className="picker-check" aria-hidden="true">{picked && <Check size={15} strokeWidth={3} />}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {hiddenCount > 0 && <button type="button" className="picker-more" onClick={() => setAllClassmatesShown(true)}>Show all {shown.length} classmates</button>}
              </>}
            </div>
          </form>
        );
      })()}
      {discoverFor && (
        <div className="picker-page discover-page">
          <header className="picker-header">
            <button type="button" className="picker-cancel" onClick={() => setDiscoverFor(null)}>Close</button>
            <h2>Discover groups<small>{discoverFor.courseCode}</small></h2>
            <button type="button" className="picker-done" onClick={() => { const group = discoverFor; openProjectPicker("create", group, false); }}>Create</button>
          </header>
          <div className="picker-scroll">
            <h3 className="picker-label">Groups</h3>
            <ul className="picker-card discover-list">
              {discoverRooms === null && <li className="picker-empty">Loading groups…</li>}
              {discoverRooms?.length === 0 && <li className="picker-empty">No new groups to join in {discoverFor.courseCode}. Groups you're already in are in your course list; tap Create to start another.</li>}
              {discoverRooms?.map((room) => (
                <li key={room.id} className="discover-row">
                  <span className="discover-icon" aria-hidden="true">{room.isPublic === false ? <Lock size={18} /> : <Users size={18} />}</span>
                  <span className="discover-main"><strong>{room.name}</strong><small>{room.memberCount} member{room.memberCount === 1 ? "" : "s"} · by {room.createdBy} · active {agoText(room.lastActivityAt)}</small></span>
                  {room.isPublic === false
                    ? <button type="button" className={room.requested ? "discover-join requested" : "discover-join"} disabled={Boolean(joiningRoomId)} onClick={() => toggleJoinRequest(room)}>{joiningRoomId === room.id ? "…" : room.requested ? "Requested" : "Request"}</button>
                    : <button type="button" className="discover-join" disabled={Boolean(joiningRoomId)} onClick={() => joinPublicRoom(room.id)}>{joiningRoomId === room.id ? "Joining…" : "Join"}</button>}
                </li>
              ))}
            </ul>
            <p className="picker-note">Public groups: join right away. Private groups (lock): their creator approves your request. Groups close after 30 days without messages.</p>
          </div>
        </div>
      )}
      {projectPicker && !isNativeApp && !NEW_SHELL && (
        <div className="report-backdrop" onClick={() => setProjectPicker(null)}>
          <form className="report-sheet project-picker" onClick={(event) => event.stopPropagation()} onSubmit={submitProjectPicker}>
            <header><div><p className="eyebrow">{projectPicker === "create" ? `NEW PROJECT ROOM · ${courseHome?.courseCode || ""}` : "INVITE CLASSMATES"}</p><h2>{projectPicker === "create" ? "Make a private room for your group" : `Invite to ${activeProject?.name || "this room"}`}</h2></div><button type="button" className="report-close" aria-label="Close" onClick={() => setProjectPicker(null)}><X size={18} /></button></header>
            {projectPicker === "create" && <label className="report-details">Room name<input autoFocus maxLength={60} placeholder="e.g. Lab 3 group" value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} required /></label>}
            <div className="project-picker-people">
              <div className="project-picker-heading"><strong>Invite classmates</strong><span>{pickedMemberIds.length} selected</span></div>
              <input className="project-picker-search" placeholder="Search classmates" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} />
              <ul>
                {(courseMembers || []).filter((member) => projectPicker === "create" || !(activeProject?.members.some((existing) => existing.id === member.id) || activeProject?.pendingInvites?.some((invite) => invite.id === member.id))).filter((member) => member.name.toLowerCase().includes(memberSearch.trim().toLowerCase())).map((member) => (
                  <li key={member.id}>
                    <label className={pickedMemberIds.includes(member.id) ? "selected" : ""}>
                      <input type="checkbox" checked={pickedMemberIds.includes(member.id)} onChange={(event) => setPickedMemberIds((ids) => event.target.checked ? [...ids, member.id] : ids.filter((id) => id !== member.id))} />
                      <Avatar name={member.name} seed={member.name} />
                      <span>{member.name}</span>
                    </label>
                  </li>
                ))}
                {courseMembers === null && <li className="project-picker-empty">Loading classmates…</li>}
                {courseMembers?.length === 0 && <li className="project-picker-empty">No other classmates have joined {courseHome?.courseCode || "this course"} yet. You can invite them later.</li>}
              </ul>
            </div>
            <footer><span>Invited classmates join when they accept.</span><button type="button" className="text-button" onClick={() => setProjectPicker(null)}>Cancel</button><button className="post-button" disabled={pickerBusy || (projectPicker === "create" && !projectNameDraft.trim()) || pickedMemberIds.length === 0}>{projectPicker === "create" ? "Create room" : `Invite ${pickedMemberIds.length || ""}`.trim()}</button></footer>
          </form>
        </div>
      )}
      {banTarget && (
        <div className="report-backdrop" onClick={() => setBanTarget(null)}>
          <form className="report-sheet ban-sheet" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); const reason = banReasonText(); if (!reason) return; if (banTarget.content) banByContent(banTarget.content, reason); else if (banTarget.person.id) setPostingBan(banTarget.person.id, 1, banTarget.reportId, reason); }}>
            <header><div><p className="eyebrow">POSTING BAN · 24 HOURS</p><h2>Ban {banTarget.person.name} from posting</h2></div><button type="button" className="report-close" aria-label="Close" onClick={() => setBanTarget(null)}><X size={18} /></button></header>
            <p className="ban-explainer">For one day they can still browse and read, but can't post, comment or send messages. They're told why in their notifications.</p>
            <fieldset className="report-reasons">
              <legend>Reason</legend>
              {BAN_REASONS.map((category) => (
                <label key={category.id} className={banReason === category.id ? "selected" : ""}>
                  <input type="radio" name="ban-reason" value={category.id} checked={banReason === category.id} onChange={() => setBanReason(category.id)} />
                  <span><strong>{category.label}</strong></span>
                </label>
              ))}
            </fieldset>
            {banReason === "other" && <label className="report-details">Reason they'll see<input maxLength={120} value={banOther} onChange={(event) => setBanOther(event.target.value)} placeholder="e.g. Repeated off-topic posts" required /></label>}
            {banReasonText() && <p className="ban-until">They'll see: "You can't post for 24 hours. Reason: {banReasonText()}". Ends {formatBanDate(new Date(Date.now() + 86400000).toISOString())}.</p>}
            <footer><span /><button type="button" className="text-button" onClick={() => setBanTarget(null)}>Cancel</button><button className="post-button" disabled={!banReasonText()}>Ban for 24 hours</button></footer>
          </form>
        </div>
      )}
      {chatMenu && createPortal((() => {
        const muted = isMuted(chatMenu.id);
        const until = mutedUntilOf(chatMenu.id);
        const targets = chatMenu.ids || [chatMenu.id];
        const groupUnread = (id: string) => chatPreviews.projectRooms.find((room) => room.id === id)?.unreadCount || 0;
        const unread = chatMenu.course ? (courseGroups.find((group) => group.id === chatMenu.id)?.unreadCount || 0) + targets.reduce((total, id) => total + groupUnread(id), 0)
          : chatMenu.group ? (courseGroups.find((group) => group.id === chatMenu.id)?.unreadCount || 0) : (groupUnread(chatMenu.id) || chatMenu.room?.unreadCount || 0);
        const items = chatMenu.muting ? (<>
          {[[1, "For 1 hour"], [8, "For 8 hours"], [24, "For 24 hours"]].map(([hours, label]) => <button type="button" key={label} onClick={() => muteChat(targets, hours as number)}><Clock size={18} />{label}</button>)}
          <button type="button" onClick={() => muteChat(targets, null)}><BellOff size={18} />Until I turn it back on</button>
        </>) : (<>
          {unread > 0 && <button type="button" onClick={() => markChatRead(chatMenu)}><Check size={18} />Mark as read</button>}
          {muted
            ? <button type="button" onClick={() => unmuteChat(targets)}><Bell size={18} /><span className="mx-chat-menu-text">Unmute notifications<small>{until ? `Muted until ${new Date(until).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "Muted until you turn it back on"}</small></span></button>
            : <button type="button" onClick={() => setChatMenu((menu) => menu && { ...menu, muting: true })}><BellOff size={18} />{chatMenu.course ? "Mute course…" : "Mute notifications…"}</button>}
          {chatMenu.course && chatMenu.group && !guest && <button type="button" onClick={() => { const group = chatMenu.group as CourseGroup; setChatMenu(null); setCourseHome(group); openProjectPicker("create", group); }}><Lock size={18} />Create private group</button>}
          {(chatMenu.course || chatMenu.room) && <button type="button" className="mx-chat-menu-danger" onClick={() => { const menu = chatMenu; setChatMenu(null); if (menu.group) leaveCourseChat(menu.group); else if (menu.room) leaveGroupFromList(menu.room); }}><LogOut size={18} />{chatMenu.course ? "Leave course" : "Leave group"}</button>}
          {chatMenu.course && isAdmin && chatMenu.group && <button type="button" className="mx-chat-menu-danger" onClick={() => { const group = chatMenu.group as CourseGroup; setChatMenu(null); deleteCourseChat(group); }}><Trash2 size={18} />Delete course (moderator)</button>}
        </>);
        return chatMenu.sheet ? (
          <div className="block-backdrop" onClick={() => setChatMenu(null)}>
            <section className="block-sheet mx-chat-sheet" role="menu" aria-label={chatMenu.label} onClick={(event) => event.stopPropagation()}>
              <span className="block-grabber" aria-hidden="true" />
              <h2>{chatMenu.muting ? `Mute ${chatMenu.label}` : chatMenu.label}</h2>
              <div className="mx-chat-sheet-items">{items}</div>
              <button type="button" className="block-cancel" onClick={() => setChatMenu(null)}>Cancel</button>
            </section>
          </div>
        ) : (
          <div className="mx-chat-menu-layer" onClick={() => setChatMenu(null)} onContextMenu={(event) => { event.preventDefault(); setChatMenu(null); }}>
            <div className="mx-chat-menu" role="menu" aria-label={chatMenu.label} style={{ left: Math.min(chatMenu.x, window.innerWidth - 236), top: Math.min(chatMenu.y + 4, window.innerHeight - 120) }} onClick={(event) => event.stopPropagation()}>
              <p>{chatMenu.muting ? `Mute ${chatMenu.label}` : chatMenu.label}</p>
              {items}
            </div>
          </div>
        );
      })(), document.body)}
      {installHelpOpen && <InstallHelp onClose={() => setInstallHelpOpen(false)} />}
      {confirmAsk && createPortal(
        <div className="block-backdrop" onClick={() => answerConfirm(false)}>
          <section className="block-sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={confirmAsk.message ? "confirm-message" : undefined} onClick={(event) => event.stopPropagation()}>
            <span className="block-grabber" aria-hidden="true" />
            <h2 id="confirm-title">{confirmAsk.title}</h2>
            {confirmAsk.message && <p id="confirm-message">{confirmAsk.message}</p>}
            <button type="button" className={confirmAsk.safe ? "block-confirm safe" : "block-confirm"} onClick={() => answerConfirm(true)}>{confirmAsk.action}</button>
            <button type="button" className="block-cancel" onClick={() => answerConfirm(false)}>{confirmAsk.cancel || "Cancel"}</button>
          </section>
        </div>,
        document.body,
      )}
      {blockTarget && createPortal(
        <div className="block-backdrop" onClick={() => !blocking && setBlockTarget(null)}>
          <section className="block-sheet" role="dialog" aria-modal="true" aria-labelledby="block-title" onClick={(event) => event.stopPropagation()}>
            <span className="block-grabber" aria-hidden="true" />
            <div className="block-person"><Avatar name={blockTarget.authorName} seed={blockTarget.authorName} large /><span className="block-badge" aria-hidden="true"><Ban size={14} /></span></div>
            <h2 id="block-title">Block {blockTarget.authorName}?</h2>
            <ul className="block-points">
              <li><EyeOff size={17} /><span>Their posts, comments and messages are hidden for you</span></li>
              <li><Lock size={17} /><span>They can't add you to project groups</span></li>
              <li><BellOff size={17} /><span>No notifications from them</span></li>
              <li><UserRound size={17} /><span>They aren't told. Unblock any time in Profile</span></li>
            </ul>
            <button type="button" className="block-confirm" disabled={blocking} onClick={confirmBlock}>{blocking ? "Blocking…" : "Block"}</button>
            <button type="button" className="block-cancel" disabled={blocking} onClick={() => setBlockTarget(null)}>Cancel</button>
          </section>
        </div>,
        document.body,
      )}
      {reportTarget && (
        <div className="report-backdrop" onClick={closeReport}>
          <section className="report-sheet" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={(event) => event.stopPropagation()}>
            {reportState === "done" || reportState === "already" ? (
              <div className="report-done">
                <span className="report-done-icon" aria-hidden="true">✓</span>
                <h2 id="report-title">{reportState === "done" ? "Thanks for letting us know" : "Already reported"}</h2>
                <p>{reportState === "done" ? `Moderators will review this ${reportTarget.what}. ${reportTarget.authorName} won't be told who reported it.` : `You've already reported this ${reportTarget.what}. Moderators will review it.`}</p>
                {reportCategory === "self_harm" && <p className="report-urgent">If someone is in immediate danger, call 911 or York Security at 416-736-5333.</p>}
                <button type="button" className="post-button" onClick={closeReport}>Done</button>
              </div>
            ) : (
              <form onSubmit={submitReport}>
                <header>
                  <div><p className="eyebrow">REPORT</p><h2 id="report-title">Report this {reportTarget.what}</h2></div>
                  <button type="button" className="report-close" aria-label="Close" onClick={closeReport}><X size={18} /></button>
                </header>
                <blockquote className="report-quote"><strong>{reportTarget.authorName}</strong><span>{reportTarget.preview || "(no text)"}</span></blockquote>
                <fieldset className="report-reasons">
                  <legend>Why are you reporting it?</legend>
                  {REPORT_CATEGORIES.map((category) => (
                    <label key={category.id} className={reportCategory === category.id ? "selected" : ""}>
                      <input type="radio" name="report-category" value={category.id} checked={reportCategory === category.id} onChange={() => setReportCategory(category.id)} />
                      <span><strong>{category.label}</strong><small>{category.hint}</small></span>
                    </label>
                  ))}
                </fieldset>
                {reportCategory && (
                  <label className="report-details">
                    {reportCategory === "other" ? "What's wrong?" : "Anything else we should know? (optional)"}
                    <textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={400} placeholder="Add details for the moderators" required={reportCategory === "other"} />
                  </label>
                )}
                <footer>
                  <span>Reports are anonymous to the person you report.</span>
                  <button type="button" className="text-button" onClick={closeReport}>Cancel</button>
                  <button className="post-button" disabled={!reportCategory || reportState === "sending"}>{reportState === "sending" ? "Sending…" : "Submit report"}</button>
                </footer>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
  // ===== New shell (Degree / Course / Project): navigation helpers =====
  const isWide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;
  const degreeGroup = (community: DegreeCommunity): CourseGroup => ({ id: community.groupId, courseCode: "General", termName: community.code, memberCount: community.memberCount, joined: true, unreadCount: community.unreadCount, isDegree: true });
  const courseLabel = (group: { courseCode: string; instructor?: string | null }) => group.instructor ? `${group.courseCode} · Prof. ${group.instructor}` : group.courseCode;
  // Your degree's Posts page (it replaced the degree General chat).
  const shellOpenGeneral = () => {
    setDegreePickerOpen(false); setCourseInfoOpen(false); setChatFind(null); setCreatingCourse(false); setProfilePage(null); setNotifSettingsOpen(false);
    setTab("general-forum");
    setMobileMain(true);
  };
  const shellOpenDegree = () => {
    if (!DEGREE_FORUM && degree) { shellOpenGeneral(); return; } // the degree card opens the General Forum now
    if (!degree) { setDegreePickerOpen(true); setMobileMain(true); return; }
    setDegreePickerOpen(false); setCourseInfoOpen(false); setChatFind(null); setCreatingCourse(false); setProfilePage(null); setNotifSettingsOpen(false);
    setTab("degree-posts");
    setMobileMain(true);
    loadDegreePosts().catch(() => {});
  };
  const openDegreeInfo = () => {
    if (!degree) return;
    // Straight to Degree info: the old General chat is never opened (or loaded) underneath it.
    infoFromBanner.current = true;
    openingChat.current = "degree-info";
    clearCourseGroupTypers();
    setActiveCourseGroup(degreeGroup(degree));
    setCourseGroupPosts([]);
    setCourseMembers(null);
    request(`/api/course-groups/${degree.groupId}/members`, {}, token).then((data) => setCourseMembers(data.members)).catch(() => setCourseMembers([]));
    setTab("course-group");
    setCourseInfoOpen(true);
    setMobileMain(true);
  };
  // Leaving Degree info never lands in the old General chat: phones go back to the list, wider screens to the Forum.
  // Phones: the info page slides away like a chat does, and only once it's off screen does the layer become the Forum
  // (swapping it during the slide made it vanish and left a gap while the list slid in).
  const closeDegreeInfo = () => {
    infoFromBanner.current = false;
    const swap = () => { setCourseInfoOpen(false); setTab("degree-posts"); };
    if (isWide()) { swap(); return; }
    setMobileMain(false);
    window.setTimeout(swap, 300);
  };
  const startDegreePost = (title = "", body = "") => {
    if (membersOnly("post")) return;
    setEditingPost(null); setPostScope("degree"); setPostKind("info"); setPostFlair(null); setPostImages([]); setPostTitle(title); setPostBody(body); setExternalUrl("");
    setCourseInfoOpen(false);
    setTab("create");
    setMobileMain(true);
  };
  const shellOpenCourse = (group: CourseGroup) => { setChatFind(null); setEmojiPickerFor(null); openCourseGroup(group); setMobileMain(true); };
  const shellOpenProject = (room: ProjectRoom & { courseCode?: string }) => {
    setChatFind(null);
    setEmojiPickerFor(null);
    const group = courseGroups.find((candidate) => candidate.id === room.courseGroupId);
    if (group) setCourseHome(group);
    projectReturn.current = "your-courses";
    openProjectRoom(room.id);
    setMobileMain(true);
  };
  const shellGo = (next: "browse-courses" | "profile" | "settings" | "alerts") => {
    setDegreePickerOpen(false);
    setCreatingCourse(false);
    if (next === "alerts") openAlerts(); else setTab(next);
    setMobileMain(true);
  };
  const shellBack = () => {
    // Visitors have no sidebar: Back always leads to the General Forum, their home page.
    if (guest) {
      setCourseInfoOpen(false); setProjectPanelOpen(false); setCourseQrOpen(false); setChatFind(null); setEmojiPickerFor(null); setCreatingCourse(false);
      setTab("general-forum"); setMobileMain(true);
      return;
    }
    if (backToAlerts.current && !isWide() && tab !== "alerts") {
      backToAlerts.current = false;
      setCourseInfoOpen(false); setProjectPanelOpen(false); setCourseQrOpen(false); setChatFind(null); setEmojiPickerFor(null); setCreatingCourse(false);
      setRailPanel("alerts"); setTab("alerts"); setMobileMain(true);
      return;
    }
    setMobileMain(false); setCourseInfoOpen(false); setProjectPanelOpen(false); setCourseQrOpen(false); setChatFind(null); setEmojiPickerFor(null); setCreatingCourse(false); };
  const loadDegrees = () => request("/api/degrees", readAuth(), token).then((data) => { setDegreeList(data.degrees || []); setDegreesUnavailable(Boolean(data.setupRequired)); setMyDegreeRequests(data.myRequests || []); }).catch(() => { setDegreeList([]); setDegreesUnavailable(true); });
  const chooseDegree = async (choice: Degree) => {
    try {
      const data = await request("/api/me/degree", { method: "PUT", body: JSON.stringify({ degreeId: choice.id }) }, token);
      setAccount(data.account);
      setDegree(data.degree);
      setDegreePickerOpen(false);
      if (data.degree) { setTab(FORUM_HOME); setMobileMain(true); }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save your degree.");
    }
  };
  const requestDegree = async () => {
    const name = degreeSearch.trim();
    if (!name) return;
    try {
      const data = await request("/api/degrees/request", { method: "POST", body: JSON.stringify({ name }) }, token);
      setMyDegreeRequests((items) => items.some((item) => item.id === data.degree.id) ? items : [...items, data.degree]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to request that degree.");
    }
  };
  // Share a course on your degree's Posts page (discovery: "Anyone taking ADMS 1000?"): opens the composer, ready to edit.
  const shareCourseToDegree = (group: CourseGroup) => {
    if (!degree) { setNotice("Choose your degree first."); return; }
    startDegreePost(`Anyone taking ${courseLabel(group)}?`, `Join the ${courseLabel(group)} chat: ${courseLink(group.id)}`);
  };
  // A course link in a message becomes a tappable card.
  const renderCourseCards = (text: string) => {
    const ids = [...text.matchAll(/mixby\.ca\/\?course=([\w-]+)/gi)].map((match) => match[1]);
    return ids.map((id) => {
      const group = courseGroups.find((candidate) => candidate.id === id);
      if (!group) return null;
      return (
        <button type="button" className="mx-course-card" key={id} onClick={() => shellOpenCourse(group)}>
          <span className="mx-course-card-icon" aria-hidden="true"><Hash size={20} /></span>
          <span><strong>{courseLabel(group)}</strong><small>{group.memberCount} member{group.memberCount === 1 ? "" : "s"}</small></span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      );
    });
  };
  // ===== New shell: rail + community tree + main (two screens on phones) =====
  const renderShell = () => {
    const inCourse = tab === "course-group" && activeCourseGroup;
    const chatShowing = isWide() || mobileMain; // phones: is the chat layer on screen, or the course list?
    const isDegreeChat = Boolean(inCourse && degree && activeCourseGroup?.id === degree.groupId);
    const onDegreePosts = chatShowing && (tab === "degree-posts" || (tab === "post" && Boolean(commentPost?.degreeId)) || (tab === "create" && postScope === "degree"));
    const inProject = tab === "project-room" && activeProject;
    const treeQuery = chatSearch.trim().toLowerCase();
    const shownCourses = myCourses.filter((group) => !treeQuery || courseLabel(group).toLowerCase().includes(treeQuery));
    const railBadge = unreadNotifications > 9 ? "9+" : unreadNotifications;
    const name = identity.displayName || account?.email.split("@")[0] || "You";

    const openChatKey = tab === "project-room" ? `p:${activeProject?.id || ""}` : `c:${activeCourseGroup?.id || ""}`;
    if (chatOpened.current.key !== openChatKey) chatOpened.current = { key: openChatKey, at: Date.now() };
    const isFresh = (createdAt?: string, pending?: boolean) => Boolean(pending) || (createdAt ? new Date(createdAt).getTime() > chatOpened.current.at : false);
    const messageList = (items: { id: string; name: string; seed: string; mine: boolean; createdAt?: string; body: string; image?: string | null; file?: string | null; fileName?: string | null; reactions?: { emoji: string; count: number }[]; myReaction?: string | null; pending?: boolean; project?: ProjectMessage; post?: CourseGroupPost; report?: ReportTarget; joined?: boolean }[]) => items.map((item, index) => {
      const previous = items[index - 1];
      const { newDay, grouped } = chatMessageFlags(previous && { createdAt: previous.createdAt, mine: previous.mine, author: previous.seed }, { createdAt: item.createdAt, mine: item.mine, author: item.seed });
      // Someone joined the course: a line across the chat, "——— Name joined ———".
      if (item.joined) return (
        <Fragment key={item.id}>
          {newDay && item.createdAt && <div className="mx-day"><span>{chatDayLabel(item.createdAt)}</span></div>}
          <div className="mx-joined" role="note"><span><strong>{item.name}</strong> joined</span></div>
        </Fragment>
      );
      return (
        <Fragment key={item.id}>
          {newDay && item.createdAt && <div className="mx-day"><span>{chatDayLabel(item.createdAt)}</span></div>}
          <div className={`mx-msg${grouped ? " grouped" : ""}${item.mine ? " mine" : ""}${item.pending ? " pending" : ""}${isFresh(item.createdAt, item.pending) ? " fresh" : ""}`} data-msg={item.id} {...(item.pending ? {} : item.post ? holdToOpen(item.post) : item.project ? holdFor(() => { setMenuAnchor(null); setProjectMenu(item.project as ProjectMessage); }) : {})}>
            {grouped ? <span className="mx-msg-gutter">{item.createdAt ? chatTime(item.createdAt) : ""}</span> : (
              <button type="button" className="mx-msg-avatar" aria-label={`${item.name}: options`} disabled={item.mine} onClick={(event) => toggleSenderCard(item.id, event)}><Avatar name={item.name} seed={item.seed} /></button>
            )}
            <div className="mx-msg-body">
              {!grouped && <div className="mx-msg-head"><button type="button" className="mx-msg-name" disabled={item.mine} onClick={(event) => toggleSenderCard(item.id, event)}>{item.name}</button>{item.name === TEAM_NAME && <TeamBadge />}{item.createdAt && <time dateTime={item.createdAt}>{chatTime(item.createdAt)}</time>}</div>}
              {item.post?.replyTo && <button type="button" className="mx-reply-quote" onClick={() => jumpToMessage((item.post as CourseGroupPost).replyToId as string)}><ReplyIcon size={13} aria-hidden="true" />{item.post.replyTo.name ? <><strong>{item.post.replyTo.name}</strong><span>{item.post.replyTo.body}</span></> : <span className="gone">Original message isn't available</span>}</button>}
              {item.body && <p><LinkedText text={item.body} /></p>}
              {renderCourseCards(item.body)}
              {item.image && <img className="mx-msg-image" src={item.image} alt={item.fileName || "Photo"} />}
              {item.file && <a className="mx-msg-file" href={item.file} target="_blank" rel="noreferrer"><Paperclip size={15} />{item.fileName || "Attachment"}</a>}
              {(item.reactions?.length || 0) > 0 && item.post && <div className="mx-reactions">{item.reactions?.map((reaction) => <button type="button" key={reaction.emoji} className={item.myReaction === reaction.emoji ? "mine" : ""} onClick={() => reactToCoursePost(item.post as CourseGroupPost, reaction.emoji)}>{reaction.emoji}<span>{reaction.count}</span></button>)}{!guest && <button type="button" className="mx-react-add" aria-label="Add reaction" title="Add reaction" onClick={(event) => setEmojiPop({ post: item.post as CourseGroupPost, anchor: event.currentTarget.getBoundingClientRect() })}><Smile size={18} /></button>}</div>}
            </div>
            {(item.post || item.project) && !guest && !item.pending && (
              // Hover toolbar (website, Discord-style): three quick reactions, the full emoji picker, then ⋯ for the rest.
              <div className="mx-msg-tools" onClick={(event) => event.stopPropagation()}>
                {item.post && QUICK_REACTIONS.map((emoji) => <button type="button" key={emoji} className={item.myReaction === emoji ? "picked" : ""} aria-label={`React ${emoji}`} title={`React ${emoji}`} onClick={() => reactToCoursePost(item.post as CourseGroupPost, emoji)}>{emoji}</button>)}
                {item.post && <button type="button" aria-label="Reply" title="Reply" onClick={() => startReply(item.post as CourseGroupPost)}><ReplyIcon size={18} /></button>}
                {item.post && <button type="button" aria-label="Add reaction" title="Add reaction" onClick={(event) => setEmojiPop({ post: item.post as CourseGroupPost, anchor: (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect() })}><Smile size={18} /></button>}
                <button type="button" aria-label="More" title="More" onClick={(event) => { setMenuAnchor((event.currentTarget.parentElement as HTMLElement).getBoundingClientRect()); if (item.post) setMessageMenu(item.post); else setProjectMenu(item.project as ProjectMessage); }}><MoreHorizontal size={18} /></button>
              </div>
            )}
            {senderCard === item.id && !item.mine && <SenderConsole anchor={senderAnchor} name={item.name} seed={item.seed} onClose={() => setSenderCard(null)} onReport={() => openReport(item.report as ReportTarget)} onBlock={() => blockAuthor(item.report as ReportTarget)} onBan={isAdmin ? () => startBan(item.report as ReportTarget) : undefined} />}
          </div>
        </Fragment>
      );
    });

    // Chat header: back · tappable name with up to 5 overlapping member avatars (+N) · search.
    const chatHeader = (title: string, memberCount: number, memberNames: string[], onInfo?: () => void, locked = false, middle?: ReactNode, actions?: ReactNode) => {
      const shown = memberNames.slice(0, Math.min(5, memberCount));
      const extra = Math.max(0, memberCount - shown.length);
      return (
        <header className="mx-chat-header">
          <button type="button" className="mx-back" aria-label="Back" onClick={shellBack}><ChevronLeft size={24} /></button>
          <button type="button" className="mx-chat-title" disabled={!onInfo} onClick={onInfo} aria-label={`${title}, ${memberCount} member${memberCount === 1 ? "" : "s"}${onInfo ? ". Open info" : ""}`}>
            <span className="mx-chat-name">{locked && <Lock size={14} aria-hidden="true" />}<span>{title}</span>{onInfo && <ChevronRight size={15} aria-hidden="true" />}</span>
            <span className="mx-stack" aria-hidden="true">{shown.map((member, index) => <Avatar key={`${member}-${index}`} name={member} seed={member} />)}{extra > 0 && <b>+{extra}</b>}</span>
          </button>
          {middle}
          <div className="mx-chat-actions">{actions !== undefined ? actions : <button type="button" aria-label="Search messages" onClick={() => setChatFind("")}><Search size={20} /></button>}</div>
        </header>
      );
    };
    // Search inside the open chat: the header becomes a search field, results replace the messages.
    const findHeader = (placeholder: string) => (
      <header className="mx-chat-header mx-find-header">
        <label className="mx-search mx-find-field"><Search size={17} aria-hidden="true" /><input autoFocus aria-label="Search messages" value={chatFind || ""} onChange={(event) => setChatFind(event.target.value)} placeholder={placeholder} /></label>
        <button type="button" className="mx-find-cancel" onClick={() => setChatFind(null)}>Back</button>
      </header>
    );
    const jumpToMessage = (id: string) => {
      setChatFind(null);
      window.setTimeout(() => {
        const row = document.querySelector(`[data-msg="${CSS.escape(id)}"]`);
        row?.scrollIntoView({ block: "center" });
        row?.classList.add("mx-flash");
        window.setTimeout(() => row?.classList.remove("mx-flash"), 1600);
      }, 60);
    };
    // Smart search (search.ts, no AI): while you type a message, the most useful earlier answers show above the message
    // box as small cards: a question with its best answer ("3 asked", "Update", "Different answers"), or a message that
    // carries the information itself. See all opens find mode with every result; Back leaves it with your draft kept.
    type Findable = { id: string; name: string; seed: string; body: string; createdAt?: string; pending?: boolean; image?: string | null; file?: string | null; reactions?: { emoji: string; count: number }[]; post?: CourseGroupPost };
    const findWords = (text: string) => text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const markFirst = (body: string, text: string) => {
      const lower = body.toLowerCase();
      const word = findWords(text).find((candidate) => lower.includes(candidate));
      // Mark where a word starts with it when there is one ("m" in "midterm", not the "m" inside "team").
      let at = -1;
      if (word) {
        for (let i = lower.indexOf(word); i >= 0; i = lower.indexOf(word, i + 1)) if (i === 0 || !/[\p{L}\p{N}]/u.test(lower[i - 1])) { at = i; break; }
        if (at < 0) at = lower.indexOf(word);
      }
      if (at < 0 || !word) return body;
      const start = Math.max(0, at - 40);
      return <>{start > 0 ? "…" : ""}{body.slice(start, at)}<mark>{body.slice(at, at + word.length)}</mark>{body.slice(at + word.length)}</>;
    };
    const fromPost = (post: CourseGroupPost): SearchMessage => ({ id: post.id, name: post.author?.displayName || "York Student", author: post.author?.displayName || post.id, body: post.body || "", createdAt: post.createdAt, pending: post.pending, image: post.kind === "image" ? post.imageUrl : null, file: post.kind === "attachment" ? post.imageUrl : null, reactions: post.reactions, replyToId: post.replyToId || null });
    const fromItem = (item: Findable): SearchMessage => item.post ? fromPost(item.post) : { id: item.id, name: item.name, author: item.seed, body: item.body || "", createdAt: item.createdAt, pending: item.pending, image: item.image, file: item.file, reactions: item.reactions };
    // What the search looks through: the chat on the phone, plus (course chats) the whole term from the server.
    const searchPool = (items: Findable[], courseId?: string) => {
      const local = items.map(fromItem);
      const known = new Set(local.map((item) => item.id));
      const remote = courseId && serverSearch?.groupId === courseId ? serverSearch.messages.filter((post) => !known.has(post.id)).map(fromPost) : [];
      return { messages: [...remote, ...local], known, clicks: courseId && serverSearch?.groupId === courseId ? serverSearch.clicks : {} };
    };
    const postById = (id: string, items: Findable[]) => items.find((item) => item.id === id)?.post || serverSearch?.messages.find((post) => post.id === id) || null;
    // Tapping a result: count it (so it ranks higher next time), then jump to it in the chat, or open its
    // conversation on its own when it's older than what the chat has loaded.
    const openSearchResult = (card: SearchCard, messageId: string, text: string, known: Set<string>, courseId?: string) => {
      if (courseId) request(`/api/course-groups/${courseId}/search-click`, { method: "POST", body: JSON.stringify({ key: queryKey(text), messageId }) }, token).catch(() => {});
      if (known.has(messageId)) { setSearchThread(null); jumpToMessage(messageId); return; }
      setSearchThread({ ids: card.thread.map((message) => message.id), focus: messageId });
      jumpToMessage(messageId); // leaves find mode, then scrolls to it and flashes it in the conversation
    };
    // One discussion on the results page: the statement (a question or a message with the information), then every
    // reply indented under it, with the best answer and any update marked. Tap anything to see it in the chat.
    const discussion = (card: SearchCard, text: string, items: Findable[], known: Set<string>, courseId: string | undefined) => {
      const replies = card.thread.filter((message) => message.id !== card.hit.id);
      const open = (id: string) => openSearchResult(card, id, text, known, courseId);
      return (
        <li key={card.key} className={`mx-disc ${card.kind}`}>
          <button type="button" className="mx-disc-statement" onClick={() => open(card.hit.id)}>
            <span className="mx-disc-meta"><strong>{card.hit.name}</strong>{card.hit.createdAt && <time dateTime={card.hit.createdAt}>{timeAgo(card.hit.createdAt)}</time>}{card.askedCount > 1 && <b>{card.askedCount} asked</b>}{card.past && <em>Date passed</em>}{card.conflict && !card.newer && <em className="warn">Different answers</em>}</span>
            <span className="mx-disc-text">{markFirst(card.hit.body, text)}</span>
          </button>
          {replies.length > 0 ? (
            <ul className="mx-disc-replies">
              {replies.map((reply) => {
                const best = card.answer?.id === reply.id;
                const update = card.newer?.id === reply.id;
                const post = best && courseId ? postById(reply.id, items) : null;
                const thumbs = post?.reactions?.find((reaction) => reaction.emoji === "👍")?.count || 0;
                return (
                  <li key={reply.id} className={best ? "best" : update ? "update" : ""}>
                    <button type="button" className="mx-disc-reply" onClick={() => open(reply.id)}>
                      <span className="mx-disc-meta">{reply.replyToId === card.hit.id && <ReplyIcon size={12} aria-hidden="true" />}<strong>{reply.name}</strong>{reply.createdAt && <time dateTime={reply.createdAt}>{timeAgo(reply.createdAt)}</time>}{best && <b className="best">Best answer</b>}{update && <b className="update">{card.newerLinked ? "Update" : "Possible update"}</b>}</span>
                      <span className="mx-disc-text">{reply.body}</span>
                    </button>
                    {post && <button type="button" className={post.myReaction === "👍" ? "mx-sr-helpful on" : "mx-sr-helpful"} aria-pressed={post.myReaction === "👍"} onClick={() => reactToCoursePost(post, "👍")}>👍{thumbs > 0 && <b>{thumbs}</b>}<span>Helpful</span></button>}
                  </li>
                );
              })}
            </ul>
          ) : card.kind === "question" ? <p className="mx-disc-none">No answer yet</p> : null}
        </li>
      );
    };
    // A discussion is a thread: a question with answers, or a message with replies.
    const isThread = (card: SearchCard) => card.thread.length > 1;
    // Messages in the plain list: they contain the word (or carry real information about it), best first.
    const mentionsIt = (card: SearchCard, text: string) => !card.junk || findWords(text).some((word) => card.hit.body.toLowerCase().includes(word));
    // Above the message box: one line, "Found N discussions about …"; tapping it opens the results page.
    const findHint = (items: Findable[], draft: string, courseId?: string) => {
      if (!draft.trim() || chatFind !== null) return null; // from the first letter typed
      const pool = searchPool(items, courseId);
      const cards = searchChat(pool.messages, draft, { clicks: pool.clicks, keepJunk: true, courseCode: courseId ? activeCourseGroup?.courseCode : undefined });
      // Discussions (threads: a message with replies) first; when there are none, fall back to the messages that
      // contain the word.
      const discussions = cards.filter(isThread).length;
      const mentions = cards.filter((card) => !isThread(card) && mentionsIt(card, draft)).length;
      const count = discussions || mentions;
      if (!count) return null;
      return (
        <button type="button" className="mx-find-count" onClick={() => setChatFind(draft.trim())}>
          <Search size={15} aria-hidden="true" />
          <span>Found <strong>{count} {discussions ? `discussion${count === 1 ? "" : "s"}` : `message${count === 1 ? "" : "s"}`}</strong> {discussions ? "about" : "with"} “{draft.trim()}”</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      );
    };
    const findResults = (items: Findable[], where: string, courseId?: string) => {
      const needle = (chatFind || "").trim();
      if (!needle) return <div className="mx-find-hint"><h3>Search {where}</h3><p>Find answers, dates and messages by word or by who sent them.</p></div>;
      const pool = searchPool(items, courseId);
      const cards = searchChat(pool.messages, needle, { clicks: pool.clicks, includeNames: true, keepJunk: true, courseCode: courseId ? activeCourseGroup?.courseCode : undefined });
      if (!cards.length) return <div className="mx-find-hint"><p>No messages match “{needle}”</p></div>;
      // Same discussions as the line above the message box; messages that only mention the word ("midterm sucks")
      // are listed underneath, smaller, so nothing is hidden.
      const main = cards.filter(isThread);
      const other = cards.filter((card) => !isThread(card) && mentionsIt(card, needle)); // still in ranked order
      return (
        <div className="mx-find-results">
          {main.length > 0 && <><h3 className="mx-label">{main.length} discussion{main.length === 1 ? "" : "s"} about “{needle}”</h3>
          <ul className="mx-disc-list">{main.map((card) => discussion(card, needle, items, pool.known, courseId))}</ul></>}
          {other.length > 0 && <><h3 className="mx-label">{main.length ? `Messages with “${needle}” · ${other.length}` : `${other.length} message${other.length === 1 ? "" : "s"} with “${needle}”`}</h3>
          <ul className="mx-disc-other">{other.map((card) => <li key={card.key}><button type="button" onClick={() => openSearchResult(card, card.hit.id, needle, pool.known, courseId)}><strong>{card.hit.name}</strong> {markFirst(card.hit.body, needle)}{card.hit.createdAt && <time dateTime={card.hit.createdAt}>{timeAgo(card.hit.createdAt)}</time>}</button></li>)}</ul></>}
        </div>
      );
    };
    // Composer emoji picker: tapping an emoji adds it to the message being typed.
    const emojiPicker = (onPick: (emoji: string) => void) => (
      <div className="mx-emoji-pop" role="dialog" aria-label="Emoji" onClick={(event) => event.stopPropagation()}>
        {EMOJI_GROUPS.map(([group, emojis]) => (
          <section key={group}><h4>{group}</h4><div>{splitEmoji(emojis).map((emoji) => <button type="button" key={emoji} onClick={() => onPick(emoji)}>{emoji}</button>)}</div></section>
        ))}
      </div>
    );

    const infoPage = (title: string, onBack: () => void, body: ReactNode) => (
      <section className="mx-page mx-info-page"><header className="mx-page-header"><button type="button" className="mx-page-back" aria-label="Back" onClick={onBack}><ChevronLeft size={22} /></button><h2>{title}</h2></header><div className="mx-page-scroll">{body}</div></section>
    );

    const openProfilePage = (page: "edit" | "privacy" | "account" | "legal" | "contact" | "notifications" | "moderation") => {
      if (page === "contact") setContactSent(false);
      if (page === "moderation") loadModeration().catch((error) => setNotice(error.message));
      setDegreePickerOpen(false);
      setCreatingCourse(false);
      if (page === "notifications") {
        setProfilePage(null);
        notifSettingsFromFull.current = mobileMain;
        setNotifSettingsOpen(true);
        loadNotifSettings();
      } else {
        setNotifSettingsOpen(false);
        profilePageFromFull.current = mobileMain;
        setProfilePage(page);
        if (page === "account") setPasswordForm({ current: "", next: "", confirm: "" });
      }
      setMobileMain(true);
    };
    const profileRow = (icon: ReactNode, label: string, onClick: () => void, current: boolean) => (
      <button type="button" className={current ? "mx-me-row active" : "mx-me-row"} onClick={onClick}>{icon}<span>{label}</span><ChevronRight size={18} /></button>
    );
    // Profile and settings in one place: the profile circle on the rail opens this.
    // The CCConnect App page: the team's status post (editable by them) and how to use the website on a phone meanwhile.
    // This device's website notifications (Web Push); the iPhone app has its own system notifications.
    const webPushCard = isNativeApp ? null : (
      <div className="mx-card mx-webpush">
        <span className="mx-notif-icon"><Bell size={18} /></span>
        <span className="mx-row-main">
          <strong>Notifications on this device</strong>
          <small>{({
            loading: "Checking…",
            on: "On. You'll get messages, replies and invites here.",
            off: "Get messages, replies and invites even when CCConnect is closed.",
            denied: isIOS() ? "Blocked. Turn them on in iPhone Settings → Notifications → CCConnect." : "Blocked by your browser. Allow notifications for ccconnect.app in its site settings, then come back.",
            "needs-install": "On iPhone, add CCConnect to your Home Screen first, then open it from there to turn these on.",
            unsupported: "This browser can't show notifications from websites.",
            unavailable: "Notifications for the website aren't available yet.",
          } as Record<WebPushState, string>)[webPushState]}</small>
        </span>
        {webPushState === "off" && <button type="button" className="mx-webpush-btn" disabled={webPushBusy} onClick={enableWebPush}>{webPushBusy ? "Turning on…" : "Turn on"}</button>}
        {webPushState === "on" && <button type="button" className="mx-webpush-btn quiet" disabled={webPushBusy} onClick={disableWebPush}>Turn off</button>}
        {(webPushState === "on" || webPushState === "needs-install" || webPushState === "unsupported") && <button type="button" className="mx-webpush-test" onClick={sendPushTest}>Send a test notification</button>}
        {pushTestResult && <p className="mx-webpush-result">{pushTestResult}</p>}
        {webPushState === "needs-install" && <button type="button" className="mx-webpush-btn" onClick={startInstall}>How</button>}
      </div>
    );
    // "Add CCConnect to Home Screen": Android/desktop Chrome shows its own prompt; iPhone gets step-by-step help.
    const installCard = isNativeApp ? null : isStandalone() ? (
      <div className="mx-install-card done"><span className="mx-install-icon"><img src="/icon-192.png" alt="" /></span><span><strong>You're using the CCConnect app</strong><small>Opened from your Home Screen.</small></span></div>
    ) : (
      // Looks like CCConnect's icon on a Home Screen; tapping it starts the install (or shows the steps on iPhone).
      <button type="button" className="mx-homescreen-tile" onClick={startInstall}>
        <span className="mx-homescreen-icon"><img src="/icon-192.png" alt="" /><span className="mx-homescreen-plus" aria-hidden="true"><Plus size={14} strokeWidth={3} /></span></span>
        <span className="mx-homescreen-name">CCConnect</span>
        <strong>Add CCConnect to your Home Screen</strong>
        <small>Tap to see how. Opens full screen like an app.</small>
      </button>
    );
    const appStatusBody = (
      <div className="mx-app-status">
        {installCard}
        <div className="mx-app-hero"><span className="mx-app-icon" aria-hidden="true"><img src="/favicon.png" alt="" /></span><div><strong>CCConnect for iPhone</strong><span>Coming to the App Store</span></div></div>
        {appStatus === null ? <p className="mx-note">Loading…</p> : appStatusDraft ? (
          <form className="mx-app-edit" onSubmit={saveAppStatus}>
            <label>Title<input value={appStatusDraft.title} maxLength={100} onChange={(event) => setAppStatusDraft((draft) => draft && { ...draft, title: event.target.value })} required /></label>
            <label>Update<textarea value={appStatusDraft.body} maxLength={3000} rows={8} onChange={(event) => setAppStatusDraft((draft) => draft && { ...draft, body: event.target.value })} placeholder="How's the app going? Review status, what's new, when it's coming…" /></label>
            <div className="mx-app-edit-actions"><button type="button" className="mx-app-cancel" onClick={() => setAppStatusDraft(null)}>Cancel</button><button className="mx-app-save" disabled={appStatusSaving || !appStatusDraft.title.trim()}>{appStatusSaving ? "Saving…" : "Save"}</button></div>
          </form>
        ) : (
          <article className="mx-app-post">
            <header><span className="mx-app-badge">Update from the CCConnect team</span>{appStatus.canEdit && devMode && <button type="button" className="mx-app-editbtn" onClick={() => setAppStatusDraft({ title: appStatus.title, body: appStatus.body })}>Edit</button>}</header>
            <h3>{appStatus.title}</h3>
            {appStatus.body && <div className="mx-app-body">{appStatus.body.split("\n").map((line, index) => line.trim() ? <p key={index}><LinkedText text={line} /></p> : <span key={index} className="mx-app-gap" />)}</div>}
            {appStatus.updatedAt && <time dateTime={appStatus.updatedAt}>Updated {timeAgo(appStatus.updatedAt)}</time>}
          </article>
        )}
        {isStandalone() && webPushCard}
      </div>
    );
    const profileBody = guest ? (
      // Guests: no profile yet, just a way to make a real one (or leave).
      <div className="mx-me mx-guest-me">
        <div className="mx-me-hero">
          <span className="mx-guest-icon" aria-hidden="true"><UserRound size={40} /></span>
          <h1>You're browsing as a guest</h1>
          <p>You can add courses and read the chats. Names are hidden and you can't send messages, react or create anything until you sign up with your York email.</p>
        </div>
        <div className="mx-guest-actions">
          <button type="button" className="mx-primary" onClick={() => leaveGuest("auth")}>Sign up with your York email</button>
          <button type="button" className="mx-secondary" onClick={() => leaveGuest("login")}>I already have an account</button>
          <button type="button" className="mx-guest-leave" onClick={async () => { if (await askConfirm({ title: "Stop browsing as a guest?", message: "The courses you added on this device will be cleared.", action: "Stop browsing" })) logout(); }}>Stop browsing as a guest</button>
        </div>
      </div>
    ) : (
      <div className="mx-me">
        <div className="mx-me-hero">
          <Avatar name={name} className="avatar-large mx-profile-avatar" />
          <h1>{name}</h1>
          {account?.email && <p className="mx-me-email">{account.email.split("@")[0]}<wbr />@{account.email.split("@")[1]}</p>}
          <p className="mx-me-verified"><CircleCheck size={16} />Verified York Student</p>
          <p className="mx-me-degree">{degree ? `${degree.credentials && !degree.credentials.includes(",") ? degree.credentials : degree.name} · York University` : "York University"}</p>
          {identity.bio && <p className="mx-me-bio">{identity.bio}</p>}
          <button type="button" className="mx-me-edit" onClick={() => openProfilePage("edit")}>Edit Profile</button>
        </div>
        <h3 className="mx-label">Settings</h3>
        <div className="mx-me-list">
          {profileRow(<Bell size={20} />, "Notifications", () => openProfilePage("notifications"), notifSettingsOpen)}
          {profileRow(<Shield size={20} />, "Privacy & Safety", () => openProfilePage("privacy"), profilePage === "privacy")}
          {profileRow(<Lock size={20} />, "Account & Security", () => openProfilePage("account"), profilePage === "account")}
          {profileRow(<FileText size={20} />, "Terms and Services", () => openProfilePage("legal"), profilePage === "legal")}
          {profileRow(<Mail size={20} />, "Contact CCConnect", () => openProfilePage("contact"), profilePage === "contact")}
          <label className="mx-me-row mx-switch-row"><Moon size={20} /><span>Dark mode</span><input type="checkbox" role="switch" aria-label="Dark mode" checked={darkMode} onChange={(event) => setTheme(event.target.checked ? "dark" : "light")} /></label>
          {isTeam && <label className="mx-me-row mx-switch-row"><ShieldCheck size={20} /><span>Dev mode<small className="mx-me-row-note">{devMode ? "Team tools on" : "Seeing CCConnect as a student"}</small></span><input type="checkbox" role="switch" aria-label="Dev mode" checked={devMode} onChange={(event) => toggleDevMode(event.target.checked)} /></label>}
          {isAdmin && profileRow(<ShieldCheck size={20} />, `Moderation${openReportCount ? ` · ${openReportCount} open` : ""}`, () => openProfilePage("moderation"), profilePage === "moderation")}
        </div>
        <div className="mx-me-list mx-me-bottom">
          <button type="button" className="mx-me-row mx-me-logout" onClick={logout}><LogOut size={20} /><span>Log Out</span></button>
        </div>
      </div>
    );
    // Rail tabs: Alerts and Profile replace the course list in its column instead of opening a page.
    const showPanel = (panel: "courses" | "posts" | "alerts" | "profile" | "app") => {
      // Switching between the drawer screens and the course list mustn't animate the layers across.
      const root = document.querySelector<HTMLElement>(".mx");
      root?.classList.add("mx-dragging");
      window.setTimeout(() => root?.classList.remove("mx-dragging"), 80);
      setRailPanel(panel);
      backToAlerts.current = false;
      setDegreePickerOpen(false);
      setNotifSettingsOpen(false);
      setProfilePage(null);
      setCreatingCourse(false);
      setChatFind(null);
      const bigView = { courses: null, posts: "social", alerts: "alerts", profile: "profile", app: "app-info" } as const;
      if (panel === "app") { appStatusOpened.current = true; loadAppStatus(); }
      if (!isWide()) {
        const page = bigView[panel];
        if (page) setTab(page);
        else if (["social", "post", "create", "alerts", "profile", "settings", "app-info"].includes(tab)) setTab("your-courses"); // nothing to swipe back to
      } else {
        // Website: Dev Posts, Alerts and Profile are full pages (no course list beside them); Degree brings the
        // three-column view back, opening the Degree Forum if a full page was showing.
        const page = bigView[panel];
        if (page) setTab(page);
        else if (["social", "post", "create", "alerts", "profile", "settings", "app-info"].includes(tab)) setTab(!DEGREE_FORUM ? FORUM_HOME : degree ? "degree-posts" : "your-courses");
      }
      if (panel === "alerts" && unreadNotifications > 0) {
        markNotificationsSeen();
      }
      if (!isWide()) setMobileMain(false);
    };
    // Shimmering placeholder rows while a chat or a course's posts load for the first time.
    const loadingRows = (shape: "chat" | "posts" | "cards") => shape === "cards" ? (
      // Post cards, Instagram-style: avatar + name, a title, a photo block and the action pills, shimmering.
      <div className="mx-skeleton cards" aria-label="Loading posts" role="status">
        {[0, 1, 2].map((card) => <div key={card} className="mx-skel-card" style={{ "--i": card } as CSSProperties}><div className="mx-skel-row"><span className="mx-skel-dot" /><span className="mx-skel-lines"><i /></span></div><i className="mx-skel-title" />{card !== 1 && <i className="mx-skel-photo" />}<span className="mx-skel-pills"><i /><i /></span></div>)}
      </div>
    ) : (
      <div className={`mx-skeleton ${shape}`} aria-label="Loading" role="status">
        {[0, 1, 2, 3].map((row) => <div key={row} className="mx-skel-row" style={{ "--i": row } as CSSProperties}><span className="mx-skel-dot" /><span className="mx-skel-lines"><i /><i /></span></div>)}
      </div>
    );
    const renderFeed = (list: Post[], empty: ReactNode, general = false) => (<>
            {list.length === 0 ? empty : list.map((post, index) => {
              const [title, ...rest] = post.body.split("\n\n");
              // Visitors read one post; the rest are blurred and lead to sign-up.
              if (post.locked) return <Fragment key={post.id}>
                {index > 0 && list[index - 1] && !list[index - 1].locked && <div className="mx-guest-wall"><strong>Sign up to see the rest</strong><span>Every post and comment is open to York students.</span><button type="button" onClick={() => leaveGuest("auth")}>Sign up</button></div>}
                <article className="mx-post mx-post-locked"><button type="button" className="mx-post-open" aria-label="Sign up to read this post" onClick={() => leaveGuest("auth")}>
                  <span className="mx-post-meta" aria-hidden="true"><Avatar name="York Student" seed={post.id} /><strong>York Student</strong></span>
                  <strong className="mx-post-title" aria-hidden="true">{title}</strong>
                  {rest.length > 0 && <span className="mx-post-preview" aria-hidden="true">{rest.join(" ")}</span>}
                </button></article>
              </Fragment>;
              return (
                <article className={openPostMenu === post.id ? "mx-post menu-open" : "mx-post"} key={post.id}>
                  {/* ⋯ in the top right corner: yours = Edit / Delete; others' = Report / Block (moderators can also delete). */}
                  <div className="mx-post-more">
                    <button type="button" aria-label="Post options" aria-expanded={openPostMenu === post.id} onClick={(event) => { event.stopPropagation(); setOpenPostMenu((open) => open === post.id ? null : post.id); }}><MoreHorizontal size={18} /></button>
                    {openPostMenu === post.id && (() => {
                      const target = { type: "post" as const, id: post.id, what: "post", authorName: post.author.displayName || "York Student", preview: title };
                      const pick = (action: () => void) => () => { setOpenPostMenu(null); action(); };
                      return <>
                        <div className="mx-post-menu-backdrop" onClick={() => setOpenPostMenu(null)} />
                        <div className="mx-post-menu" role="menu">
                          {post.isMine ? <>
                            <button type="button" role="menuitem" onClick={pick(() => { postFromGeneral.current = general; editPost(post); })}><Pencil size={16} />Edit</button>
                            <button type="button" role="menuitem" className="danger-text" onClick={pick(() => askDeletePost(post))}><Trash2 size={16} />Delete</button>
                          </> : <>
                            <button type="button" role="menuitem" onClick={pick(() => openReport(target))}><Flag size={16} />Report</button>
                            {!guest && <button type="button" role="menuitem" className="danger-text" onClick={pick(() => blockAuthor(target))}><Ban size={16} />Block</button>}
                            {isAdmin && <button type="button" role="menuitem" className="danger-text" onClick={pick(() => askDeletePost(post))}><Trash2 size={16} />Delete (moderator)</button>}
                          </>}
                        </div>
                      </>;
                    })()}
                  </div>
                  {general && post.courseCode && <button type="button" className="mx-post-course" onClick={() => { const group = courseGroups.find((item) => item.id === post.courseGroupId); if (group) shellOpenCourse(group); }}><Hash size={13} aria-hidden="true" />{post.courseCode}</button>}
                  <button type="button" className="mx-post-open" onClick={(event) => { rememberListScroll(event.currentTarget); backToAlerts.current = false; openComments(post, general); setMobileMain(true); }}>
                    <span className="mx-post-meta"><Avatar name={post.author.displayName || "CCConnect"} seed={post.author.displayName || post.id} /><strong>{post.author.displayName || "CCConnect"}</strong>{post.author.displayName === TEAM_NAME && <TeamBadge />}<span aria-hidden="true">·</span><time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>{post.flair && <em className="mx-flair">{flairLabel(post.flair)}</em>}</span>
                    <strong className="mx-post-title">{title}</strong>
                    {/* With photos, the list shows just the title and photos; the description is on the post page (owner's call, Nov 2 2026). */}
                    {rest.length > 0 && !(post.imageUrls?.length) && <span className="mx-post-preview">{rest.join(" ")}</span>}
                  </button>
                  {(post.imageUrls?.length || 0) > 0 && <ImageCarousel images={post.imageUrls || []} className="mx-post-images" onOpen={() => { rememberListScroll(document.querySelector<HTMLElement>(".mx-main .mx-page-scroll.mx-feed")); backToAlerts.current = false; openComments(post, general); setMobileMain(true); }} />}
                  <div className="mx-post-actions">
                    <button type="button" onClick={(event) => { rememberListScroll(event.currentTarget); backToAlerts.current = false; openComments(post, general); setMobileMain(true); }} aria-label={`${post.commentCount} comments`}><MessageCircle size={17} />{post.commentCount}</button>
                    <button type="button" onClick={() => sharePost(post)}><Share2 size={16} />Share</button>
                  </div>
                </article>
              );
            })}
    </>);
    // Post comments, shared by the post page and the Feed's comments sheet.
    // Reddit-style threads: any comment can be replied to; replies nest under their parent (indent stops after 5 levels).
    const commentThreads = () => {
      const commentIds = new Set(comments.map((comment) => comment.id));
      const top = comments.filter((comment) => !comment.parentCommentId || !commentIds.has(comment.parentCommentId));
      const repliesTo = (id: string) => comments.filter((comment) => comment.parentCommentId === id);
      const thread = (comment: PostComment, depth: number): ReactNode => {
        const children = repliesTo(comment.id);
        return (
          <div className="mx-thread-item" key={comment.id}>
            {commentRow(comment)}
            {children.length > 0 && <div className={depth < 5 ? "mx-thread" : "mx-thread flat"}>{children.map((child) => thread(child, depth + 1))}</div>}
          </div>
        );
      };
      const commentRow = (comment: PostComment) => (
        <div className={comment.pending ? "mx-comment pending" : "mx-comment"}>
          <Avatar name={comment.authorName || "York Student"} seed={comment.authorName || comment.id} />
          <div><div className="mx-comment-head"><strong>{comment.authorName || "York Student"}</strong>{comment.authorName === TEAM_NAME && <TeamBadge />}<time dateTime={comment.createdAt}>{timeAgo(comment.createdAt)}</time></div>{comment.body && <p><LinkedText text={comment.body} /></p>}{comment.imageUrl && <img className="mx-comment-photo" src={comment.imageUrl} alt="" onClick={() => setCommentPhotoView(comment.imageUrl || null)} />}{!guest && <button type="button" className="mx-comment-reply" onClick={() => setReplyTo(comment)}>Reply</button>}{!guest && !comment.isMine && <button type="button" className="mx-comment-reply" onClick={() => openReport({ type: "comment", id: comment.id, what: "comment", authorName: comment.authorName || "York Student", preview: comment.body })}>Report</button>}{!guest && !comment.isMine && <button type="button" className="mx-comment-reply" onClick={() => blockAuthor({ type: "comment", id: comment.id, what: "comment", authorName: comment.authorName || "York Student", preview: comment.body })}>Block</button>}{(comment.isMine || isAdmin) && <button type="button" className="mx-comment-reply danger-text" onClick={() => { askConfirm({ title: "Delete this comment?", message: comments.some((item) => item.parentCommentId === comment.id) ? "It's removed for everyone, along with the replies under it." : "It's removed for everyone.", action: "Delete" }).then((ok) => { if (ok) deleteComment(comment); }); }}>Delete</button>}{isAdmin && !comment.isMine && <button type="button" className="mx-comment-reply danger-text" onClick={() => startBan({ type: "comment", id: comment.id, what: "comment", authorName: comment.authorName || "York Student", preview: comment.body })}>Ban</button>}</div>
        </div>
      );
      const threads = top.map((comment) => thread(comment, 0));
      return guest ? <div className="mx-comments-locked" aria-hidden="true">{threads}</div> : threads;
    };
    const commentComposer = guest ? <div className="mx-composer-note">Browsing as a visitor · <button type="button" onClick={() => leaveGuest("auth")}>Sign up to read the comments</button></div> : (
            <form className="mx-composer" onSubmit={addComment}>
              {replyTo && <div className="mx-replying">Replying to <strong>{replyTo.authorName || "York Student"}</strong><button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><X size={14} /></button></div>}
              {/* The round + on the left of the comment box (owner's call, Nov 2 2026); what it opens comes next. */}
              <div className="mx-comment-row"><button type="button" className="mx-comment-plus" aria-label="Add from your notes" onClick={() => openNotePicker()}><Plus size={22} /></button><div className="mx-composer-box"><LengthNote text={commentDraft} />
                {commentImage && <div className="mx-comment-attach"><img src={commentImage.src} alt="" /><button type="button" aria-label="Remove photo" onClick={() => setCommentImage(null)}><X size={14} /></button></div>}
                <div className="mx-composer-row">
                <textarea rows={1} placeholder={replyTo ? "Write a reply" : "Add a comment"} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} onInput={(event) => { const box = event.currentTarget; box.style.height = "0px"; box.style.height = `${Math.min(box.scrollHeight, 140)}px`; }} onKeyDown={sendChatOnEnter} />
                {(commentDraft.trim() || commentImage) && <button className="mx-send" aria-label="Send" disabled={tooLong(commentDraft)}><Send size={17} /></button>}
              </div></div></div>
            </form>
          );
    // ---- The Feed: one post per screen, swipe (or scroll / arrow keys) for the next ----
    const feedTone = (id: string) => { let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0; return Math.abs(hash) % 6; };
    // A feed post is one piece of text (no title + body); old Dev Posts' title and body show as one block too.
    const feedText = (post: FeedPost) => {
      const text = post.body.replace(/\n{2,}/g, "\n").trim();
      const size = text.length < 60 ? "xl" : text.length < 140 ? "lg" : text.length < 260 ? "md" : "sm";
      return <p className={`mx-reel-text ${size}`}><LinkedText text={text} /></p>;
    };
    const feedPollView = (post: FeedPost) => {
      const total = post.pollCounts[0] + post.pollCounts[1];
      const voted = post.myVote !== null;
      return (
        <div className={voted ? "mx-reel-poll voted" : "mx-reel-poll"}>
          {post.pollOptions.map((option, index) => {
            const share = total ? Math.round((post.pollCounts[index] / total) * 100) : 0;
            return (
              <button type="button" key={index} disabled={voted || guest} className={post.myVote === index ? "mine" : ""} onClick={() => voteFeedPoll(post, index)}>
                {voted && <span className="mx-reel-poll-bar" style={{ width: `${share}%` }} aria-hidden="true" />}
                <span className="mx-reel-poll-label">{option}</span>
                {voted && <b>{share}%</b>}
              </button>
            );
          })}
          {voted && <small>{total} vote{total === 1 ? "" : "s"}</small>}
        </div>
      );
    };
    const feedItem = (post: FeedPost) => {
      const name = post.author.displayName || "York Student";
      const report = { type: "post" as const, id: post.id, what: "post", authorName: name, preview: post.body.slice(0, 120) };
      return (
        <article key={post.id} className={`mx-reel-item tone-${feedTone(post.id)}`} data-post={post.id}>
          <div className="mx-reel-card">
            <header className="mx-reel-head">
              <Avatar name={name} seed={name} /><strong>{name}</strong>{name === TEAM_NAME && <TeamBadge />}<time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
              {post.pinned && <em className="mx-reel-pin">Today</em>}
              {!guest && <span className="mx-reel-menu-wrap">
                <button type="button" className="mx-reel-menu" aria-label="Post options" onClick={() => setFeedMenu(feedMenu === post.id ? null : post.id)}><MoreHorizontal size={20} /></button>
                {feedMenu === post.id && <span className="mx-reel-menu-list" role="menu">
                  {post.isMine || isAdmin ? <button type="button" className="danger" onClick={() => { setFeedMenu(null); askDeletePost(feedAsPost(post)).then(() => loadFeed()); }}>{post.isMine ? "Delete" : "Delete (moderator)"}</button> : <>
                    <button type="button" onClick={() => { setFeedMenu(null); openReport(report); }}>Report</button>
                    <button type="button" onClick={() => { setFeedMenu(null); blockAuthor(report); }}>Block</button>
                  </>}
                </span>}
              </span>}
            </header>
            <div className="mx-reel-body">
              {feedText(post)}
              {post.pollOptions.length === 2 && feedPollView(post)}
              {post.imageUrls.length > 0 && <ImageCarousel images={post.imageUrls} className="mx-post-images mx-reel-images" />}
            </div>
            <div className="mx-reel-actions">
              <button type="button" className={post.liked ? "liked" : ""} aria-pressed={post.liked} aria-label={`Like, ${post.likes}`} onClick={() => likeFeedPost(post)}><Heart size={26} fill={post.liked ? "currentColor" : "none"} /><b>{post.likes}</b></button>
              <button type="button" aria-label={`Comments, ${post.commentCount}`} onClick={() => openFeedComments(post)}><MessageCircle size={26} /><b>{post.commentCount}</b></button>
              <button type="button" aria-label="Share" onClick={() => sharePost(feedAsPost(post))}><Share2 size={24} /></button>
            </div>
            <button type="button" className="mx-reel-comments-link" onClick={() => openFeedComments(post)}>{post.commentCount ? `${post.commentCount} comment${post.commentCount === 1 ? "" : "s"} · join in` : "Be the first to comment"}</button>
          </div>
        </article>
      );
    };
    const feedScroll = (direction: 1 | -1) => {
      const box = document.querySelector<HTMLElement>(".mx-reel");
      box?.scrollBy({ top: direction * box.clientHeight, behavior: "smooth" });
    };
    const feedView = (
      <section className="mx-page mx-feed-page">
        <header className="mx-page-header"><button type="button" className="mx-page-back mx-menu-button" aria-label="Open menu" onClick={shellBack}><Menu size={22} /></button><h2>Feed</h2>{!guest && <div className="mx-page-actions"><button type="button" className="mx-new-post mx-new-post-icon mx-new-post-plus" aria-label="New post" onClick={() => { if (!membersOnly("post")) setFeedComposer(true); }}><Plus size={20} /></button></div>}</header>
        {guest ? <div className="mx-chat-empty"><span aria-hidden="true"><Flame size={26} /></span><h3>York's feed</h3><p>Sign up with your York email to see what students are talking about.</p><button type="button" className="mx-primary" onClick={() => leaveGuest("auth")}>Sign up</button></div>
        : feedPosts === null ? loadingRows("posts")
        : feedPosts.length === 0 ? <div className="mx-chat-empty"><span aria-hidden="true"><Flame size={26} /></span><h3>Nothing here yet</h3><p>Say something to York: a thought, a question, or a quick poll.</p><button type="button" className="mx-primary" onClick={() => setFeedComposer(true)}>Write the first post</button></div>
        : (
          <div className="mx-reel" tabIndex={0} aria-label="Feed, one post at a time" onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "j") { event.preventDefault(); feedScroll(1); } if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault(); feedScroll(-1); } }}>
            {feedPosts.slice(0, feedCaughtUpAt).map(feedItem)}
            <article className="mx-reel-item mx-reel-caught" data-caught="true">
              <div className="mx-reel-card"><span aria-hidden="true"><Check size={30} /></span><h3>You're caught up</h3><p>{feedPosts.length > feedCaughtUpAt ? "Below are the week's most discussed posts you've already seen." : "That's everything for now. Post something, or check back later."}</p><button type="button" className="mx-primary" onClick={() => setFeedComposer(true)}>Write a post</button></div>
            </article>
            {feedPosts.slice(feedCaughtUpAt).map(feedItem)}
          </div>
        )}
        {feedSheet && (
          <div className="mx-reel-sheet-layer" onClick={closeFeedComments}>
            <div className="mx-reel-sheet" role="dialog" aria-label="Comments" onClick={(event) => event.stopPropagation()}>
              <header><strong>{comments.length} comment{comments.length === 1 ? "" : "s"}</strong><button type="button" aria-label="Close comments" onClick={closeFeedComments}><X size={20} /></button></header>
              <p className="mx-reel-sheet-post">{feedSheet.body.split("\n\n")[0]}</p>
              <div className="mx-reel-sheet-list">{comments.length === 0 ? <p className="mx-note">No comments yet. Start the conversation.</p> : commentThreads()}</div>
              {commentComposer}
            </div>
          </div>
        )}
        {feedComposer && (
          <div className="mx-reel-sheet-layer" onClick={() => setFeedComposer(false)}>
            <form className="mx-reel-sheet mx-reel-compose" role="dialog" aria-label="New post" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); publishFeedPost(); }}>
              <header><button type="button" onClick={() => setFeedComposer(false)}>Cancel</button><strong>New post</strong><button type="submit" className="mx-reel-post-btn" disabled={!feedDraft.trim() || feedDraft.trim().length > FEED_POST_MAX || Boolean(feedPoll && (!feedPoll[0].trim() || !feedPoll[1].trim()))}>Post</button></header>
              <textarea autoFocus rows={4} placeholder={feedPoll ? "Ask a question…" : "Say something to York… (a few sentences at most)"} value={feedDraft} onChange={(event) => setFeedDraft(event.target.value.replace(/\n{2,}/g, "\n"))} />
              <span className={feedDraft.trim().length > FEED_POST_MAX ? "mx-reel-count over" : "mx-reel-count"}>{feedDraft.trim().length}/{FEED_POST_MAX}</span>
              {feedPoll ? <div className="mx-reel-poll-inputs">
                <input maxLength={60} placeholder="Answer 1" value={feedPoll[0]} onChange={(event) => setFeedPoll([event.target.value, feedPoll[1]])} />
                <input maxLength={60} placeholder="Answer 2" value={feedPoll[1]} onChange={(event) => setFeedPoll([feedPoll[0], event.target.value])} />
                <button type="button" onClick={() => setFeedPoll(null)}>Remove poll</button>
              </div> : <button type="button" className="mx-reel-add-poll" onClick={() => setFeedPoll(["", ""])}><BarChart3 size={16} />Add a poll</button>}
            </form>
          </div>
        )}
      </section>
    );
    // Phones show the Feed as a page beside the rail (the "drawer", see `drawer` below) when it's the open tab; the side
    // panel only shows it when the Feed panel is open over another page.
    const feedInPanel = !isWide() && railPanel === "posts" && !(["social", "alerts", "profile", "app-info"].includes(tab) && !profilePage && !notifSettingsOpen);
    const newPostButton = canPostDev ? <div className="mx-page-actions"><button type="button" className="mx-new-post mx-new-post-icon mx-new-post-plus" aria-label="New post" title="New post" onClick={() => { setEditingPost(null); setPostScope("dev"); setPostTitle(""); setPostBody(""); setPostFlair(null); setPostImages([]); setPostKind("info"); setTab("create"); setMobileMain(true); }}><Plus size={16} /></button></div> : null;
    const feedList = renderFeed(posts, <div className="mx-chat-empty"><span aria-hidden="true"><Newspaper size={26} /></span><h3>No dev posts yet</h3><p>Updates from the CCConnect team show up here.</p></div>);
    let main: ReactNode;
    if (notifSettingsOpen && !guest) {
      const settings = notifSettings;
      // Only posts and replies can be switched off here; messages, invites and reminders always stay on.
      const save = (next: NotificationSettings) => saveNotifSettings({ ...next, offKinds: next.offKinds.filter((kind) => kind === "posts" || kind === "replies") });
      const sections: { title: string | null; chats: { id: string; label: string; locked: boolean }[] }[] = [
        ...myCourses.map((group) => ({ title: courseLabel(group), chats: [{ id: group.id, label: "class-chat", locked: false }, ...chatPreviews.projectRooms.filter((room) => room.courseGroupId === group.id).map((room) => ({ id: room.id, label: room.name, locked: true }))] })),
      ];
      const query = notifChatSearch.trim().toLowerCase();
      const matched = sections.map((section) => ({ ...section, chats: query && !(section.title || "").toLowerCase().includes(query) ? section.chats.filter((chat) => chat.label.toLowerCase().includes(query)) : section.chats })).filter((section) => section.chats.length);
      const total = matched.reduce((sum, section) => sum + section.chats.length, 0);
      const limit = notifChatsAll || query ? Infinity : 5;
      let left = limit;
      const shown = matched.map((section) => { const chats = section.chats.slice(0, Math.max(0, left)); left -= chats.length; return { ...section, chats }; }).filter((section) => section.chats.length);
      const bell = (chat: { id: string; label: string }) => {
        const muted = settings!.mutedChats.includes(chat.id);
        return <button type="button" className={muted ? "mx-bell muted" : "mx-bell"} aria-label={muted ? `Unmute ${chat.label}` : `Mute ${chat.label}`} aria-pressed={!muted} onClick={() => save({ ...settings!, mutedChats: muted ? settings!.mutedChats.filter((id) => id !== chat.id) : [...settings!.mutedChats, chat.id] })}>{muted ? <BellOff size={18} /> : <Bell size={18} />}</button>;
      };
      main = (
        <section className="mx-page mx-notif-settings">
          <header className="mx-page-header"><button type="button" className="mx-page-back" aria-label="Back" onClick={() => { setNotifSettingsOpen(false); setNotifChatSearch(""); setNotifChatsAll(false); if (!isWide()) setMobileMain(notifSettingsFromFull.current); }}><ChevronLeft size={22} /></button><h2>Notifications</h2></header>
          <div className="mx-page-scroll">
            {webPushCard}
            {!settings ? <p className="mx-note">Loading…</p> : (
              <>
                <div className="mx-card">
                  <label className="mx-switch-row">
                    <span className="mx-notif-icon"><Moon size={18} /></span>
                    <span className="mx-row-main"><strong>Pause all</strong><small>Nothing notifies you until you turn this off</small></span>
                    <input type="checkbox" role="switch" checked={settings.paused} onChange={(event) => save({ ...settings, paused: event.target.checked })} />
                  </label>
                </div>
                <h3 className="mx-label">Posts</h3>
                <div className="mx-card mx-list">
                  {([["posts", "New posts in your courses"], ["replies", "Comments and replies to you"]] as const).map(([id, label]) => (
                    <label key={id} className={settings.paused ? "mx-switch-row disabled" : "mx-switch-row"}>
                      <span className="mx-row-main"><strong>{label}</strong></span>
                      <input type="checkbox" role="switch" checked={!settings.offKinds.includes(id)} disabled={settings.paused} onChange={(event) => save({ ...settings, offKinds: event.target.checked ? settings.offKinds.filter((kind) => kind !== id) : [...settings.offKinds, id] })} />
                    </label>
                  ))}
                </div>
                <div className="mx-notif-chats-head"><h3 className="mx-label">Your chats</h3><span>Tap a bell to mute</span></div>
                {sections.length === 0 ? <p className="mx-note mx-note-left">Join a course to mute or unmute its chats here.</p> : (
                  <>
                    <label className="mx-notif-search"><Search size={16} /><input value={notifChatSearch} onChange={(event) => setNotifChatSearch(event.target.value)} placeholder="Search chats" /></label>
                    <div className={settings.paused ? "mx-card mx-notif-chats disabled" : "mx-card mx-notif-chats"}>
                      {shown.length === 0 && <p className="mx-note">No chats match “{notifChatSearch.trim()}”.</p>}
                      {shown.map((section, index) => (
                        <div key={section.title || "general"} className="mx-notif-group">
                          {section.title && <div className="mx-notif-course">{section.title}</div>}
                          {section.chats.map((chat) => {
                            const muted = settings.mutedChats.includes(chat.id);
                            return (
                              <div key={chat.id} className={`${section.title ? "mx-notif-chat nested" : "mx-notif-chat"}${muted ? " muted" : ""}${!section.title && index === 0 ? " top" : ""}`}>
                                {chat.locked ? <Lock size={15} /> : <Hash size={16} />}
                                <span>{chat.label}{muted && <small> · muted</small>}</span>
                                {bell(chat)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      {!query && total > 5 && <button type="button" className="mx-notif-more" onClick={() => setNotifChatsAll(!notifChatsAll)}>{notifChatsAll ? "Show less" : `View all ${total} chats`}<ChevronDown size={15} className={notifChatsAll ? "flip" : ""} /></button>}
                    </div>
                  </>
                )}
                <p className="mx-note mx-note-left">Project invites always notify you. Muted chats still show their number, in grey.</p>
              </>
            )}
          </div>
        </section>
      );
    } else if (degreePickerOpen) {
      const query = degreeSearch.trim().toLowerCase();
      const shown = (degreeList || []).filter((item) => !query || `${item.name} ${item.code} ${item.faculty || ""} ${item.credentials || ""}`.toLowerCase().includes(query));
      const faculties = [...new Set(shown.map((item) => item.faculty || "Other programs"))].sort();
      const typed = degreeSearch.trim();
      main = (
        <section className="mx-page mx-info-page mx-degree-picker">
          <div className="mx-degree-scroll">
          <div className="mx-hero-photo">
            <img src="/campus.svg" alt="" />
            <div><h1>{degree ? "Switch program" : "Pick your program"}</h1><p>One forum with everyone in your program, every semester.</p></div>
          </div>
          <div className="mx-picker-sticky">
            <button type="button" className="mx-sticky-back" aria-label="Back" onClick={() => { setDegreePickerOpen(false); if (!profilePage) setMobileMain(false); }}><ChevronLeft size={22} /></button>
            <label className="mx-search mx-picker-search"><Search size={17} aria-hidden="true" /><input value={degreeSearch} disabled={!degreeList || degreesUnavailable} onChange={(event) => setDegreeSearch(event.target.value)} placeholder="Search programs" />{degreeSearch && <button type="button" aria-label="Clear search" onClick={() => setDegreeSearch("")}><X size={15} /></button>}</label>
          </div>
          <div className="mx-page-scroll">
            {degreeList === null ? <p className="mx-note">Loading programs…</p> : degreesUnavailable ? (
              <div className="mx-card mx-picker-empty"><strong>Programs aren't available yet</strong><span>CCConnect is still setting up degrees. Check back soon.</span></div>
            ) : (
              <>
                
                {faculties.map((faculty) => (
                  <Fragment key={faculty}>
                    <h3 className="mx-label">{faculty}</h3>
                    <ul className="mx-program-list">
                      {shown.filter((item) => (item.faculty || "Other programs") === faculty).map((item) => (
                        <li key={item.id} className={degree?.id === item.id ? "mx-program mine" : "mx-program"}>
                          <span className="mx-row-main"><strong>{item.name}</strong><small>{item.credentials || item.code}</small></span>
                          {degree?.id === item.id ? <span className="mx-pill soft"><Check size={15} />Yours</span> : <button type="button" className="mx-pill dark" onClick={() => chooseDegree(item)}>Join</button>}
                        </li>
                      ))}
                    </ul>
                  </Fragment>
                ))}
                {shown.length === 0 && <div className="mx-card mx-picker-empty"><strong>No program matches "{typed}"</strong><span>Can't find yours? Request it and we'll add it.</span></div>}
                {myDegreeRequests.length > 0 && <p className="mx-note">Requested: {myDegreeRequests.map((item) => item.name).join(", ")}. You can pick it once it's approved.</p>}
                {/* Like Add a course: requesting only appears when the search finds nothing. */}
                {typed && shown.length === 0 ? (
                  <button type="button" className="mx-request-card" onClick={requestDegree}><span><Plus size={18} /></span><span><strong>Request "{typed}"</strong><small>We'll add it to the list</small></span></button>
                ) : !typed ? (
                  <p className="mx-note">Program not listed? Type its name in the search to request it.</p>
                ) : null}
              </>
            )}
          </div>
          </div>
        </section>
      );
    } else if (profilePage && !guest) {
      const back = () => {
        if (profilePage === "edit" && profileEditing) { if (identityBefore.current) setIdentity(identityBefore.current); setProfileEditing(false); }
        // The colour page goes back to Edit Profile (without the unsaved colour).
        if (profilePage === "color") { setIdentity((value) => ({ ...value, avatarColor: colorBefore.current })); setProfilePage("edit"); return; }
        setProfilePage(null); if (!isWide()) setMobileMain(profilePageFromFull.current);
      };
      const titles = { edit: "Your profile", color: "Profile colour", privacy: "Privacy & Safety", account: "Account & Security", legal: "Terms and Services", contact: "Contact CCConnect", moderation: "Moderation" } as const;
      let body: ReactNode = null;
      const currentTone = identity.avatarColor ?? avatarToneOf(savedUsername || identity.displayName || name);
      if (profilePage === "edit") {
        const editing = profileEditing;
        const memberSince = account?.memberSince ? new Date(account.memberSince).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : null;
        body = (
          <form className="mx-me-form mx-profile-card" onSubmit={async (event) => { if (await saveIdentity(event)) setProfileEditing(false); }}>
            {/* Your picture (tap it to change its colour), name and York email; the rest is locked until Edit. */}
            <div className="mx-profile-top">
              <button type="button" className="mx-avatar-edit" aria-label="Change profile colour" onClick={() => { colorBefore.current = identity.avatarColor ?? null; setProfilePage("color"); }}>
                <Avatar name={identity.displayName || name} tone={currentTone} className="avatar-large mx-profile-avatar mx-profile-avatar-xl" />
                <span className="mx-avatar-edit-badge" aria-hidden="true"><Palette size={16} /></span>
              </button>
              {editing ? (
                <label className="mx-profile-field"><span>Display name</span><input className="mx-me-input" aria-label="Display name" autoComplete="nickname" maxLength={32} autoFocus value={identity.displayName} onChange={(event) => setIdentity((current) => ({ ...current, displayName: event.target.value }))} required /><small>The name classmates see in chats.</small></label>
              ) : (
                <>
                  <h1 className="mx-profile-name">{identity.displayName || name}<BadgeCheck size={18} aria-label="Verified York student" /></h1>
                  <p className="mx-profile-email">{account?.email}</p>
                </>
              )}
            </div>
            {editing
              ? <label className="mx-profile-field"><span>Bio <em>optional</em></span><textarea className="mx-me-input" aria-label="Bio" maxLength={160} rows={3} placeholder="A line about you" value={identity.bio} onChange={(event) => setIdentity((current) => ({ ...current, bio: event.target.value }))} /></label>
              : <p className={identity.bio ? "mx-profile-bio" : "mx-profile-bio empty"}>{identity.bio || "No bio yet"}</p>}
            <ul className="mx-profile-facts">
              <li>{editing
                ? <button type="button" className="mx-profile-fact-button" onClick={() => { setDegreePickerOpen(true); loadDegrees(); }}><GraduationCap size={17} /><span>Degree</span><strong>{degree ? degree.name : "Choose"}</strong><ChevronRight size={16} /></button>
                : <><GraduationCap size={17} /><span>Degree</span><strong>{degree ? degree.name : "Not set"}</strong></>}</li>
              <li><House size={17} /><span>University</span><strong>York University</strong></li>
              {memberSince && <li><Clock size={17} /><span>Member since</span><strong>{memberSince}</strong></li>}
            </ul>
            {editing ? (
              <div className="mx-profile-actions">
                <button type="button" className="mx-profile-cancel" onClick={() => { if (identityBefore.current) setIdentity(identityBefore.current); setProfileEditing(false); }}>Cancel</button>
                <button className="mx-profile-save" disabled={!identity.displayName.trim()}>Save</button>
              </div>
            ) : (
              <button type="button" className="mx-profile-edit" onClick={() => { identityBefore.current = identity; setProfileEditing(true); }}>Edit</button>
            )}
          </form>
        );
      } else if (profilePage === "color") {
        // Profile colour: its own page. Save stores it straight away; Back or Cancel leaves the old colour.
        const saveColor = async () => {
          try {
            const data = await request("/api/identity", { method: "PATCH", body: JSON.stringify({ ...identity, displayName: savedUsername || identity.displayName }) }, token);
            setIdentity((value) => ({ ...value, avatarColor: data.profile.avatarColor }));
            if (Number.isInteger(data.profile.avatarColor)) setAvatarColor(data.profile.displayName, data.profile.avatarColor);
            setProfilePage("edit");
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Unable to save your colour.");
          }
        };
        body = (
          <div className="mx-color-page">
            <Avatar name={identity.displayName || name} tone={currentTone} className="avatar-large mx-color-preview" />
            <p className="mx-note">This colour shows behind your initials everywhere on CCConnect.</p>
            <div className="mx-color-picker" role="group" aria-label="Profile colour">
              <ColorPicker tone={currentTone} onChange={(tone) => setIdentity((value) => ({ ...value, avatarColor: tone }))} />
              <div className="mx-color-actions">
                <button type="button" className="mx-color-cancel" onClick={() => { setIdentity((value) => ({ ...value, avatarColor: colorBefore.current })); setProfilePage("edit"); }}>Cancel</button>
                <button type="button" className="mx-color-done" onClick={saveColor}>Save</button>
              </div>
            </div>
          </div>
        );
      } else if (profilePage === "moderation" && isAdmin) {
        // Moderation in the current design: reports to act on, resolved ones, and who's banned right now.
        const views = [["open", `Open${openReportCount ? ` · ${openReportCount}` : ""}`], ["resolved", "Resolved"], ["bans", "Banned"], ["courses", "Courses"], ["messages", "Messages"], ["deleted", "Deleted"], ["stats", "Stats"]] as const;
        body = (<>
          <div className="legal-tabs mx-mod-tabs" role="tablist">
            {views.map(([view, label]) => <button type="button" role="tab" key={view} aria-selected={modView === view} className={modView === view ? "active" : ""} onClick={() => { setModView(view); loadModeration(view).catch((error) => setNotice(error.message)); }}>{label}</button>)}
          </div>
          {modView === "stats" ? (
            !modStats ? <p className="mx-note">Loading…</p> : (() => {
              const most = Math.max(1, ...modStats.signupsByDay.map((day) => day.count));
              return (
                <div className="mx-stats">
                  <div className="mx-stat-grid">
                    <div className="mx-stat"><strong>{modStats.users.total}</strong><span>Students signed up</span><small>{modStats.users.today} today · {modStats.users.last7} this week</small></div>
                    <div className="mx-stat"><strong>{modStats.courses.studentsInACoursePct}%</strong><span>Joined a course</span><small>{modStats.courses.studentsInACourse} students · {modStats.courses.memberships} memberships</small></div>
                    <div className="mx-stat"><strong>{modStats.engagement.pct}%</strong><span>Posted or messaged</span><small>{modStats.engagement.active} students did something</small></div>
                    <div className="mx-stat"><strong>{modStats.notifications.pct}%</strong><span>Notifications on</span><small>{modStats.notifications.optedIn} students reachable</small></div>
                  </div>
                  <h3 className="mx-label">Sign-ups, last 14 days</h3>
                  <div className="mx-card mx-stat-chart" role="img" aria-label="Sign-ups per day">
                    {modStats.signupsByDay.map((day) => <span key={day.day} title={`${day.day}: ${day.count}`}><i style={{ height: `${Math.max(4, (day.count / most) * 100)}%` }} /><b>{day.count || ""}</b><small>{day.day.slice(8)}</small></span>)}
                  </div>
                  <h3 className="mx-label">Courses · {modStats.courses.open} open · avg {modStats.courses.averageMembers} members · {modStats.courses.withTwoPlus} with 2+ · {modStats.courses.withFivePlus} with 5+</h3>
                  {modStats.courses.top.length === 0 ? <p className="mx-note">No courses yet.</p> : (
                    <ul className="mx-card mx-list">{modStats.courses.top.map((course) => <li className="mx-row static" key={course.name}><span className="mx-row-main"><strong>{course.name}</strong></span><em className="mx-stat-count">{course.members}</em></li>)}</ul>
                  )}
                  <h3 className="mx-label">Newest sign-ups</h3>
                  {(modStats.recent || []).length === 0 ? <p className="mx-note">Nobody yet.</p> : (
                    <ul className="mx-card mx-list">{modStats.recent?.map((person) => <li className="mx-row static" key={person.email}><Avatar name={person.name} /><span className="mx-row-main"><strong>{person.name}</strong><small>{person.email} · {person.method}{person.degree ? ` · ${person.degree}` : ""}{person.termsAccepted ? "" : " · hasn't finished sign-up"}</small></span><em className="mx-stat-when">{new Date(person.joined).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</em></li>)}</ul>
                  )}
                  <p className="mx-note">Students only: people who finished sign-up (accepted the Terms). The team's {modStats.teamExcluded} account{modStats.teamExcluded === 1 ? "" : "s"}{modStats.unfinished ? ` and ${modStats.unfinished} unfinished sign-up${modStats.unfinished === 1 ? "" : "s"}` : ""} aren't counted. "Posted or messaged" = sent at least one message, post or comment.</p>
                </div>
              );
            })()
          ) : modView === "messages" ? (
            !modContact ? <p className="mx-note">Loading…</p>
            : modContact.setupRequired ? <p className="mx-note">Contact CCConnect needs migration 050.</p>
            : modContact.messages.length === 0 ? <div className="mx-mod-empty"><span aria-hidden="true"><Mail size={26} /></span><h3>No messages</h3><p>What students send from Profile → Contact CCConnect shows up here.</p></div>
            : (
              <ul className="mx-card mx-list">
                {modContact.messages.map((item) => (
                  <li className="mx-row static mx-contact-item" key={item.id}>
                    <span className="mx-row-main">
                      <strong>{{ bug: "Bug", idea: "Idea", other: "Message" }[item.category]} · {item.name}</strong>
                      <small>{item.email ? `${item.email} · ` : ""}{agoText(item.createdAt)}</small>
                      <p className="mx-contact-body">{item.body}</p>
                      {item.device && <small className="mx-contact-device">{item.device}</small>}
                    </span>
                    <button type="button" className="mx-mod-btn" onClick={() => markContactDone(item.id)}>Done</button>
                  </li>
                ))}
              </ul>
            )
          ) : modView === "courses" ? (
            !modCourseRequests ? <p className="mx-note">Loading…</p>
            : modCourseRequests.length === 0 ? <div className="mx-mod-empty"><span aria-hidden="true"><Hash size={26} /></span><h3>No course requests</h3><p>Courses students ask for show up here to accept or reject.</p></div>
            : (
              <ul className="mx-card mx-list">
                {modCourseRequests.map((item) => (
                  <li className="mx-row static" key={item.id}>
                    <span className="mx-row-badge"><Hash size={17} /></span>
                    <span className="mx-row-main"><strong>{item.instructor ? `${item.courseCode} · Prof. ${item.instructor}` : item.courseCode}</strong><small>{item.requesterCount} student{item.requesterCount === 1 ? "" : "s"} asked · {agoText(item.createdAt)}</small></span>
                    <button type="button" className="mx-mod-btn" onClick={() => reviewCourseRequest(item.id, false)}>Reject</button>
                    <button type="button" className="mx-mod-btn mx-mod-accept" onClick={() => reviewCourseRequest(item.id, true)}>Accept</button>
                  </li>
                ))}
              </ul>
            )
          ) : modView === "deleted" ? (
            !modDeleted ? <p className="mx-note">Loading…</p>
            : modDeleted.setupRequired ? <p className="mx-note">Restoring deleted courses and posts needs migration 040.</p>
            : modDeleted.items.length === 0 ? <div className="mx-mod-empty"><span aria-hidden="true"><Trash2 size={26} /></span><h3>Nothing deleted</h3><p>Courses and posts moderators delete show up here, so they can be restored.</p></div>
            : (
              <ul className="mx-card mx-list">
                {modDeleted.items.map((item) => (
                  <li className="mx-row static" key={item.id}>
                    <span className="mx-row-badge">{item.type === "course" ? <Hash size={17} /> : <Newspaper size={17} />}</span>
                    <span className="mx-row-main"><strong>{item.label}</strong><small>{item.type === "course" ? "Course" : "Post"} · deleted by {item.deletedBy} · {agoText(item.deletedAt)}</small></span>
                    {item.restoredAt ? <em className="mx-restored">Restored</em> : <button type="button" className="mx-mod-btn" onClick={() => restoreDeleted(item.id)}>Restore</button>}
                  </li>
                ))}
              </ul>
            )
          ) : modView === "bans" ? (
            modBans.length === 0 ? <p className="mx-note">Nobody is banned from posting right now.</p> : (
              <ul className="mx-card mx-list">
                {modBans.map((person) => (
                  <li className="mx-row static" key={person.id}>
                    <Avatar name={person.name} />
                    <span className="mx-row-main"><strong>{person.name}</strong><small>Can post again {person.postingBannedUntil ? formatBanDate(person.postingBannedUntil) : "soon"}</small></span>
                    <button type="button" className="mx-mod-btn" onClick={() => person.id && setPostingBan(person.id, 0)}>Lift ban</button>
                  </li>
                ))}
              </ul>
            )
          ) : modReports.length === 0 ? (
            <div className="mx-mod-empty"><span aria-hidden="true"><ShieldCheck size={26} /></span><h3>{modView === "open" ? "All clear" : "Nothing resolved yet"}</h3><p>{modView === "open" ? "No open reports right now." : "Reports you act on show up here."}</p></div>
          ) : (
            <div className="mx-mod-list">
              {modReports.map((report) => {
                const what = ({ post: "Post", comment: "Comment", course_message: "Course message", project_message: "Group message", room_message: "Room message" } as Record<string, string>)[report.targetType] || report.targetType.replace("_", " ");
                const details = report.reason.includes(":") ? report.reason.split(":").slice(1).join(":").trim() : "";
                return (
                  <article className="mx-mod-card" key={report.id}>
                    <header>
                      <span className="mx-mod-kind">{what}</span>
                      <span className="mx-mod-reason">{REPORT_CATEGORIES.find((category) => category.id === report.category)?.label || report.reason}</span>
                      <time dateTime={report.createdAt}>{timeAgo(report.createdAt)}</time>
                    </header>
                    <div className="mx-mod-quote">
                      <Avatar name={report.reported?.name || "Unknown"} />
                      <div><strong>{report.reported?.name || "Unknown user"}</strong><p>{report.evidence.body || "(no text)"}</p>{report.evidence.imageUrl && <img src={report.evidence.imageUrl} alt="Reported photo" />}</div>
                    </div>
                    {details && <p className="mx-mod-details">"{details}"</p>}
                    <p className="mx-mod-meta">Reported by {report.reporter?.name || "someone"}{report.reported?.postingBannedUntil ? ` · ${report.reported.name} is banned until ${formatBanDate(report.reported.postingBannedUntil)}` : ""}{report.status !== "open" ? ` · ${report.status}` : ""}</p>
                    {report.status === "open" && (
                      <footer>
                        <button type="button" className="mx-mod-btn mx-mod-risky" onClick={() => askConfirm({ title: "Remove this content?", message: "It's hidden for everyone and the report is closed.", action: "Remove" }).then((ok) => { if (ok) resolveReport(report, "remove"); })}><Trash2 size={15} />Remove</button>
                        {report.reported?.id && <button type="button" className="mx-mod-btn mx-mod-risky" onClick={() => { setBanReason(""); setBanOther(""); setBanTarget({ person: report.reported as ModPerson, reportId: report.id }); }}><Ban size={15} />Ban 24h</button>}
                        <button type="button" className="mx-mod-btn" onClick={() => resolveReport(report, "reviewed")}><Check size={15} />Reviewed</button>
                        <button type="button" className="mx-mod-btn" onClick={() => resolveReport(report, "dismiss")}><X size={15} />Dismiss</button>
                      </footer>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>);
      } else if (profilePage === "legal") {
        body = (<>
          <div className="legal-tabs" role="tablist">
            {(["terms", "privacy"] as const).map((page) => <button type="button" role="tab" key={page} aria-selected={legalTab === page} className={legalTab === page ? "active" : ""} onClick={() => setLegalTab(page)}>{page === "terms" ? "Terms of Service" : "Privacy Policy"}</button>)}
          </div>
          <LegalDoc key={legalTab} page={legalTab} className="legal-inline" />
        </>);
      } else if (profilePage === "contact") {
        body = contactSent ? (
          <div className="mx-chat-empty mx-contact-sent"><span aria-hidden="true"><Check size={26} /></span><h3>Thanks, the CCConnect team has it</h3><p>We read every message. If we need more details we'll reach you at your York email.</p><button type="button" className="mx-primary" onClick={() => setContactSent(false)}>Send another</button></div>
        ) : (
          <div className="mx-contact">
            <p className="mx-note mx-note-left">Found a bug, have an idea, or anything else? It goes straight to the CCConnect team.</p>
            <div className="mx-contact-kinds" role="radiogroup" aria-label="What's it about?">
              {([["bug", "Bug"], ["idea", "Idea"], ["other", "Other"]] as const).map(([kind, label]) => <button type="button" role="radio" key={kind} aria-checked={contactCategory === kind} className={contactCategory === kind ? "active" : ""} onClick={() => setContactCategory(kind)}>{label}</button>)}
            </div>
            <textarea className="mx-contact-box" rows={7} maxLength={4000} value={contactBody} onChange={(event) => setContactBody(event.target.value)} placeholder={contactCategory === "bug" ? "What happened, and what were you doing when it happened?" : contactCategory === "idea" ? "What would make CCConnect better for you?" : "Write your message"} />
            <button type="button" className="mx-primary mx-contact-send" disabled={!contactBody.trim() || contactSending} onClick={sendContact}>{contactSending ? "Sending…" : "Send"}</button>
          </div>
        );
      } else if (profilePage === "privacy") {
        body = (<>
          <h3 className="mx-label">Blocked people</h3>
          <ul className="mx-card mx-list">{blockedPeople.length === 0 ? <li className="mx-empty">No one. Block someone from their name or message.</li> : blockedPeople.map((person) => <li className="mx-row static" key={person.id}><Avatar name={person.name} seed={person.name} /><span className="mx-row-main"><strong>{person.name}</strong></span><button type="button" className="mx-pill muted" onClick={() => unblock(person)}>Unblock</button></li>)}</ul>
          <p className="mx-note mx-note-left">Blocked people's messages are hidden for you, they can't add you to project rooms, and you get no notifications from them.</p>
          <h3 className="mx-label">Who sees what</h3>
          <div className="mx-card mx-list"><div className="mx-row static"><span className="mx-row-main"><strong>Classmates see your display name and bio</strong><small>Your York email is never shown to anyone.</small></span></div></div>
        </>);
      } else {
        const hasPassword = Boolean(account?.hasPassword);
        const changePassword = async (event: FormEvent) => {
          event.preventDefault();
          if (passwordForm.next !== passwordForm.confirm) { setNotice("The new passwords don't match."); return; }
          try {
            const data = await request("/api/password/change", { method: "POST", body: JSON.stringify({ currentPassword: passwordForm.current, newPassword: passwordForm.next }) }, token);
            setAccount(data.account);
            setPasswordForm({ current: "", next: "", confirm: "" });
          } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to change your password."); }
        };
        body = (<>
          <h3 className="mx-label">Verified email</h3>
          <div className="mx-card mx-list"><div className="mx-row static"><span className="mx-row-badge"><CircleCheck size={18} /></span><span className="mx-row-main"><strong>{account?.email}</strong><small>Private. Only you can see this.</small></span></div></div>
          <h3 className="mx-label">{hasPassword ? "Change password" : "Set a password"}</h3>
          <form className="mx-card mx-me-password" onSubmit={changePassword}>
            {hasPassword && <input type="password" autoComplete="current-password" placeholder="Current password" value={passwordForm.current} onChange={(event) => setPasswordForm((form) => ({ ...form, current: event.target.value }))} required />}
            <input type="password" autoComplete="new-password" placeholder="New password (10+ characters)" minLength={10} maxLength={128} value={passwordForm.next} onChange={(event) => setPasswordForm((form) => ({ ...form, next: event.target.value }))} required />
            <input type="password" autoComplete="new-password" placeholder="Confirm new password" minLength={10} maxLength={128} value={passwordForm.confirm} onChange={(event) => setPasswordForm((form) => ({ ...form, confirm: event.target.value }))} required />
            <button disabled={passwordForm.next.length < 10 || !passwordForm.confirm || (hasPassword && !passwordForm.current)}>{hasPassword ? "Change password" : "Set password"}</button>
          </form>
          {!hasPassword && <p className="mx-note mx-note-left">You sign in with Google. A password lets you sign in with your York email too.</p>}
          <h3 className="mx-label">Danger zone</h3>
          <div className="mx-card mx-list"><button type="button" className="mx-row mx-row-danger" onClick={deleteAccount}><span className="mx-row-main"><strong>Delete account</strong><small>Removes your account for good</small></span></button></div>
          <p className="mx-note"><a href="https://www.ccconnect.app/privacy.html" target="_blank" rel="noreferrer">Privacy</a> · <a href="https://www.ccconnect.app/terms.html" target="_blank" rel="noreferrer">Terms</a></p>
        </>);
      }
      main = <section className="mx-page mx-info-page"><header className="mx-page-header"><button type="button" className="mx-page-back" aria-label="Back" onClick={back}><ChevronLeft size={22} /></button><h2>{titles[profilePage]}</h2></header><div className="mx-page-scroll">{body}</div></section>;
    } else if (inCourse && activeCourseGroup) {
      const group = activeCourseGroup;
      if (courseQrOpen && !isDegreeChat) {
        main = infoPage("QR code", () => setCourseQrOpen(false), (
          <div className="mx-qr"><h1>{courseLabel(group)}</h1><p>{group.memberCount} member{group.memberCount === 1 ? "" : "s"}</p><div className="mx-qr-card"><CourseQr url={courseLink(group.id)} /></div><p className="mx-note">Scan with your phone's camera to join the {group.courseCode} chat on CCConnect.</p><div className="mx-invite-link"><span>{courseLink(group.id).replace("https://", "")}</span><button type="button" onClick={() => shareCourseLink(group)}><Link2 size={16} />{isNativeApp || touchScreen ? "Share" : "Copy"}</button></div><p className="mx-note">Or send the link: anyone with it can open and join this chat.</p></div>
        ));
      } else if (courseInfoOpen) {
        main = infoPage(isDegreeChat ? "Degree info" : "Group info", () => { if (isDegreeChat) closeDegreeInfo(); else setCourseInfoOpen(false); }, (
          <>
            <div className="mx-info-hero"><span className="mx-info-icon" aria-hidden="true">{isDegreeChat ? <GraduationCap size={30} /> : group.courseCode.split(" ")[0].slice(0, 4)}</span><h1>{isDegreeChat ? degree?.name : courseLabel(group)}</h1><p>{isDegreeChat ? `${degree?.credentials || degree?.code} · ` : ""}{group.memberCount} member{group.memberCount === 1 ? "" : "s"}</p>
              {!isDegreeChat && <div className="mx-info-actions"><button type="button" onClick={() => setCourseQrOpen(true)}><QrCode size={17} />QR code</button><button type="button" onClick={() => shareCourseLink(group)}><Link2 size={17} />{isNativeApp || touchScreen ? "Share link" : "Copy link"}</button>{DEGREE_FORUM && degree && <button type="button" onClick={() => shareCourseToDegree(group)}><Share2 size={17} />Share in {degree.code}</button>}</div>}
            </div>
            <h3 className="mx-label">Members · {group.memberCount}</h3>
            <ul className="mx-card mx-list">
              <li className="mx-row static"><Avatar name={name} /><span className="mx-row-main"><strong>{name} (you)</strong></span></li>
              {courseMembers === null && <li className="mx-empty">Loading…</li>}
              {(courseMembers || []).map((member) => <li className="mx-row static" key={member.id}><Avatar name={member.name} seed={member.name} /><span className="mx-row-main"><strong>{member.name}</strong></span></li>)}
            </ul>
            {!isDegreeChat && isAdmin && <>
              <h3 className="mx-label">All groups (moderator) · {modRooms?.length ?? "…"}</h3>
              <ul className="mx-card mx-list">
                {modRooms === null && <li className="mx-empty">Loading…</li>}
                {modRooms?.length === 0 && <li className="mx-empty">No groups in this course.</li>}
                {(modRooms || []).map((room) => <li className="mx-row static" key={room.id}><span className="mx-row-badge">{room.isPublic ? <Users size={16} /> : <Lock size={16} />}</span><span className="mx-row-main"><strong>{room.name}</strong><small>{room.isPublic ? "Public" : "Private"} · {room.memberCount} member{room.memberCount === 1 ? "" : "s"} · by {room.creatorName}</small></span><button type="button" className="mx-row-danger-btn" onClick={() => moderatorDeleteRoom(room)}>Delete</button></li>)}
              </ul>
            </>}
            <div className="mx-card mx-danger">{isDegreeChat ? <button type="button" onClick={() => { setCourseInfoOpen(false); setTab("degree-posts"); setDegreePickerOpen(true); loadDegrees(); }}>Change degree</button> : <button type="button" onClick={() => leaveCourseChat(group)}>Leave course</button>}{!isDegreeChat && isAdmin && <button type="button" onClick={() => deleteCourseChat(group)}>Delete course chat (moderator)</button>}</div>
          </>
        ));
      } else if (COURSE_FORUM && !isDegreeChat) {
        // Course forum: the course's posts (newest first) with threaded comments, the same as the Degree Forum.
        const title = courseLabel(group);
        const forumPosts = courseForum.groupId === group.id ? courseForum.posts : [];
        const words = forumQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const matches = forumPosts.filter((post) => { const text = `${post.body} ${post.author?.displayName || ""}`.toLowerCase(); return words.every((word) => text.includes(word)); });
        const newPost = guest ? null : <button type="button" className="mx-new-post mx-new-post-icon" aria-label="New post" title="New post" onClick={() => { setEditingPost(null); setPostTitle(""); setPostBody(""); setPostImages([]); setPostScope("course"); setTab("create"); setMobileMain(true); }}><Plus size={20} /></button>;
        main = (
          <section className="mx-page mx-course-forum">
            {/* Laid out exactly like the General Forum (owner's call, Nov 1 2026): course name as the title, + on the right,
                the search bar under the header. */}
            <header className="mx-page-header"><button type="button" className="mx-page-back mx-menu-button" aria-label="Back" onClick={shellBack}><ChevronLeft size={22} /></button><h2>{title}</h2>{newPost && <div className="mx-page-actions">{newPost}</div>}</header>
            <div className="mx-forum-search"><label className="mx-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label={`Search ${title} posts`} value={forumQuery} onChange={(event) => setForumQuery(event.target.value)} placeholder={`Search ${group.courseCode} posts`} />{forumQuery && <button type="button" className="mx-search-clear" aria-label="Clear search" onClick={() => setForumQuery("")}><X size={15} /></button>}</label></div>
            <div className="mx-page-scroll mx-feed">
              {forumPosts.length === 0 && !freshForums.current.has(`course:${group.id}`) ? loadingRows("cards") : forumQuery.trim()
                ? renderFeed(matches, <div className="mx-chat-empty"><span aria-hidden="true"><Search size={26} /></span><h3>No matching posts</h3><p>Nothing in {group.courseCode} mentions "{forumQuery.trim()}".</p></div>)
                : renderFeed(forumPosts, <div className="mx-chat-empty"><span aria-hidden="true"><Newspaper size={26} /></span><h3>No posts yet</h3><p>{guest ? `Nobody has posted in ${group.courseCode} yet.` : `Ask ${group.courseCode} about assignments, tests or notes.`}</p></div>)}
            </div>
            {guest && <div className="mx-composer-note">Browsing as a visitor · <button type="button" onClick={() => leaveGuest("auth")}>Sign up to post</button></div>}
          </section>
        );
      } else {
        const toItem = (post: CourseGroupPost) => ({ pending: post.pending, id: post.id, name: post.author?.displayName || "York Student", seed: post.author?.displayName || post.id, mine: post.isMine, createdAt: post.createdAt, body: post.body, image: post.kind === "image" ? post.imageUrl : null, file: post.kind === "attachment" ? post.imageUrl : null, fileName: post.attachmentName, reactions: post.reactions, myReaction: post.myReaction, post, report: { type: "course_message" as const, id: post.id, what: "message", authorName: post.author?.displayName || "York Student", preview: post.body || post.attachmentName || "Image" } });
        const posts = visibleCoursePosts.map(toItem);
        // The chat itself also shows "Name joined" lines, in time order between the messages.
        const timeOf = (item: { createdAt?: string }) => item.createdAt ? new Date(item.createdAt).getTime() : Infinity;
        const joinItems = courseGroupView === "chat" && !isDegreeChat ? (courseJoins[group.id] || []).map((join) => ({ id: join.id, name: join.name, seed: join.id, mine: false, createdAt: join.at, body: "", joined: true })) : [];
        const chatItems = joinItems.length ? [...posts, ...joinItems].sort((a, b) => timeOf(a) - timeOf(b)) : posts;
        // A conversation opened from search that's older than the loaded chat: shown on its own, Back returns.
        const threadItems = searchThread ? searchThread.ids.map((id) => courseGroupPosts.find((post) => post.id === id) || serverSearch?.messages.find((post) => post.id === id)).filter((post): post is CourseGroupPost => Boolean(post)).map(toItem) : null;
        const title = isDegreeChat ? "general" : courseLabel(group);
        const memberNames = courseHome?.id === group.id && courseMembers ? [name, ...courseMembers.map((member) => member.name)] : [name];
        const daysLeft = group.endsOn ? Math.ceil((new Date(`${group.endsOn}T00:00:00`).getTime() - Date.now()) / 86400000) : null;
        const resetDay = group.endsOn ? new Date(`${group.endsOn}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
        const hasDraft = Boolean(coursePostBody.trim() || courseAttachment);
        main = (
          <section className="mx-chat">
            {chatFind !== null ? findHeader(`Search ${isDegreeChat ? "general" : group.courseCode}`) : chatHeader(title, Math.max(group.memberCount, courseGroups.find((item) => item.id === group.id)?.memberCount || 0, memberNames.length), memberNames, guest ? undefined : () => { infoFromBanner.current = false; setCourseInfoOpen(true); if (courseMembers === null || courseHome?.id !== group.id) { setCourseHome(group); loadCourseHome(group.id).catch(() => {}); } })}
            {chatFind === null && daysLeft !== null && daysLeft > 0 && daysLeft <= 7 && <div className="mx-banner mx-banner-warn" role="note"><Clock size={15} aria-hidden="true" /><span>This chat resets after exams on <strong>{resetDay}</strong>. Everyone leaves and next term starts fresh.</span></div>}
            {chatFind === null && courseGroupView === "pinned" && <div className="mx-banner"><Pin size={14} />Pinned messages · <button type="button" onClick={() => setCourseGroupView("chat")}>Back to chat</button></div>}
            {threadItems ? (
              <div className="mx-messages mx-thread-view">
                <div className="mx-banner"><Search size={14} aria-hidden="true" />Conversation from search · <button type="button" onClick={() => setSearchThread(null)}>Back to chat</button></div>
                {messageList(threadItems)}
              </div>
            ) : chatFind !== null ? findResults(posts, isDegreeChat ? "general" : group.courseCode, isDegreeChat ? undefined : group.id) : (
              <div key={`chat-${group.id}`} className={`mx-messages${listEnter(`chat-${group.id}`)}`} onScroll={trackChatScroll}>
                {posts.length === 0 && chatLoading && loadingRows("chat")}
                {messageList(chatItems)}
                {courseGroupView === "chat" && <TypingIndicator typers={courseGroupTypers} />}
              </div>
            )}
            {chatFind !== null ? null : guest ? <div className="mx-composer-note">Browsing as a visitor · <button type="button" onClick={() => leaveGuest("auth")}>Sign up to chat</button></div> : postingBannedUntil ? <div className="mx-composer-note">You can't send messages until {formatBanDate(postingBannedUntil)}.</div> : courseGroupView === "chat" && (
              <form className="mx-composer" onSubmit={(event) => { setEmojiPickerFor(null); publishCoursePost(event); }}>
                {emojiPickerFor === "course" && emojiPicker((emoji) => setCoursePostBody((body) => body + emoji))}
                {findHint(posts, coursePostBody, isDegreeChat ? undefined : group.id)}
                {replyingTo && <div className="mx-replying mx-replying-chat"><ReplyIcon size={14} aria-hidden="true" /><span>Replying to <strong>{replyingTo.author?.displayName || "York Student"}</strong> {replyingTo.body}</span><button type="button" aria-label="Cancel reply" onClick={() => setReplyingTo(null)}><X size={14} /></button></div>}
                <div className="mx-composer-box">
                  <LengthNote text={coursePostBody} />
                  {courseAttachment && <span className="mx-attachment">{courseAttachment.name}<button type="button" aria-label="Remove attachment" onClick={() => setCourseAttachment(null)}><X size={13} /></button></span>}
                  <div className="mx-composer-row">
                    <label className="mx-composer-icon mx-composer-plus" aria-label="Attach a photo or PDF"><Plus size={22} strokeWidth={2.3} /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(event) => { chooseChatAttachment(event.target.files?.[0], setCourseAttachment); event.target.value = ""; }} /></label>
                    <textarea rows={1} placeholder={isDegreeChat ? "Message #general" : `Message ${group.courseCode}`} value={coursePostBody} onFocus={focusComposer} onChange={(event) => { setCoursePostBody(event.target.value); signalCourseTyping(Boolean(event.target.value)); }} onInput={(event) => { const box = event.currentTarget; box.style.height = "0px"; box.style.height = `${Math.min(box.scrollHeight, 140)}px`; }} onKeyDown={sendChatOnEnter} />
                    <button type="button" className={emojiPickerFor === "course" ? "mx-composer-icon active" : "mx-composer-icon"} aria-label="Emoji" aria-expanded={emojiPickerFor === "course"} onClick={() => setEmojiPickerFor((open) => open === "course" ? null : "course")}><Smile size={21} /></button>
                    {hasDraft ? <button className="mx-send" aria-label="Send" disabled={tooLong(coursePostBody)}><Send size={17} /></button> : <label className="mx-composer-icon" aria-label="Attach a photo"><ImageIcon size={21} /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { chooseChatAttachment(event.target.files?.[0], setCourseAttachment); event.target.value = ""; }} /></label>}
                  </div>
                </div>
              </form>
            )}
          </section>
        );
      }
    } else if (inProject && activeProject) {
      const room = activeProject;
      const courseCode = courseGroups.find((group) => group.id === room.courseGroupId)?.courseCode || "Project room";
      if (projectPanelOpen) {
        main = infoPage("Room info", () => setProjectPanelOpen(false), (
          <>
            <div className="mx-info-hero"><span className="mx-info-icon" aria-hidden="true"><FolderKanban size={30} /></span><h1>{room.name}</h1><p>{courseCode} · {room.members.length} member{room.members.length === 1 ? "" : "s"}</p></div>
            {room.isCreator && <><h3 className="mx-label">Name</h3><form className="mx-card mx-rename" onSubmit={renameProject}><input aria-label="Room name" maxLength={60} value={projectRenameDraft} onChange={(event) => setProjectRenameDraft(event.target.value)} /><button disabled={!projectRenameDraft.trim() || projectRenameDraft.trim() === room.name}>Save</button></form></>}
            <h3 className="mx-label">Members · {room.members.length}</h3>
            <ul className="mx-card mx-list">
              {room.isCreator && !room.isPublic && <li><button type="button" className="mx-row accent" onClick={() => openProjectPicker("invite", courseGroups.find((group) => group.id === room.courseGroupId) || courseHome)}><span className="mx-row-plus"><Plus size={18} /></span><span className="mx-row-main"><strong>Invite classmates</strong></span></button></li>}
              {[...room.members].sort((a, b) => Number(b.isCreator) - Number(a.isCreator)).map((member) => <li className="mx-row static" key={member.id}><Avatar name={member.name} seed={member.name} /><span className="mx-row-main"><strong>{member.name}{member.id === account?.id ? " (you)" : ""}</strong></span>{member.isCreator ? <em>Creator</em> : room.isCreator && <button type="button" className="mx-text-danger" onClick={() => { askConfirm({ title: `Remove ${member.name}?`, message: `They'll be taken out of ${room.name}.`, action: "Remove" }).then((ok) => { if (ok) removeProjectMember(member.id); }); }}>Remove</button>}</li>)}
            </ul>
            {room.isCreator && (room.joinRequests?.length || 0) > 0 && <><h3 className="mx-label">Asking to join · {room.joinRequests?.length}</h3><ul className="mx-card mx-list">{room.joinRequests?.map((person) => <li className="mx-row static" key={person.id}><Avatar name={person.name} seed={person.name} /><span className="mx-row-main"><strong>{person.name}</strong></span><span className="mx-request-actions"><button type="button" className="mx-request-approve" onClick={() => answerJoinRequest(room.id, person.id, person.name, true)}>Approve</button><button type="button" className="mx-request-decline" onClick={() => answerJoinRequest(room.id, person.id, person.name, false)}>Decline</button></span></li>)}</ul></>}
            {(room.pendingInvites?.length || 0) > 0 && <><h3 className="mx-label">Invited · waiting to accept</h3><ul className="mx-card mx-list">{room.pendingInvites?.map((invite) => <li className="mx-row static" key={invite.id}><Avatar name={invite.name} seed={invite.name} /><span className="mx-row-main"><strong className="muted">{invite.name}</strong></span>{room.isCreator ? <button type="button" className="mx-text-danger" onClick={() => cancelInvite(invite)}>Cancel</button> : <em>Invited</em>}</li>)}</ul></>}
            <div className="mx-card mx-danger">{canDeleteGroup(room) ? <button type="button" onClick={deleteProject}>Delete room</button> : <button type="button" onClick={() => { if (account) askConfirm({ title: `Leave ${room.name}?`, message: room.isPublic ? "You can join again from Discover." : "You'll need a new invite to come back.", action: "Leave group" }).then((ok) => { if (ok) removeProjectMember(account.id); }); }}>Leave room</button>}</div>
            <p className="mx-note">Only members can see this room. Invited classmates join when they accept. It closes after 30 days without messages.</p>
          </>
        ));
      } else {
        const messages = projectMessages.map((message) => ({ pending: message.pending, project: message, id: message.id, name: message.author.displayName || "York Student", seed: message.authorAccountId, mine: message.mine, createdAt: message.createdAt, body: message.body, image: message.attachmentUrl && message.isImage ? message.attachmentUrl : null, file: message.attachmentUrl && !message.isImage ? message.attachmentUrl : null, fileName: message.attachmentName, report: { type: "project_message" as const, id: message.id, what: "message", authorName: message.author.displayName || "York Student", preview: message.body } }));
        const hasDraft = Boolean(projectDraft.trim() || projectAttachment);
        main = (
          <section className="mx-chat">
            {chatFind !== null ? findHeader(`Search ${room.name}`) : chatHeader(room.name, room.members.length, room.members.map((member) => member.name), () => { setProjectPanelOpen(true); setProjectRenameDraft(room.name); }, true)}
            {chatFind !== null ? findResults(messages, room.name) : (
              <div key={`room-${room.id}`} className={`mx-messages${listEnter(`room-${room.id}`)}`} onScroll={trackChatScroll}>
                {projectMessages.length === 0 && chatLoading && loadingRows("chat")}
                {/* Only once the group is close to closing (it was always shown, which read as a scary permanent warning). */}
                {projectStatus(room).warn && <div className="mx-banner mx-banner-warn mx-inline-warn" role="note"><TriangleAlert size={15} aria-hidden="true" /><span>{projectStatus(room).text}. Send a message to keep it open.</span></div>}
                {projectMessages.length === 0 && !chatLoading && <div className="mx-chat-empty"><span aria-hidden="true"><FolderKanban size={26} /></span><h3>{`Welcome to ${room.name}`}</h3><p>{room.isPublic ? "Anyone in this course can join this group. Say hi and get the project started." : "Only members can see this group. Say hi and get the project started."}</p></div>}
                {messageList(messages)}
                <TypingIndicator typers={projectTypers} />
              </div>
            )}
            {chatFind !== null ? null : postingBannedUntil ? <div className="mx-composer-note">You can't send messages until {formatBanDate(postingBannedUntil)}.</div> : (
              <form className="mx-composer" onSubmit={(event) => { setEmojiPickerFor(null); sendProjectMessage(event); }}>
                {emojiPickerFor === "project" && emojiPicker((emoji) => setProjectDraft((draft) => draft + emoji))}
                {findHint(messages, projectDraft)}
                <div className="mx-composer-box">
                  <LengthNote text={projectDraft} />
                  {projectAttachment && <span className="mx-attachment">{projectAttachment.name}<button type="button" aria-label="Remove attachment" onClick={() => setProjectAttachment(null)}><X size={13} /></button></span>}
                  <div className="mx-composer-row">
                    <label className="mx-composer-icon mx-composer-plus" aria-label="Attach a photo or PDF"><Plus size={22} strokeWidth={2.3} /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(event) => { chooseChatAttachment(event.target.files?.[0], setProjectAttachment); event.target.value = ""; }} /></label>
                    <textarea rows={1} placeholder={`Message ${room.name}`} value={projectDraft} onFocus={focusComposer} onChange={(event) => { setProjectDraft(event.target.value); signalProjectTyping(Boolean(event.target.value)); }} onInput={(event) => { const box = event.currentTarget; box.style.height = "0px"; box.style.height = `${Math.min(box.scrollHeight, 140)}px`; }} onKeyDown={sendChatOnEnter} />
                    <button type="button" className={emojiPickerFor === "project" ? "mx-composer-icon active" : "mx-composer-icon"} aria-label="Emoji" aria-expanded={emojiPickerFor === "project"} onClick={() => setEmojiPickerFor((open) => open === "project" ? null : "project")}><Smile size={21} /></button>
                    {hasDraft ? <button className="mx-send" aria-label="Send" disabled={tooLong(projectDraft)}><Send size={17} /></button> : <label className="mx-composer-icon" aria-label="Attach a photo"><ImageIcon size={21} /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { chooseChatAttachment(event.target.files?.[0], setProjectAttachment); event.target.value = ""; }} /></label>}
                  </div>
                </div>
              </form>
            )}
          </section>
        );
      }
    } else if (tab === "browse-courses" && creatingCourse) {
      // Create a course: its own page, with live "already on CCConnect" matches so nobody makes a duplicate.
      const typedCode = createCode.trim().toUpperCase().replace(/\s+/g, " ");
      // York codes: 2-6 letters and 4 digits plus an optional letter, space optional ("ADMS1000", "EN 1001", "ARTH 3680M"); saved with the space.
      const pretty = typedCode.replace(/^([A-Z]{2,6}) ?(\d{4}[A-Z]?)$/, "$1 $2");
      const squash = (value: string) => value.toUpperCase().replace(/\s+/g, "");
      const needle = squash(typedCode);
      const codeValid = /^[A-Z]{2,6} [0-9]{4}[A-Z]?$/.test(pretty);
      const liveMatches = needle.length >= 2 ? courseGroups.filter((group) => squash(group.courseCode).includes(needle)) : [];
      const requestMatches = needle.length >= 2 ? pendingRequests.filter((item) => squash(item.courseCode).includes(needle)) : [];
      // Just the course code: no professor or semester (owner's call). If it already exists, join it instead.
      const exact = codeValid ? courseGroups.filter((group) => squash(group.courseCode) === squash(pretty)) : [];
      const warning = exact.length ? `${pretty} already has a chat. Join it below instead.` : typedCode && !codeValid && typedCode.replace(/\s/g, "").length >= 8 ? "Use a York course code, like ADMS 1000, EN 1001 or ARTH 3680M." : "";
      const canCreate = codeValid && !warning && createChecked;
      const createCourse = async () => {
        try {
          const data = await request("/api/course-requests", { method: "POST", body: JSON.stringify({ courseCode: pretty }) }, token);
          await loadApp();
          setCreatingCourse(false);
          setCreateCode(""); setCreateChecked(false);
          if (data.joined) shellOpenCourse({ id: data.joined.id, courseCode: data.joined.courseCode, instructor: data.joined.instructor, termName: data.joined.termName, memberCount: 0, joined: true });
          else setCourseQuery(pretty); // back on Add a course, showing it as Requested
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Unable to request that course.");
        }
      };
      main = (
        <section className="mx-page">
          <header className="mx-page-header"><button type="button" className="mx-page-back" aria-label="Back to add a course" onClick={() => setCreatingCourse(false)}><ChevronLeft size={22} /></button><h2>Request a course</h2></header>
          <div className="mx-page-scroll mx-create">
            <h1>Request a course</h1>
            <p className="mx-page-lead">CCConnect checks every request and adds the course if it's real. You'll get an alert either way.</p>
            <div className="mx-create-fields">
              <label>Course code<input className="mx-create-code" autoFocus autoComplete="off" maxLength={9} value={createCode} onChange={(event) => setCreateCode(event.target.value.toUpperCase())} placeholder="ADMS 2510" /></label>
            </div>
            <label className="mx-check mx-check-card"><input type="checkbox" checked={createChecked} onChange={(event) => setCreateChecked(event.target.checked)} /><span>There's no course for {codeValid ? pretty : "this code"} on CCConnect yet.</span></label>
            <button type="button" className="mx-primary mx-create-button" disabled={!canCreate} onClick={createCourse}>{codeValid ? `Request ${pretty}` : "Request course"}</button>
            {warning && <p className="mx-warn-box">{warning}</p>}
            {liveMatches.length + requestMatches.length > 0 ? (
              <>
                <h3 className="mx-label mx-label-warn"><TriangleAlert size={14} aria-hidden="true" />Already on CCConnect · {liveMatches.length + requestMatches.length}</h3>
                <ul className="mx-card mx-list mx-match-list">
                  {liveMatches.slice(0, 6).map((group) => (
                    <li key={group.id}><button type="button" className="mx-row" onClick={() => { setCreatingCourse(false); shellOpenCourse(group); }}><span className="mx-row-main"><strong>{courseLabel(group)}</strong><small>{group.memberCount} member{group.memberCount === 1 ? "" : "s"}{group.joined ? " · you're in" : ""}</small></span><span className={group.joined ? "mx-pill muted" : "mx-pill dark"}>{group.joined ? "Open" : "Join"}</span></button></li>
                  ))}
                  {requestMatches.slice(0, 4).map((item) => (
                    <li key={item.id} className="mx-row static"><span className="mx-row-main"><strong>{courseLabel(item)}</strong><small>Requested by {item.requesterCount} · waiting for CCConnect to add it</small></span>{item.requestedByMe ? <span className="mx-pill muted">Requested</span> : <button type="button" className="mx-pill dark" onClick={() => joinRequestedCourse(item)}>Request too</button>}</li>
                  ))}
                </ul>
              </>
            ) : codeValid ? <p className="mx-ok-box"><Check size={16} aria-hidden="true" />No course like {pretty} on CCConnect yet</p> : null}
          </div>
        </section>
      );
    } else if (tab === "browse-courses") {
      const query = courseQuery.trim().toUpperCase();
      const squash = (value: string) => value.toUpperCase().replace(/\s+/g, "");
      const offerings = [...courseGroups].filter((group) => !query || squash(group.courseCode).includes(squash(query)) || (group.instructor || "").toUpperCase().includes(query)).sort((a, b) => b.memberCount - a.memberCount);
      const requested = pendingRequests.filter((item) => !query || squash(item.courseCode).includes(squash(query)));
      // Every York course is listed: ones without a chat yet show "Join" too, and joining starts the chat.
      const { titleOf } = courseSearch;
      // No search: the whole list A-Z under the courses that already have a chat. Rows render 60 at a time as you scroll.
      const { allCatalog } = courseSearch;
      const catalogMatches = allCatalog.slice(0, catalogLimit);
      const nothingFound = Boolean(query) && offerings.length === 0 && requested.length === 0 && catalogMatches.length === 0;
      const catalogRows = catalogMatches.map(([code, title]) => (
        <li key={code}><button type="button" className="mx-row" onClick={() => startCatalogCourse(code)}><span className="mx-row-main"><strong>{code}</strong><small>{title} · not on CCConnect yet</small></span><span className="mx-pill dark">Request</span></button></li>
      ));
      const startCatalogCourse = async (code: string) => {
        if (membersOnly("request courses")) return;
        try {
          // Courses aren't made straight away any more: this asks a moderator (the row turns into "Requested").
          const data = await request("/api/course-requests", { method: "POST", body: JSON.stringify({ courseCode: code }) }, token);
          await loadApp();
          if (data.joined) shellOpenCourse({ id: data.joined.id, courseCode: data.joined.courseCode, instructor: data.joined.instructor, termName: data.joined.termName, memberCount: 0, joined: true });
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Unable to request that course.");
        }
      };
      main = (
        <section className="mx-page">
          <header className="mx-page-header"><button type="button" className="mx-page-back" aria-label="Back" onClick={shellBack}><ChevronLeft size={22} /></button><h2>Add a course</h2></header>
          <div className="mx-page-scroll" onScroll={(event) => { const box = event.currentTarget; if (catalogMatches.length < allCatalog.length && box.scrollTop + box.clientHeight > box.scrollHeight - 600) setCatalogLimit((limit) => limit + 60); }}>
            <label className="mx-search mx-big-search"><Search size={18} aria-hidden="true" /><input autoFocus value={courseQuery} onChange={(event) => { setCourseQuery(event.target.value.toUpperCase()); setCatalogLimit(60); }} placeholder="Course code, title or professor" /></label>
            <p className="mx-page-lead">Join the existing course so your whole class ends up in one chat.</p>
            <h3 className="mx-label">{query ? `${(offerings.length + requested.length + allCatalog.length).toLocaleString()} matching ${query}` : "Courses with a chat"}</h3>
            {nothingFound ? (
              <div className="mx-card mx-picker-empty"><strong>No “{query}” at York</strong><span>Check the code. If it's a new course that isn't listed yet, you can request it.</span>
                {/* Right here (not pinned to the bottom, where the phone keyboard covered it). */}
                {!guest && <button type="button" className="mx-empty-create" onClick={() => { setCreateCode(query); setCreateChecked(false); setCreatingCourse(true); }}><Plus size={17} />{/^[A-Z]{2,6} ?\d{4}[A-Z]?$/.test(query.trim()) ? `Request ${query.trim().replace(/^([A-Z]{2,6}) ?(\d{4}[A-Z]?)$/, "$1 $2")}` : "Request a course"}</button>}</div>
            ) : (
              <ul className="mx-card mx-list">
                {offerings.slice(0, 60).map((group) => (
                  <li key={group.id}><button type="button" className="mx-row" onClick={() => shellOpenCourse(group)}><span className="mx-row-main"><strong>{courseLabel(group)}</strong><small>{titleOf.get(group.courseCode) ? `${titleOf.get(group.courseCode)} · ` : ""}{group.memberCount} member{group.memberCount === 1 ? "" : "s"}{group.joined ? " · you're in" : ""}</small></span><span className={group.joined ? "mx-pill muted" : "mx-pill dark"}>{group.joined ? "Open" : guest ? "View" : "Join"}</span></button></li>
                ))}
                {requested.map((item) => (
                  <li key={item.id} className="mx-row static"><span className="mx-row-main"><strong className="muted">{courseLabel(item)}</strong><small>{titleOf.get(item.courseCode) ? `${titleOf.get(item.courseCode)} · ` : ""}Requested by {item.requesterCount} · waiting for CCConnect to add it</small></span>{item.requestedByMe ? <span className="mx-pill outline">Requested</span> : <button type="button" className="mx-pill dark" onClick={() => { if (membersOnly("request courses")) return; joinRequestedCourse(item); }}>Request too</button>}</li>
                ))}
                {query && catalogRows}
                {offerings.length === 0 && requested.length === 0 && (query ? catalogMatches.length === 0 : true) && <li className="mx-empty">{query ? "No courses yet. Search for yours." : "No course chats yet. Pick yours below."}</li>}
              </ul>
            )}
            {!query && allCatalog.length > 0 && <><h3 className="mx-label">All York courses · {allCatalog.length.toLocaleString()}</h3><ul className="mx-card mx-list">{catalogRows}</ul></>}
          </div>
        </section>
      );
    } else if (tab === "alerts") {
      main = (
        <section className="mx-page">
          <header className="mx-page-header"><button type="button" className="mx-page-back mx-menu-button" aria-label="Open menu" onClick={shellBack}><Menu size={22} /></button><h2>Notifications</h2></header>
          <div className="mx-page-scroll mx-alerts">{notifications.length === 0 ? <div className="mx-chat-empty"><span aria-hidden="true"><Bell size={24} /></span><h3>You're all caught up</h3><p>Project room invites and replies show up here.</p></div> : renderNotificationList(notifications)}</div>
        </section>
      );
    } else if (tab === "app-info") {
      main = <section className="mx-page"><header className="mx-page-header"><button type="button" className="mx-page-back mx-menu-button" aria-label="Open menu" onClick={shellBack}><Menu size={22} /></button><h2>CCConnect App</h2></header><div className="mx-page-scroll mx-app-page">{appStatusBody}</div></section>;
    } else if (tab === "profile") {
      main = <section className="mx-page"><header className="mx-page-header"><button type="button" className="mx-page-back mx-menu-button" aria-label="Open menu" onClick={shellBack}><Menu size={22} /></button><h2>My Profile</h2></header><div className="mx-page-scroll">{profileBody}</div></section>;
    } else if (tab === "create" && (editingPost || canPostDev || (postScope === "degree" && degree && !guest) || (postScope === "course" && activeCourseGroup && !guest) || (postScope === "general" && !guest))) {
      const toDegree = postScope === "degree";
      const toCourse = postScope === "course";
      const courseKind = toCourse ? editingPost?.courseChannel : null;
      const degreePost = editingPost ? Boolean(editingPost.degreeId || editingPost.courseGroupId) || !DEV_POSTS_ENABLED : toDegree || toCourse || postScope === "general";
      const words = countWords(postBody);
      main = (
        <section className="mx-page">
          <form className="mx-compose" onSubmit={publishPost}>
            <header className="mx-page-header mx-compose-head"><button type="button" className="mx-compose-cancel" onClick={() => { if (backToSharedNote()) return; setEditingPost(null); setTab(postScope === "general" ? "general-forum" : toCourse ? "course-group" : toDegree ? "degree-posts" : "social"); }}>Cancel</button><h2>{editingPost ? "Edit post" : courseKind === "announcements" ? "New announcement" : courseKind === "questions" ? "Ask a question" : "New post"}</h2><button className="mx-compose-send" disabled={postSending || !postTitle.trim() || (degreePost && countWords(postBody) > DEGREE_POST_MAX_WORDS)}>{postSending ? (editingPost ? "Saving…" : "Posting…") : editingPost ? "Save" : "Post"}</button></header>
            <div className="mx-page-scroll">
              {/* No flair chips for now (owner's call, Oct 2026); posts go out without a flair. */}
              <textarea className="mx-compose-title" rows={1} aria-label="Title" maxLength={120} placeholder="Title" value={postTitle} ref={growBox} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} onChange={(event) => { setPostTitle(event.target.value.replace(/\s*\n\s*/g, " ")); growBox(event.currentTarget); }} />
              {/* How much of the 120-character title is used (owner's call, Nov 1 2026); orange in the last 10. */}
              <div className={postTitle.length >= 110 ? "mx-title-count near" : "mx-title-count"} aria-live="polite">{postTitle.length}/120</div>
              {/* Description: optional, folded under the title until tapped open. */}
              <button type="button" className={descOpen ? "mx-desc-toggle open" : "mx-desc-toggle"} aria-expanded={descOpen} onClick={() => { const opening = !descOpen; setDescOpen(opening); if (opening) window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".mx-compose-body")?.focus(), 60); }}><ChevronRight size={18} aria-hidden="true" /><span>Add description <small>(Optional)</small></span></button>
              {/* Slides open and closed (grid rows 0fr <-> 1fr in shell.css); folded away it can't be focused. */}
              <div className={descOpen ? "mx-desc-collapse open" : "mx-desc-collapse"} inert={!descOpen}><div>
                <textarea className="mx-compose-body" aria-label="Description" rows={6} ref={growBox} placeholder={courseKind === "announcements" ? "What's the news? Include where you heard it (prof, eClass, syllabus)." : courseKind === "questions" ? "What do you want to know? Add details so classmates can help." : toDegree ? `Ask everyone in ${degree?.name || "your program"}: courses, profs, schedules…` : postScope === "general" ? "Ask anyone at York: profs, courses, campus, anything…" : toCourse && activeCourseGroup ? `Ask everyone in ${activeCourseGroup.courseCode}: assignments, tests, notes…` : "What do students need to know?"} value={postBody} onChange={(event) => { setPostBody(event.target.value); growBox(event.currentTarget); }} />
                {degreePost && <p className={words > DEGREE_POST_MAX_WORDS ? "mx-word-count over" : "mx-word-count"}>{words > DEGREE_POST_MAX_WORDS ? `${(words - DEGREE_POST_MAX_WORDS).toLocaleString()} word${words - DEGREE_POST_MAX_WORDS === 1 ? "" : "s"} over the ${DEGREE_POST_MAX_WORDS.toLocaleString()}-word limit` : `${words.toLocaleString()} / ${DEGREE_POST_MAX_WORDS.toLocaleString()} words`}</p>}
              </div></div>
              {postImages.length > 0 && <div className="mx-compose-images">{postImages.map((image, index) => <span key={index}><img src={image.src} alt="" /><button type="button" aria-label="Remove image" onClick={() => setPostImages((current) => current.filter((_, at) => at !== index))}><X size={13} /></button></span>)}</div>}
              <label className="mx-compose-add"><ImagePlus size={18} />Add photos ({postImages.length}/{MAX_POST_IMAGES})<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => { choosePostImages(event.target.files); event.target.value = ""; }} /></label>
            </div>
          </form>
        </section>
      );
    } else if (tab === "post" && commentPost) {
      const post = commentPost;
      const isAnnouncement = post.courseChannel === "announcements";
      const isCoursePost = Boolean(post.courseGroupId);
      const [title, ...rest] = post.body.split("\n\n");
      main = (
        <section className="mx-page">
          <header className="mx-page-header"><button type="button" className="mx-page-back" aria-label={post.courseGroupId ? "Back to course" : post.degreeId ? "Back to forum" : "Back to Dev Posts"} onClick={() => postBack(post)}><ChevronLeft size={22} /></button><h2>{post.courseChannel === "announcements" ? "Announcement" : post.courseChannel === "questions" && !COURSE_FORUM ? "Question" : "Post"}</h2>{post.isMine ? <div className="mx-page-actions">{!isCoursePost && <button type="button" onClick={() => editPost(post)}>Edit</button>}<button type="button" className="danger-text" onClick={() => askDeletePost(post)}>Delete</button></div> : guest ? <div className="mx-page-actions"><button type="button" onClick={() => openReport({ type: "post", id: post.id, what: "post", authorName: post.author.displayName || "York Student", preview: title })}>Report</button></div> : <div className="mx-page-actions">{isAdmin ? <><button type="button" onClick={() => startBan({ type: "post", id: post.id, what: "post", authorName: post.author.displayName || "York Student", preview: title })}>Ban</button><button type="button" className="danger-text" onClick={() => askDeletePost(post)}>Delete</button></> : <><button type="button" onClick={() => openReport({ type: "post", id: post.id, what: "post", authorName: post.author.displayName || "York Student", preview: title })}>Report</button><button type="button" className="danger-text" onClick={() => blockAuthor({ type: "post", id: post.id, what: "post", authorName: post.author.displayName || "York Student", preview: title })}>Block</button></>}</div>}</header>
          <div className="mx-page-scroll mx-post-page">
            <div className="mx-post-meta"><Avatar name={post.author.displayName || "CCConnect"} seed={post.author.displayName || post.id} /><strong>{post.author.displayName || "CCConnect"}</strong>{post.author.displayName === TEAM_NAME && <TeamBadge />}<span aria-hidden="true">·</span><time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>{post.flair && <em className="mx-flair">{flairLabel(post.flair)}</em>}</div>
            <h1>{title}</h1>
            {/* Photos first, the description under them (owner's call, Nov 2 2026). */}
            {(post.imageUrls?.length || 0) > 0 && <ImageCarousel images={post.imageUrls || []} className="mx-post-images" />}
            {rest.length > 0 && <p className="mx-post-body"><LinkedText text={rest.join("\n\n")} /></p>}
            {renderCourseCards(rest.join("\n\n"))}
          </div>
          {/* Long posts read on their own (owner's call, Oct 28 2026): no comments under the post. Bottom right: Share
              above the comment button, which opens the comments full screen. */}
          {!isAnnouncement && (
            <div className="mx-post-fab">
              <button type="button" className="mx-fab-share" aria-label="Share post" onClick={() => sharePost(post)}><Share2 size={20} /></button>
              <button type="button" className="mx-fab-comments" aria-label="Open comments" onClick={() => openCommentsSheet(post, true)}><MessageCircle size={24} /></button>
            </div>
          )}
        </section>
      );
    } else if (tab === "note" && activeNote) {
      // A note: a chat with yourself (KakaoTalk-style). Your entries on the right, newest at the bottom; + photo,
      // text, send. Press and hold (or right-click) an entry for Post about this / Copy / Delete.
      const entryItems = noteEntryMenu ? (<>
        <button type="button" onClick={() => { const { entry } = noteEntryMenu; setNoteEntryMenu(null); postAboutEntry(note, entry); }}><Newspaper size={18} />Post about this</button>
        {noteEntryMenu.entry.body && <button type="button" onClick={() => { const { entry } = noteEntryMenu; setNoteEntryMenu(null); navigator.clipboard?.writeText(entry.body).catch(() => {}); }}><Copy size={18} />Copy</button>}
        <button type="button" className="mx-chat-menu-danger" onClick={() => { const { entry } = noteEntryMenu; setNoteEntryMenu(null); deleteNoteEntry(entry); }}><Trash2 size={18} />Delete</button>
      </>) : null;
      const note = activeNote;
      const holdEntry = (entry: NoteEntry) => ({
        onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); setNoteEntryMenu({ entry, x: event.clientX, y: event.clientY, sheet: false }); },
        onTouchStart: () => { if (noteHold.current) window.clearTimeout(noteHold.current); noteHold.current = window.setTimeout(() => { noteHold.current = null; navigator.vibrate?.(10); setNoteEntryMenu({ entry, x: 0, y: 0, sheet: true }); }, 550); },
        onTouchMove: () => { if (noteHold.current) window.clearTimeout(noteHold.current); noteHold.current = null; },
        onTouchEnd: () => { if (noteHold.current) window.clearTimeout(noteHold.current); noteHold.current = null; },
      });
      main = (
        <section className={noteSelecting ? "mx-page mx-note-page selecting" : "mx-page mx-note-page"}>
          <header className="mx-chat-header mx-note-head">
            <button type="button" className="mx-back" aria-label="Back" onClick={shellBack}><ChevronLeft size={24} /></button>
            <div className="mx-chat-actions">
              <button type="button" className={noteSelecting ? "mx-note-share active" : "mx-note-share"} aria-label="Choose a message to post" aria-pressed={noteSelecting} title="Choose a message to post" disabled={!noteEntries?.length} onClick={() => setNoteSelecting((on) => !on)}><ShareIcon size={19} /></button>
              <button type="button" aria-label="Delete note" title="Delete note" onClick={() => deleteNote(note)}><Trash2 size={19} /></button>
            </div>
          </header>
          {!noteReady && <div className="mx-note-loading" role="status" aria-label="Loading"><span /></div>}
          <div className={noteReady ? "mx-note-list ready" : "mx-note-list waiting"} ref={noteListRef}>
            {noteEntries === null ? null : noteEntries.map((entry, index) => {
              const previous = noteEntries[index - 1];
              const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(entry.createdAt).toDateString();
              return (
                <Fragment key={entry.id}>
                  {newDay && <div className="mx-day"><span>{chatDayLabel(entry.createdAt)}</span></div>}
                  <div className={entry.pending ? "mx-note-entry pending" : "mx-note-entry"} {...(noteSelecting ? { onClickCapture: (event: React.MouseEvent) => { event.stopPropagation(); event.preventDefault(); setNoteSelecting(false); postAboutEntry(note, entry); } } : holdEntry(entry))}>
                    <time dateTime={entry.createdAt}>{chatTime(entry.createdAt)}</time>
                    <div className="mx-note-bubble">
                      {entry.imageUrl && (entry.imageUrl.startsWith(DEVICE_PHOTO)
                        ? <DevicePhoto id={entry.imageUrl.slice(DEVICE_PHOTO.length)} onOpen={setNoteViewer} onLoad={() => { if (index === noteEntries.length - 1) scrollNoteToEnd(); }} />
                        : <img src={uploadedNotePhotos.get(entry.imageUrl) || entry.imageUrl} alt="" onClick={() => setNoteViewer(entry.imageUrl)} onLoad={() => { if (index === noteEntries.length - 1) scrollNoteToEnd(); }} />)}
                      {entry.body && <p><LinkedText text={entry.body} /></p>}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
          {noteSelecting ? <div className="mx-note-select-bar"><span>Tap a message to post it</span><button type="button" onClick={() => setNoteSelecting(false)}>Cancel</button></div> : (
          <form className="mx-composer mx-note-composer" onSubmit={(event) => { event.preventDefault(); sendNoteEntry(); }}>
            {noteImage && <div className="mx-note-attach"><img src={noteImage} alt="" /><button type="button" aria-label="Remove photo" onClick={() => setNoteImage(null)}><X size={14} /></button></div>}
            <div className="mx-note-row-input">
<div className="mx-note-photo-wrap">
                <button type="button" className={notePhotoMenu ? "mx-note-photo open" : "mx-note-photo"} aria-label="Add a photo" aria-expanded={notePhotoMenu} onClick={() => setNotePhotoMenu((open) => !open)}><ImagePlus size={21} /></button>
                {notePhotoMenu && <>
                  <div className="mx-note-photo-backdrop" onClick={() => setNotePhotoMenu(false)} />
                  <div className="mx-note-photo-menu" role="menu">
                    {(["camera", "gallery"] as const).map((source) => {
                      const label = source === "camera" ? "Camera" : "Gallery";
                      const icon = source === "camera" ? <Camera size={19} /> : <ImageIcon size={19} />;
                      const take = (file?: File) => { setNotePhotoMenu(false); if (file) shrinkImage(file).then(setNoteImage).catch(() => setNotice("That photo couldn't be added.")); };
                      return isNativeApp
                        ? <button key={source} type="button" role="menuitem" onClick={() => { setNotePhotoMenu(false); PhotoPicker.pick({ source }).then((result) => { if (result.dataUrl) setNoteImage(result.dataUrl); }).catch(() => setNotice("That photo couldn't be added.")); }}>{icon}<span>{label}</span></button>
                        : <label key={source} role="menuitem">{icon}<span>{label}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" {...(source === "camera" ? { capture: "environment" as const } : {})} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; take(file); }} /></label>;
                    })}
                  </div>
                </>}
              </div>
              <textarea rows={1} placeholder="Write a note" value={noteDraft} onChange={(event) => { setNoteDraft(event.target.value); const box = event.currentTarget; box.style.height = "0px"; box.style.height = `${Math.min(box.scrollHeight + box.offsetHeight - box.clientHeight, 140)}px`; }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && isWide()) { event.preventDefault(); sendNoteEntry(); } }} />
              <button type="submit" className="mx-note-send" aria-label="Send" disabled={!noteDraft.trim() && !noteImage}><Send size={19} /></button>
            </div>
          </form>
          )}
          {noteEntryMenu && createPortal(noteEntryMenu.sheet ? (
            <div className="block-backdrop" onClick={() => setNoteEntryMenu(null)}>
              <section className="block-sheet mx-chat-sheet" role="menu" aria-label="Note" onClick={(event) => event.stopPropagation()}>
                <span className="block-grabber" aria-hidden="true" />
                <div className="mx-chat-sheet-items">{entryItems}</div>
                <button type="button" className="block-cancel" onClick={() => setNoteEntryMenu(null)}>Cancel</button>
              </section>
            </div>
          ) : (
            <div className="mx-chat-menu-layer" onClick={() => setNoteEntryMenu(null)} onContextMenu={(event) => { event.preventDefault(); setNoteEntryMenu(null); }}>
              <div className="mx-chat-menu" role="menu" aria-label="Note" style={{ left: Math.min(noteEntryMenu.x, window.innerWidth - 236), top: Math.min(noteEntryMenu.y + 4, window.innerHeight - 160) }} onClick={(event) => event.stopPropagation()}>{entryItems}</div>
            </div>
          ), document.body)}
          {noteViewer && createPortal(<div className="mx-photo-view" role="dialog" aria-label="Photo" onClick={() => setNoteViewer(null)}><button type="button" className="mx-photo-view-close" aria-label="Close"><X size={22} /></button><img src={noteViewer} alt="" /></div>, document.body)}
        </section>
      );
    } else if (tab === "assistant") {
      // Campus assistant: Claude on the viewer's own account inside a Claude viewer, the demo's answers elsewhere.
      const ask = async (question: string) => {
        const text = question.trim();
        if (!text || aiBusy) return;
        const turns = [...aiTurns, { mine: true, text }];
        const showAnswer = (answer: string) => setAiTurns([...turns, { mine: false, text: answer }]);
        setAiDraft("");
        setAiBusy(true);
        showAnswer("");
        const courses = courseGroups.filter((group) => !group.isDegree).map((group) => group.courseCode);
        const fromDemo = () => { setAiSource("demo"); window.setTimeout(() => showAnswer(offlineAnswer(text, courses)), 450); };
        try {
          const sample = await claudeSample();
          if (!sample) { fromDemo(); return; }
          const context = campusContext(courses, (generalPosts || []).map((post) => post.body.split("\n\n")[0]));
          const { text: answer } = await sample(claudeInput(turns, context), { modelTier: "quick", cache: false, onText: ({ text: soFar }: { text: string }) => showAnswer(soFar) });
          setAiSource("claude");
          showAnswer(answer.trim() || offlineAnswer(text, courses));
        } catch {
          fromDemo();
        } finally {
          window.setTimeout(() => setAiBusy(false), 460);
        }
      };
      const suggestions = ["What's happening this week?", "Which clubs are good for careers?", "Where can I get help for my midterm?"];
      main = (
        <section className="mx-page ccc-chat-page ccc-ai">
          <header className="mx-page-header"><button type="button" className="mx-page-back mx-menu-button" aria-label="Back" onClick={shellBack}><ChevronLeft size={22} /></button><h2>Ask AI</h2>{aiTurns.length > 0 && <div className="mx-page-actions"><button type="button" className="ccc-ai-clear" onClick={() => { setAiTurns([]); setAiSource(null); }}>New chat</button></div>}</header>
          <div className="mx-page-scroll ccc-thread">
            <div className="ccc-thread-intro"><div className="ccc-ai-mark" aria-hidden="true"><ClubSparkles size={28} /></div><strong>CCConnect assistant</strong><span>Ask about events, clubs and your courses.</span></div>
            {aiTurns.length === 0 && <div className="ccc-ai-suggest">{suggestions.map((item) => <button type="button" key={item} onClick={() => ask(item)}>{item}</button>)}</div>}
            {aiTurns.map((turn, index) => <div className={turn.mine ? "ccc-bubble mine" : "ccc-bubble"} key={index}><p>{turn.text || "Thinking…"}</p></div>)}
            {aiSource && <p className="ccc-ai-source">{aiSource === "claude" ? "Answers by Claude, using your Claude account." : "Demo answers. Open this page signed in to Claude for real AI answers."}</p>}
          </div>
          <form className="ccc-compose" onSubmit={(event) => { event.preventDefault(); ask(aiDraft); }}>
            <input id="ai-message" aria-label="Ask the CCConnect assistant" placeholder="Ask about events, clubs, courses…" value={aiDraft} onChange={(event) => setAiDraft(event.target.value)} />
            <button type="submit" aria-label="Send" disabled={!aiDraft.trim() || aiBusy}><Send size={18} /></button>
          </form>
        </section>
      );
    } else if (tab === "events") {
      // Events on campus, soonest first, grouped into this week and later. "Going" is kept in memory.
      const weekAhead = Date.now() + 7 * 86400000;
      const eventCard = (event: (typeof CAMPUS_EVENTS)[number]) => {
        const start = new Date(event.startsAt), end = new Date(event.endsAt);
        const going = goingEvents.includes(event.id);
        const time = (date: Date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        return (
          <article className="ccc-event" key={event.id}>
            <div className="ccc-date" aria-hidden="true"><span>{start.toLocaleDateString(undefined, { month: "short" })}</span><strong>{start.getDate()}</strong></div>
            <div className="ccc-event-body">
              <span className="ccc-tag">{event.tag}</span>
              <h3>{event.title}</h3>
              <p className="ccc-meta"><Clock size={14} aria-hidden="true" />{start.toLocaleDateString(undefined, { weekday: "short" })}, {time(start)} to {time(end)}</p>
              <p className="ccc-meta"><MapPin size={14} aria-hidden="true" />{event.place}</p>
              <p className="ccc-about">{event.about}</p>
              <div className="ccc-row"><span className="ccc-host">Hosted by {event.host}</span><button type="button" className={going ? "ccc-action on" : "ccc-action"} aria-pressed={going} onClick={() => setGoingEvents((ids) => going ? ids.filter((id) => id !== event.id) : [...ids, event.id])}>{going ? <><Check size={15} />Going</> : "I'm going"}</button><span className="ccc-count">{event.going + (going ? 1 : 0)} going</span></div>
            </div>
          </article>
        );
      };
      const soon = CAMPUS_EVENTS.filter((event) => new Date(event.startsAt).getTime() <= weekAhead), later = CAMPUS_EVENTS.filter((event) => new Date(event.startsAt).getTime() > weekAhead);
      main = (
        <section className="mx-page">
          <header className="mx-page-header"><button type="button" className="mx-page-back mx-menu-button" aria-label="Back" onClick={shellBack}><ChevronLeft size={22} /></button><h2>Events</h2></header>
          <div className="mx-page-scroll mx-feed ccc-list">
            <h3 className="ccc-section">This week</h3>
            {soon.map(eventCard)}
            {later.length > 0 && <h3 className="ccc-section">Later</h3>}
            {later.map(eventCard)}
          </div>
        </section>
      );
    } else if (tab === "clubs") {
      // Clubs, filtered by category. Message opens a chat with that club; the chat icon lists every club you've messaged.
      const shown = CAMPUS_CLUBS.filter((club) => clubCategory === "All" || club.category === clubCategory).sort((a, b) => b.members - a.members);
      const chatted = CAMPUS_CLUBS.filter((club) => clubChats[club.id]?.length).sort((a, b) => (clubChats[b.id].at(-1)?.at || "").localeCompare(clubChats[a.id].at(-1)?.at || ""));
      const initialsOf = (name: string) => name.split(/\s+/).filter((word) => /^[A-Z]/.test(word)).slice(0, 2).map((word) => word[0]).join("");
      const coverStyle = (club: (typeof CAMPUS_CLUBS)[number]) => ({ "--c1": club.colors[0], "--c2": club.colors[1] }) as CSSProperties;
      const openClub = CAMPUS_CLUBS.find((club) => club.id === clubView);
      const back = <button type="button" className="mx-page-back" aria-label="Back" onClick={() => setClubView(openClub ? "inbox" : null)}><ChevronLeft size={22} /></button>;
      const timeOf = (iso: string) => { const date = new Date(iso); return Date.now() - date.getTime() < 86400000 ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
      const sendToClub = (club: (typeof CAMPUS_CLUBS)[number]) => {
        const body = clubDraft.trim();
        if (!body) return;
        setClubDraft("");
        setClubChats((chats) => ({ ...chats, [club.id]: [...(chats[club.id] || []), { mine: true, body, at: new Date().toISOString() }] }));
        // A club exec answers a moment later (demo).
        const replies = [`Thanks for reaching out! Our next meetup is ${club.meets.split("·")[0].trim()}. Come by any time.`, "Great question. One of our execs will follow up here soon.", "Love that! You can also drop by our next event to say hi."];
        window.setTimeout(() => setClubChats((chats) => ({ ...chats, [club.id]: [...(chats[club.id] || []), { mine: false, body: replies[(chats[club.id] || []).length % replies.length], at: new Date().toISOString() }] })), 1200);
      };
      if (openClub) {
        const thread = clubChats[openClub.id] || [];
        main = (
          <section className="mx-page ccc-chat-page" style={coverStyle(openClub)}>
            <header className="mx-page-header">{back}<h2>{openClub.name}</h2></header>
            <div className="mx-page-scroll ccc-thread">
              <div className="ccc-thread-intro"><div className="ccc-logo" aria-hidden="true">{initialsOf(openClub.name)}</div><strong>{openClub.name}</strong><span>{openClub.category} · {openClub.members.toLocaleString()} members</span></div>
              {thread.length === 0 && <p className="ccc-thread-empty">Say hi or ask {openClub.name} a question. Club execs reply here.</p>}
              {thread.map((message, index) => <div className={message.mine ? "ccc-bubble mine" : "ccc-bubble"} key={index}><p>{message.body}</p><time>{timeOf(message.at)}</time></div>)}
            </div>
            <form className="ccc-compose" onSubmit={(event) => { event.preventDefault(); sendToClub(openClub); }}>
              <input id="club-message" aria-label={`Message ${openClub.name}`} placeholder={`Message ${openClub.name}`} value={clubDraft} onChange={(event) => setClubDraft(event.target.value)} />
              <button type="submit" aria-label="Send" disabled={!clubDraft.trim()}><Send size={18} /></button>
            </form>
          </section>
        );
      } else if (clubView === "inbox") {
        main = (
          <section className="mx-page">
            <header className="mx-page-header">{back}<h2>Club chats</h2></header>
            <div className="mx-page-scroll mx-feed ccc-list">
              {chatted.length === 0 ? <div className="mx-chat-empty"><span aria-hidden="true"><MessageCircle size={26} /></span><h3>No club chats yet</h3><p>Tap Message on any club to start one.</p></div> : chatted.map((club) => {
                const last = clubChats[club.id].at(-1)!;
                return <button type="button" className="ccc-inbox-row" key={club.id} style={coverStyle(club)} onClick={() => { setClubDraft(""); setClubView(club.id); }}><span className="ccc-logo" aria-hidden="true">{initialsOf(club.name)}</span><span className="ccc-inbox-text"><strong>{club.name}</strong><span>{last.mine ? "You: " : ""}{last.body}</span></span><time>{timeOf(last.at)}</time></button>;
              })}
            </div>
          </section>
        );
      } else {
        main = (
          <section className="mx-page">
            <header className="mx-page-header"><button type="button" className="mx-page-back mx-menu-button" aria-label="Back" onClick={shellBack}><ChevronLeft size={22} /></button><h2>Clubs</h2><div className="mx-page-actions"><button type="button" className="ccc-inbox-btn" aria-label={`Club chats${chatted.length ? `, ${chatted.length}` : ""}`} title="Club chats" onClick={() => setClubView("inbox")}><MessageCircle size={21} />{chatted.length > 0 && <span className="ccc-badge">{chatted.length}</span>}</button></div></header>
            <div className="ccc-chips" role="tablist" aria-label="Club categories">{CLUB_CATEGORIES.map((category) => <button type="button" role="tab" key={category} aria-selected={clubCategory === category} className={clubCategory === category ? "on" : ""} onClick={() => setClubCategory(category)}>{category}</button>)}</div>
            <div className="mx-page-scroll mx-feed ccc-list">
              <div className="ccc-club-grid">
              {shown.map((club) => {
                const Mark = CLUB_ICONS[club.icon];
                const friends = club.friends;
                return (
                  <article className="ccc-club" key={club.id} style={coverStyle(club)}>
                    <div className="ccc-cover" aria-hidden="true"><span className="ccc-cover-tag">{club.category}</span><Mark className="ccc-cover-mark" size={96} strokeWidth={1.4} /></div>
                    <div className="ccc-club-main">
                      <div className="ccc-logo" aria-hidden="true">{initialsOf(club.name)}</div>
                      <div className="ccc-club-head">
                        <h3>{club.name}</h3>
                        <p className="ccc-meta">{club.members.toLocaleString()} members</p>
                      </div>
                      <button type="button" className="ccc-action" onClick={() => { setClubDraft(""); setClubView(club.id); }}><MessageCircle size={15} />Message</button>
                    </div>
                    <p className="ccc-about">{club.about}</p>
                    <p className="ccc-meta"><CalendarDays size={14} aria-hidden="true" />{club.meets}</p>
                    <div className="ccc-photos">{club.photos.map(([caption, icon], index) => { const Photo = CLUB_ICONS[icon]; return <figure className={`ccc-photo ccc-photo-${index}`} key={caption}><Photo size={30} strokeWidth={1.6} aria-hidden="true" /><figcaption>{caption}</figcaption></figure>; })}</div>
                    <div className="ccc-friends"><span className="ccc-faces">{friends.slice(0, 3).map((name) => <Avatar key={name} name={name} seed={name} />)}</span><span>{friends[0]}{friends.length > 1 ? ` and ${friends.length - 1} classmate${friends.length > 2 ? "s" : ""}` : ""} {friends.length > 1 ? "are" : "is"} in this club</span></div>
                  </article>
                );
              })}
              </div>
            </div>
          </section>
        );
      }
    } else if (tab === "general-forum") {
      // General Forum: general posts (no course). Visitors also see every course's forum posts, each tagged with its
      // course (tap it to open the course), so CCConnect doesn't look empty.
      const words = forumQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const list = generalPosts || [];
      const matches = list.filter((post) => { const text = `${post.body} ${post.author?.displayName || ""} ${post.courseCode || ""}`.toLowerCase(); return words.every((word) => text.includes(word)); });
      // The search also finds courses by code ("adms1000", "ADMS 10"): tap one to open its forum. It's how visitors
      // get into a course, so for them the bar pulses until they use it.
      const squash = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const query = squash(forumQuery);
      // Every York course is searched (code or title words), not just the few with a forum already: those come first.
      const titleOf = new Map(courseCatalog.map(([code, title]) => [squash(code), title]));
      const titleWords = forumQuery.trim().toUpperCase().split(/\s+/).filter((word) => word.length >= 2);
      const titleMatch = (title = "") => titleWords.length > 0 && titleWords.every((word) => title.toUpperCase().includes(word));
      const courseMatches = query.length >= 2 ? courseGroups.filter((group) => !group.isDegree && (squash(courseLabel(group)).includes(query) || titleMatch(titleOf.get(squash(group.courseCode))))).sort((a, b) => (squash(a.courseCode).startsWith(query) ? 0 : 1) - (squash(b.courseCode).startsWith(query) ? 0 : 1) || b.memberCount - a.memberCount).slice(0, 8) : [];
      const liveCodes = new Set(courseGroups.map((group) => squash(group.courseCode)));
      const requestedCodes = new Map(pendingRequests.map((item) => [squash(item.courseCode), item]));
      // Code matches first, then undergraduate (1000-4999) before graduate courses, like Add a course.
      const catalogMatches = query.length >= 2 ? courseCatalog.filter(([code, title]) => !liveCodes.has(squash(code)) && (squash(code).includes(query) || titleMatch(title)))
        .map((course) => ({ course, rank: (squash(course[0]).startsWith(query) ? 0 : squash(course[0]).includes(query) ? 1 : 2) * 2 + (Number(course[0].match(/\d{4}/)?.[0]) >= 5000 ? 1 : 0) }))
        .sort((a, b) => a.rank - b.rank || a.course[0].localeCompare(b.course[0])).slice(0, Math.max(0, 12 - courseMatches.length)).map(({ course }) => course) : [];
      const anyCourse = courseMatches.length + catalogMatches.length > 0;
      // A course with no forum yet: students request it (a moderator accepts or rejects it), or ask too.
      const openCatalogCourse = async ([code]: CatalogCourse) => {
        const pending = requestedCodes.get(squash(code));
        if (pending?.requestedByMe) return;
        if (pending) { joinRequestedCourse(pending); return; }
        try {
          const data = await request("/api/course-requests", { method: "POST", body: JSON.stringify({ courseCode: code }) }, token);
          await loadApp();
          setForumQuery("");
          if (data.joined) shellOpenCourse({ id: data.joined.id, courseCode: data.joined.courseCode, instructor: data.joined.instructor, termName: data.joined.termName, memberCount: 0, joined: true });
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Unable to request that course.");
        }
      };
      // Visitors don't get the General Forum (owner's call, Oct 31 2026): their home asks them to find their course, and
      // only lists course forums with activity (at least one post), most recently active first. Before the server sends
      // forumPosts every course counts as active.
      const activeForums = courseGroups.filter((group) => !group.isDegree && (group.forumPosts === undefined || group.forumPosts > 0));
      const foundForums = (query.length >= 2 ? activeForums.filter((group) => squash(courseLabel(group)).includes(query) || titleMatch(titleOf.get(squash(group.courseCode)))) : activeForums)
        .slice().sort((a, b) => (query.length >= 2 ? (squash(a.courseCode).startsWith(query) ? 0 : 1) - (squash(b.courseCode).startsWith(query) ? 0 : 1) : 0) || (b.lastPostAt || "").localeCompare(a.lastPostAt || "") || (b.forumPosts || 0) - (a.forumPosts || 0));
      main = guest ? (
        <section className="mx-page mx-finder">
          <header className="mx-page-header"><h2>Find your course</h2></header>
          <div className="mx-forum-search"><label className={!forumQuery ? "mx-search mx-search-pulse" : "mx-search"}><Search size={17} aria-hidden="true" /><input type="search" aria-label="Find your course" value={forumQuery} onChange={(event) => setForumQuery(event.target.value)} placeholder="e.g. ADMS 1000 or Psychology" />{forumQuery && <button type="button" className="mx-search-clear" aria-label="Clear search" onClick={() => setForumQuery("")}><X size={15} /></button>}</label></div>
          <div className="mx-page-scroll">
            <p className="mx-finder-lead">See what York students are asking in your courses.</p>
            {foundForums.length > 0 ? <>
              <h3 className="mx-label">{query.length >= 2 ? "Matching course forums" : "Active course forums"}</h3>
              <ul className="mx-card mx-list mx-course-results">{foundForums.map((group) => <li key={group.id}><button type="button" className="mx-row" onClick={() => { setForumQuery(""); shellOpenCourse(group); }}><span className="mx-row-badge"><Hash size={16} /></span><span className="mx-row-main"><strong>{courseLabel(group)}</strong><small>{[titleOf.get(squash(group.courseCode)), group.forumPosts ? `${group.forumPosts} post${group.forumPosts === 1 ? "" : "s"}` : "", group.lastPostAt ? `last ${agoText(group.lastPostAt)}` : ""].filter(Boolean).join(" · ")}</small></span><ChevronRight size={18} aria-hidden="true" /></button></li>)}</ul>
            </> : !groupsReady && query.length < 2 ? loadingRows("chat") : <div className="mx-chat-empty"><span aria-hidden="true"><Search size={26} /></span>{query.length >= 2 ? <><h3>No active forum for "{forumQuery.trim()}"</h3><p>Nobody is posting in that course yet. Sign up to start the conversation.</p></> : <><h3>No active course forums yet</h3><p>Sign up and be the first to ask something in your course.</p></>}<button type="button" className="mx-primary" onClick={() => leaveGuest("auth")}>Sign up</button></div>}
          </div>
          <div className="mx-composer-note">Browsing as a visitor · <button type="button" onClick={() => leaveGuest("auth")}>Sign up to post</button></div>
        </section>
      ) : (
        <section className="mx-page">
          <header className="mx-page-header">{!guest && <button type="button" className="mx-page-back mx-menu-button" aria-label="Back" onClick={shellBack}><ChevronLeft size={22} /></button>}<h2>General Forum</h2>{!guest && <div className="mx-page-actions"><button type="button" className="mx-new-post mx-new-post-icon" aria-label="New post" title="New post" onClick={() => { setEditingPost(null); setPostTitle(""); setPostBody(""); setPostImages([]); setPostScope("general"); setTab("create"); setMobileMain(true); }}><Plus size={20} /></button></div>}</header>
          <div className="mx-forum-search"><label className={guest && !forumQuery ? "mx-search mx-search-pulse" : "mx-search"}><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search the General Forum and courses" value={forumQuery} onChange={(event) => setForumQuery(event.target.value)} placeholder={guest ? "Find your course — e.g. ADMS 1000" : "Search posts and courses"} />{forumQuery && <button type="button" className="mx-search-clear" aria-label="Clear search" onClick={() => setForumQuery("")}><X size={15} /></button>}</label></div>
          <div className="mx-page-scroll mx-feed">
            {anyCourse && <>
              <h3 className="mx-label">Courses</h3>
              <ul className="mx-card mx-list mx-course-results">
                {courseMatches.map((group) => <li key={group.id}><button type="button" className="mx-row" onClick={() => { setForumQuery(""); shellOpenCourse(group); }}><span className="mx-row-badge"><Hash size={16} /></span><span className="mx-row-main"><strong>{courseLabel(group)}</strong><small>{titleOf.get(squash(group.courseCode)) ? `${titleOf.get(squash(group.courseCode))} · ` : ""}{group.memberCount} member{group.memberCount === 1 ? "" : "s"}</small></span><ChevronRight size={18} aria-hidden="true" /></button></li>)}
                {catalogMatches.map((course) => <li key={course[0]}><button type="button" className="mx-row" onClick={() => openCatalogCourse(course)}><span className="mx-row-badge"><Hash size={16} /></span><span className="mx-row-main"><strong>{course[0]}</strong><small>{course[1]}</small></span>{requestedCodes.get(squash(course[0]))?.requestedByMe ? <span className="mx-pill outline">Requested</span> : <span className="mx-pill dark">Request</span>}</button></li>)}
              </ul>
              {matches.length > 0 && <h3 className="mx-label">Posts</h3>}
            </>}
            {(generalPosts === null || (generalPosts.length === 0 && !freshForums.current.has("general"))) ? loadingRows("cards") : forumQuery.trim()
              ? (anyCourse && matches.length === 0 ? null : renderFeed(matches, <div className="mx-chat-empty"><span aria-hidden="true"><Search size={26} /></span><h3>Nothing found</h3><p>No course or post matches "{forumQuery.trim()}".</p></div>, true))
              : renderFeed(list, <div className="mx-chat-empty"><span aria-hidden="true"><Newspaper size={26} /></span><h3>No posts yet</h3><p>{guest ? "Search for your course above to see what classmates are saying." : "Ask anyone at York anything: tap + to post."}</p></div>, true)}
          </div>
          {guest && <div className="mx-composer-note">Browsing as a visitor · <button type="button" onClick={() => leaveGuest("auth")}>Sign up to post</button></div>}
        </section>
      );
    } else if (tab === "degree-posts" && degree) {
      const words = forumQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const forumMatches = degreePosts.filter((post) => { const text = `${post.body} ${post.author?.displayName || ""}`.toLowerCase(); return words.every((word) => text.includes(word)); });
      main = (
        <section className="mx-page">
          <header className="mx-page-header"><button type="button" className="mx-page-back mx-menu-button" aria-label="Back" onClick={shellBack}><ChevronLeft size={22} /></button><h2>Degree Forum</h2>{!guest && <div className="mx-page-actions"><button type="button" className="mx-new-post mx-new-post-icon" aria-label="New post" title="New post" onClick={() => startDegreePost()}><Plus size={20} /></button></div>}</header>
          {/* Search sits outside the scrolling list, so it stays put under the header while posts scroll. */}
          <div className="mx-forum-search"><label className="mx-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search the Degree Forum" value={forumQuery} onChange={(event) => setForumQuery(event.target.value)} placeholder={`Search ${degree.code || "the forum"} posts`} />{forumQuery && <button type="button" className="mx-search-clear" aria-label="Clear search" onClick={() => setForumQuery("")}><X size={15} /></button>}</label></div>
          <div className="mx-page-scroll mx-feed">{forumQuery.trim() ? renderFeed(forumMatches, <div className="mx-chat-empty"><span aria-hidden="true"><Search size={26} /></span><h3>No matching posts</h3><p>Nothing in the forum mentions "{forumQuery.trim()}".</p></div>) : renderFeed(degreePosts, <div className="mx-chat-empty"><span aria-hidden="true"><GraduationCap size={26} /></span><h3>No posts yet</h3><p>{degreePostsUnavailable ? "Degree posts aren't set up yet (migration 030)." : `Ask everyone in ${degree.name} about courses, profs or anything about the program.`}</p></div>)}</div>
        </section>
      );
    } else if (tab === "social") {
      // Drawn once: in the main area (desktop, and phones' page-beside-the-rail), or in the side panel when that's
      // the one on screen (feedInPanel), never both.
      main = !FEED_ENABLED ? (
        <section className="mx-page">
          <header className="mx-page-header"><button type="button" className="mx-page-back mx-menu-button" aria-label="Open menu" onClick={shellBack}><Menu size={22} /></button><h2>Dev Posts</h2>{newPostButton}</header>
          <div className="mx-page-scroll mx-feed">{feedList}</div>
        </section>
      ) : feedInPanel ? <section className="mx-page" /> : feedView;
    } else {
      main = (
        <section className="mx-welcome"><span aria-hidden="true"><GraduationCap size={34} /></span><h2>This is where your university communities live</h2><p>Your degree for the long term, your courses for right now, and project rooms for the people you're working with.</p>{degree ? <button type="button" className="mx-primary" onClick={shellOpenDegree}>Open Degree Forum</button> : !guest && <button type="button" className="mx-primary" onClick={() => { setDegreePickerOpen(true); loadDegrees(); setMobileMain(true); }}>Choose your degree</button>}</section>
      );
    }

    // One step back from whatever is open in the main area.
    const goBack = () => {
      if (chatFind !== null) setChatFind(null);
      else if (courseQrOpen) setCourseQrOpen(false);
      else if (courseInfoOpen) { if (isDegreeChat) closeDegreeInfo(); else setCourseInfoOpen(false); }
      else if (projectPanelOpen) setProjectPanelOpen(false);
      else if (creatingCourse) setCreatingCourse(false);
      else if (degreePickerOpen) { setDegreePickerOpen(false); if (!profilePage) setMobileMain(false); } // from Edit Profile it goes back there
      // Profile's pages go back where they were opened from: the full-screen or the small view.
      else if (notifSettingsOpen) { setNotifSettingsOpen(false); setNotifChatSearch(""); setNotifChatsAll(false); setMobileMain(notifSettingsFromFull.current); }
      else if (profilePage) { setProfilePage(null); setMobileMain(profilePageFromFull.current); }
      else if (tab === "post" && commentPost) postBack(commentPost);
      else if (tab === "create") { if (backToSharedNote()) return; setEditingPost(null); setTab(postScope === "general" ? "general-forum" : postScope === "course" ? "course-group" : postScope === "degree" ? "degree-posts" : FORUM_HOME); }
      else shellBack();
    };
    // Phones, Discord-style: the chat/page is a layer on top of the course list (always rendered underneath).
    // Swiping right drags that layer away to reveal the list; swiping left on the list pulls it back.
    // The list underneath moves at a slower rate (--drag) for depth. Releasing hands off to the CSS transition.
    const degreeInfoShowing = courseInfoOpen && isDegreeChat; // closes like a chat (to the list), not one step back
    const overlayStep = chatFind !== null || courseQrOpen || (courseInfoOpen && !degreeInfoShowing) || projectPanelOpen || creatingCourse || degreePickerOpen || notifSettingsOpen || Boolean(profilePage) || tab === "post" || tab === "create";
    const shellRoot = (element: HTMLElement) => element.closest(".mx") as HTMLElement;
    const startSwipe = (event: ReactTouchEvent<HTMLElement>, allowed: boolean) => {
      if (isWide() || !allowed || event.touches.length !== 1) return;
      swipe.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, t: Date.now(), horizontal: null };
    };
    const swipeDelta = (event: ReactTouchEvent<HTMLElement>, wantRight: boolean) => {
      const start = swipe.current;
      if (!start) return null;
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      // Decide early and favour sideways (anything within ~50° of horizontal), like Discord.
      if (start.horizontal === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) start.horizontal = (wantRight ? dx > 0 : dx < 0) && Math.abs(dx) > Math.abs(dy) * 0.8;
      return start.horizontal ? dx : null;
    };
    const endSwipe = (event: ReactTouchEvent<HTMLElement>) => {
      const start = swipe.current;
      swipe.current = null;
      if (!start?.horizontal) return null;
      shellRoot(event.currentTarget).classList.remove("mx-dragging");
      const dx = (event.changedTouches[0]?.clientX ?? start.x) - start.x;
      // A quick flick counts too, not only a long drag.
      const flick = Math.abs(dx) > 30 && Math.abs(dx) / Math.max(1, Date.now() - start.t) > 0.35;
      return flick ? dx * 4 : dx;
    };
    // Drawer screens: the same page is the small view (rail beside it) and the full view (rail tucked away).
    // Swiping left on the small view tucks the rail away; swiping right on the full view brings it back.
    const drawerDrag = (dx: number) => String(Math.min(1, Math.abs(dx) / 140));
    const swipeStart = (event: ReactTouchEvent<HTMLElement>) => startSwipe(event, mobileMain || drawer);
    const swipeMove = (event: ReactTouchEvent<HTMLElement>) => {
      const dx = swipeDelta(event, drawer ? mobileMain : true);
      if (dx === null) return;
      const root = shellRoot(event.currentTarget);
      root.classList.add("mx-dragging");
      if (drawer) { root.style.setProperty("--drag", drawerDrag(mobileMain ? Math.max(0, dx) : Math.min(0, dx))); return; }
      // One step back (a post, the composer, info pages): only the page moves; its frame stays, so the course list
      // underneath never shows mid-swipe (it used to flash before the forum came back).
      if (tab === "post" && commentPost && !swipeShot.current) {
        // Swiping back from a post, iPhone-style: lift the post page out on top (the finger stays on it, so the
        // swipe keeps tracking), draw the list it came from underneath, then let the post follow the finger.
        const page = event.currentTarget.firstElementChild as HTMLElement | null;
        if (page) {
          const box = page.getBoundingClientRect(), rootBox = root.getBoundingClientRect();
          const scroller = page.querySelector<HTMLElement>(".mx-page-scroll"), scrolled = scroller?.scrollTop || 0;
          const startX = event.touches[0].clientX - dx, post = commentPost;
          Object.assign(page.style, { position: "absolute", left: `${box.left - rootBox.left}px`, top: `${box.top - rootBox.top}px`, width: `${box.width}px`, height: `${box.height}px`, zIndex: "40", animation: "none", transition: "none", transform: `translateX(${Math.max(0, dx)}px)` });
          page.classList.add("mx-swipe-shot");
          root.appendChild(page);
          if (scroller) scroller.scrollTop = scrolled;
          swipeShot.current = page;
          root.classList.add("mx-swiping");
          let lastX = event.touches[0].clientX, lastT = Date.now(), speed = 0;
          const move = (touch: TouchEvent) => {
            touch.preventDefault();
            const x = touch.touches[0]?.clientX ?? lastX, now = Date.now();
            speed = (x - lastX) / Math.max(1, now - lastT); lastX = x; lastT = now;
            page.style.transform = `translateX(${Math.max(0, x - startX)}px)`;
          };
          const end = () => {
            page.removeEventListener("touchmove", move); page.removeEventListener("touchend", end); page.removeEventListener("touchcancel", end);
            const moved = lastX - startX;
            const go = moved > Math.min(110, root.clientWidth * 0.3) || speed > 0.45;
            page.style.transition = "transform .26s cubic-bezier(.2,.8,.2,1)";
            page.style.transform = go ? "translateX(100%)" : "";
            window.setTimeout(() => {
              if (!go) flushSync(() => { setCommentPost(post); setTab("post"); setMobileMain(true); });
              page.remove();
              swipeShot.current = null;
              root.classList.remove("mx-swiping");
            }, 270);
          };
          page.addEventListener("touchmove", move, { passive: false });
          page.addEventListener("touchend", end);
          page.addEventListener("touchcancel", end);
          swipe.current = null; // the rest of this swipe is handled on the post itself
          swipedBack.current = true; // the list underneath appears as is, with no entrance animation
          flushSync(() => postBack(post)); // the list is drawn underneath now
          return;
        }
      }
      const moving = (overlayStep ? (event.currentTarget.firstElementChild as HTMLElement | null) || event.currentTarget : event.currentTarget);
      moving.style.transition = "none";
      moving.style.transform = `translateX(${Math.max(0, dx)}px)`;
      if (!overlayStep) root.style.setProperty("--drag", String(Math.min(1, Math.max(0, dx) / root.clientWidth)));
    };
    const swipeEnd = (event: ReactTouchEvent<HTMLElement>) => {
      const panel = event.currentTarget;
      const root = shellRoot(panel);
      const dx = endSwipe(event);
      if (dx === null) return;
      if (drawer) {
        root.style.removeProperty("--drag");
        if (!mobileMain && dx < -50) setMobileMain(true);
        else if (mobileMain && dx > 50) shellBack();
        return;
      }
      const go = dx > Math.min(110, root.clientWidth * 0.3);
      if (overlayStep) {
        // A page one step deep (post, composer, info, search…): only the page slides; the frame stays put.
        const page = (panel.firstElementChild as HTMLElement | null) || panel;
        page.style.transition = "transform .28s cubic-bezier(.2,.8,.2,1)";
        if (!go) { page.style.transform = ""; window.setTimeout(() => { page.style.transition = ""; }, 300); return; }
        page.style.transform = "translateX(100%)";
        // Swap to the step underneath (it slides in from the left) once this page is out of sight.
        window.setTimeout(() => { flushSync(goBack); page.style.transition = ""; page.style.transform = ""; }, 260);
        return;
      }
      panel.style.transform = "";
      root.style.removeProperty("--drag");
      if (go) { if (degreeInfoShowing) closeDegreeInfo(); else shellBack(); }
    };
    // Dev Posts, Alerts and Profile: the full view sits underneath and the side nav is a drawer over it.
    // Swiping left slides the nav away to the left; ☰ or swiping right pulls it back.
    const drawer = !isWide() && railPanel !== "courses" && ["social", "alerts", "profile", "app-info"].includes(tab) && !profilePage && !notifSettingsOpen;
    // A Profile page opened from the full-screen profile slides in over a copy of it, so the back swipe
    // reveals exactly where you land.
    const subFromFull = !isWide() && !degreePickerOpen && ((notifSettingsOpen && notifSettingsFromFull.current) || (Boolean(profilePage) && profilePageFromFull.current));
    const canGoForward = Boolean(inCourse || inProject || ["app-info", "social", "post", "create", "browse-courses", "alerts", "profile", "settings", "degree-posts", "general-forum"].includes(tab));
    const forwardStart = (event: ReactTouchEvent<HTMLElement>) => startSwipe(event, !mobileMain && canGoForward);
    const forwardMove = (event: ReactTouchEvent<HTMLElement>) => {
      const dx = swipeDelta(event, false);
      if (dx === null) return;
      const root = shellRoot(event.currentTarget);
      const layer = root.querySelector<HTMLElement>(".mx-main");
      if (!layer) return;
      root.classList.add("mx-dragging");
      if (!drawer) layer.style.transform = `translateX(calc(100% + ${Math.min(0, dx)}px))`;
      root.style.setProperty("--drag", String(Math.min(1, -Math.min(0, dx) / root.clientWidth)));
    };
    const forwardEnd = (event: ReactTouchEvent<HTMLElement>) => {
      const root = shellRoot(event.currentTarget);
      const dx = endSwipe(event);
      if (dx === null) return;
      const layer = root.querySelector<HTMLElement>(".mx-main");
      if (layer) layer.style.transform = "";
      root.style.removeProperty("--drag");
      if (dx < -Math.min(110, root.clientWidth * 0.3)) setMobileMain(true);
    };
    // Main area page key (a new key = a new page, which animates in) and its direction.
    const mainKey = [tab, activeCourseGroup?.id, activeProject?.id, tab === "note" ? activeNote?.id : "", courseInfoOpen, projectPanelOpen, courseQrOpen, degreePickerOpen, creatingCourse, notifSettingsOpen, profilePage].join("|");
    if (navMotion.current.key !== mainKey) {
      const depth = tab === "post" || tab === "create" ? 3 : courseInfoOpen || courseQrOpen || projectPanelOpen || creatingCourse || degreePickerOpen || notifSettingsOpen || profilePage ? 3 : tab === "project-room" ? 2 : 1;
      // Phones: when the whole layer slides (course list <-> page), that slide is the motion; the page doesn't also move.
      const layer = !isWide() && mobileMain;
      const layerMoving = !isWide() && navMotion.current.layer !== undefined && navMotion.current.layer !== layer;
      // Into or out of a drawer page (Profile -> Privacy & Safety and back): one slide of the page, not the layer.
      const drawerStep = layerMoving && !swipedBack.current && (drawer || Boolean(navMotion.current.drawer));
      if (drawerStep) snapLayout.current = true;
      const step = swipedBack.current || (layerMoving && !drawerStep) ? "none" : !navMotion.current.key ? "swap" : depth > navMotion.current.depth ? "forward" : depth < navMotion.current.depth ? "back" : "swap";
      // Back to a drawer page: it stays still underneath and only the page being left slides away.
      const dir = drawerStep && step === "back" ? "uncover" : step;
      swipedBack.current = false;
      // The page being left plays its exit (a copy of it, since React is about to replace it): deeper = it eases left
      // and dims under the new page; back = it slides off to the right over the page underneath; switch = it fades.
      if (dir !== "none" && navMotion.current.key && typeof document !== "undefined") {
        const old = document.querySelector<HTMLElement>(".mx > .mx-main > section");
        const root = old?.closest<HTMLElement>(".mx");
        if (old && root) {
          const box = old.getBoundingClientRect(), rootBox = root.getBoundingClientRect();
          const ghost = old.cloneNode(true) as HTMLElement;
          ghost.classList.add("mx-nav-ghost", `to-${dir === "uncover" ? "back" : dir}`);
          ghost.setAttribute("aria-hidden", "true");
          Object.assign(ghost.style, { position: "absolute", left: `${box.left - rootBox.left}px`, top: `${box.top - rootBox.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: "0" });
          root.appendChild(ghost);
          const scroller = old.querySelector<HTMLElement>(".mx-page-scroll, .mx-messages"), copy = ghost.querySelector<HTMLElement>(".mx-page-scroll, .mx-messages");
          if (scroller && copy) copy.scrollTop = scroller.scrollTop;
          const done = () => ghost.remove();
          ghost.addEventListener("animationend", done);
          window.setTimeout(done, 700);
        }
      }
      navMotion.current = { key: mainKey, depth, dir, layer, drawer };
    }
    return (
      <div className={`mx${isWide() && railPanel !== "courses" ? " mx-full" : ""}${canGoForward ? " mx-can-return" : ""}${darkMode ? " mx-dark" : ""}${mobileMain ? " mx-show-main" : " mx-show-nav"}${drawer ? " mx-drawer" : ""}${snapLayout.current ? " mx-dragging" : ""}${subFromFull ? " mx-subpage" : ""}${isNativeApp ? " mx-native" : ""}${guest ? " mx-no-rail mx-no-nav" : ""}`} onClick={() => { setSenderCard(null); setNotificationsOpen(false); setCourseAddMenu(null); }} onScroll={(event) => {
        // The layers slide with transforms; the root itself must never scroll. Focusing or scrolling to something in an
        // off-screen layer (a notification jump, an input) used to shift everything sideways and leave a dead screen.
        if (event.target === event.currentTarget && (event.currentTarget.scrollLeft || event.currentTarget.scrollTop)) { event.currentTarget.scrollLeft = 0; event.currentTarget.scrollTop = 0; }
      }}>
        {notice && <div className="toast mx-toast" role="status" onClick={(event) => event.stopPropagation()}><span>{notice}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice("")}><X size={16} /></button></div>}
        {/* + next to a course: name a new note (a small window in the middle of the screen). */}
        {/* The + next to the comment box: every message from your notes on one page, filter, tap one to use it. */}
        {notePicker && (() => {
          const courseIds = [...new Set(notes.map((note) => note.courseGroupId))].sort((a, b) => (a === commentPost?.courseGroupId ? -1 : b === commentPost?.courseGroupId ? 1 : 0));
          const codeOf = (id: string) => courseGroups.find((group) => group.id === id)?.courseCode || "Course";
          const words = notePicker.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
          const shown = notePicker.entries.filter((entry) => (notePicker.course === "all" || entry.note.courseGroupId === notePicker.course) && words.every((word) => entry.body.toLowerCase().includes(word)));
          return (
            <div className="mx-note-picker" role="dialog" aria-label="Pick from your notes">
              <header><button type="button" aria-label="Close" onClick={() => setNotePicker(null)}><X size={22} /></button><h2>Pick from your notes</h2></header>
              <div className="mx-note-picker-filters">
                <label className="mx-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search your notes" placeholder="Search your notes" value={notePicker.query} onChange={(event) => { const query = event.target.value; setNotePicker((current) => current && { ...current, query }); }} />{notePicker.query && <button type="button" className="mx-search-clear" aria-label="Clear search" onClick={() => setNotePicker((current) => current && { ...current, query: "" })}><X size={15} /></button>}</label>
                {/* One button that opens a dropdown of your courses (owner's call, Nov 3 2026). */}
                {courseIds.length > 1 && <div className="mx-note-filter">
                  <button type="button" className={notePicker.course === "all" ? "mx-note-filter-btn" : "mx-note-filter-btn on"} aria-haspopup="menu" aria-expanded={Boolean(notePicker.filterOpen)} onClick={() => setNotePicker((current) => current && { ...current, filterOpen: !current.filterOpen })}><span>{notePicker.course === "all" ? "All" : codeOf(notePicker.course)}</span><ChevronDown size={16} aria-hidden="true" /></button>
                  {notePicker.filterOpen && <>
                    <div className="mx-note-filter-backdrop" onClick={() => setNotePicker((current) => current && { ...current, filterOpen: false })} />
                    <div className="mx-note-filter-menu" role="menu">{["all", ...courseIds].map((id) => <button type="button" role="menuitemradio" aria-checked={notePicker.course === id} key={id} onClick={() => setNotePicker((current) => current && { ...current, course: id, filterOpen: false })}><span>{id === "all" ? "All courses" : codeOf(id)}</span>{notePicker.course === id && <Check size={16} aria-hidden="true" />}</button>)}</div>
                  </>}
                </div>}
              </div>
              <div className="mx-note-picker-list">
                {shown.length > 0 ? shown.map((entry, index) => {
                  const newDay = index === 0 || new Date(shown[index - 1].createdAt).toDateString() !== new Date(entry.createdAt).toDateString();
                  return (
                    <Fragment key={entry.id}>
                      {newDay && <h3 className="mx-label">{chatDayLabel(entry.createdAt)}</h3>}
                      <button type="button" className="mx-note-pick" onClick={() => pickNoteEntry(entry)}>
                        {entry.imageUrl && <span className="mx-note-pick-photo">{entry.imageUrl.startsWith(DEVICE_PHOTO) ? <DevicePhoto id={entry.imageUrl.slice(DEVICE_PHOTO.length)} onOpen={() => {}} /> : <img src={uploadedNotePhotos.get(entry.imageUrl) || entry.imageUrl} alt="" loading="lazy" />}</span>}
                        <span className="mx-note-pick-main">
                          <span className={entry.body ? "mx-note-pick-text" : "mx-note-pick-text none"}>{entry.body || "Photo"}</span>
                          <small>{codeOf(entry.note.courseGroupId)}{entry.note.name !== "General notes" ? ` · ${entry.note.name}` : ""} · {chatTime(entry.createdAt)}</small>
                        </span>
                      </button>
                    </Fragment>
                  );
                }) : notePicker.loading ? <div className="mx-note-picker-spin" role="status" aria-label="Loading"><span /></div>
                  : <p className="mx-note-picker-empty">{notePicker.entries.length ? (words.length ? "Nothing matches." : "No notes in this course yet.") : "Nothing in your notes yet. Write in a course's General notes, then pick from them here."}</p>}
              </div>
            </div>
          );
        })()}
        {commentPhotoView && createPortal(<div className="mx-photo-view" role="dialog" aria-label="Photo" onClick={() => setCommentPhotoView(null)}><button type="button" className="mx-photo-view-close" aria-label="Close"><X size={22} /></button><img src={commentPhotoView} alt="" /></div>, document.body)}
        {noteNaming && (
          <div className="mx-name-layer" onClick={() => setNoteNaming(null)}>
            <form className="mx-name-card" role="dialog" aria-label="New note" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); createNote(); }}>
              <span className="mx-name-icon" aria-hidden="true"><NotebookPen size={22} /></span>
              <h3>New note</h3>
              <p>For {courseLabel(noteNaming.group)} · only you can see it</p>
              <input autoFocus maxLength={60} placeholder="Name your note, e.g. Midterm 1" value={noteNaming.name} onChange={(event) => setNoteNaming((current) => current && { ...current, name: event.target.value })} />
              <div className="mx-name-actions"><button type="button" onClick={() => setNoteNaming(null)}>Cancel</button><button type="submit" className="primary" disabled={!noteNaming.name.trim()}>Create</button></div>
            </form>
          </div>
        )}
        {/* Comments for posts with no description (Instagram-style): the post, scaled to fit, fills the top third and
            the comments the bottom two thirds. The handle swipes the comments up to full screen, down to go back, and
            down again to close. Tapping the post closes it too. */}
        {sheetPost && (
          <div className={`mx-comments-layer${sheetFull ? " full" : ""}${sheetLong ? " long" : ""}${sheetClosing ? " closing" : ""}`}>
            <button type="button" className="mx-comments-top" aria-label="Close comments" onClick={closeCommentsSheet}><PostPreview post={sheetPost} /></button>
            <div className="mx-comments-sheet" role="dialog" aria-label="Comments" ref={sheetRef}>
              <div className="mx-sheet-grab" ref={sheetGrabRef}>
              <div className="mx-sheet-handle" role="button" tabIndex={0} aria-label={sheetFull ? "Shrink comments" : "Comments full screen"} onClick={() => { if (!sheetLong) setSheetFull((full) => !full); }}>
                <span />
              </div>
              <header><strong>{comments.length} comment{comments.length === 1 ? "" : "s"}</strong><span className="mx-comments-actions">{!sheetPost.isMine && (() => {
                const post = sheetPost, target = { type: "post" as const, id: post.id, what: "post", authorName: post.author.displayName || "York Student", preview: post.body.split("\n\n")[0] };
                return <><button type="button" onClick={() => { setSheetPost(null); openReport(target); }}>Report</button>{!guest && <button type="button" className="danger-text" onClick={() => { setSheetPost(null); blockAuthor(target); }}>Block</button>}</>;
              })()}<button type="button" aria-label="Close comments" onClick={closeCommentsSheet}><X size={20} /></button></span></header>
              </div>
              <div className="mx-comments-list">{comments.length === 0 ? (commentsLoadedFor === sheetPost.id ? <p className="mx-note">No comments yet. Start the conversation.</p> : loadingRows("posts")) : commentThreads()}</div>
              {commentComposer}
            </div>
          </div>
        )}
        {/* Visitors: Sign up always in the top right corner. */}
        {guest && <button type="button" className="mx-guest-signup" onClick={() => leaveGuest("auth")}>Sign up</button>}
        <nav className="mx-rail" aria-label="CCConnect">
          {guest ? <span className="mx-logo" aria-hidden="true"><img src="/favicon.png" alt="" /><strong>ccconnect</strong></span> : <button type="button" className={railPanel === "profile" ? "mx-rail-me active" : "mx-rail-me"} aria-label="Profile" onClick={() => showPanel("profile")}><Avatar name={name} seed={name} /></button>}
{FEED_ENABLED ? (
          <button type="button" className={railPanel === "posts" ? "mx-rail-item active" : "mx-rail-item"} aria-label="Feed" onClick={() => showPanel("posts")}><Flame size={23} /><span>Feed</span></button>
          ) : (
          DEV_POSTS_ENABLED ? <button type="button" className={railPanel === "posts" ? "mx-rail-item active" : "mx-rail-item"} aria-label="Dev Posts" onClick={() => showPanel("posts")}><Newspaper size={23} /><span>Dev Posts</span></button> : null
          )}
          <button type="button" className={railPanel === "courses" ? "mx-rail-item active" : "mx-rail-item"} aria-label="Degree" onClick={() => { const wasCourses = railPanel === "courses"; showPanel("courses"); if (isWide() && wasCourses) shellOpenDegree(); }}><GraduationCap size={23} /><span>Degree</span></button>
          {!guest && <button type="button" className={railPanel === "alerts" ? "mx-rail-item active" : "mx-rail-item"} aria-label="Notifications" onClick={() => showPanel("alerts")}><Bell size={23} />{unreadNotifications > 0 && <b>{railBadge}</b>}<span>Alerts</span></button>}
          {guest && <button type="button" className="mx-rail-item" aria-label="Sign up" onClick={() => leaveGuest("auth")}><UserRound size={23} /><span>Sign up</span></button>}
          {/* CCConnect: no app page in the rail. */}
        </nav>
        <aside key={railPanel} className="mx-tree" aria-label="Your degree and courses" inert={mobileMain && !isWide()} onTouchStart={forwardStart} onTouchMove={forwardMove} onTouchEnd={forwardEnd} onTouchCancel={forwardEnd}>
          {railPanel === "posts" ? (
            !FEED_ENABLED ? <div className="mx-panel"><div className="mx-panel-head"><h2 className="mx-panel-title">Dev Posts</h2>{newPostButton}</div><div className="mx-feed">{feedList}</div></div>
            : <div className="mx-panel mx-feed-panel">{feedInPanel ? feedView : null}</div>
          ) : railPanel === "alerts" ? (
            <div className="mx-panel">
              <div className="mx-panel-head"><h2 className="mx-panel-title">Notifications</h2></div>
              <div className="mx-alerts">{notifications.length === 0 ? <div className="mx-chat-empty"><span aria-hidden="true"><Bell size={24} /></span><h3>You're all caught up</h3><p>Project room invites and course reminders show up here.</p></div> : renderNotificationList(notifications)}</div>
            </div>
          ) : railPanel === "profile" ? (
            <div className="mx-panel"><h2 className="mx-panel-title">My Profile</h2>{profileBody}</div>
          ) : railPanel === "app" ? (
            <div className="mx-panel"><h2 className="mx-panel-title">CCConnect App</h2>{appStatusBody}</div>
          ) : (<>
          {guest && <div className="mx-tree-brand"><img src="/favicon.png" alt="" /><strong>ccconnect</strong></div>}
          {guest || !DEGREE_FORUM ? (
            // Everyone sees a welcome card here (owner's call, Oct 28 2026; no degree / "Pick your program" card).
            // Visitors: tap it to sign up. Students: it opens the General Forum.
            <div className="mx-degree-card has-photo">
              <button type="button" className="mx-degree-open" onClick={() => { if (guest) leaveGuest("auth"); else shellOpenGeneral(); }}><strong>Welcome to CCConnect!</strong><span>{guest ? "York University · Sign up to post" : "York University"}</span></button>
            </div>
          ) : degree ? (
            <div className="mx-degree-card has-photo">
              <button type="button" className="mx-degree-open" onClick={shellOpenDegree}><strong>{degree.name}</strong><span>{degree.credentials || degree.code} · {degree.memberCount.toLocaleString()} student{degree.memberCount === 1 ? "" : "s"}</span></button>
              <button type="button" className="mx-degree-more" aria-label="Degree info" onClick={openDegreeInfo}><MoreVertical size={18} /></button>
            </div>
          ) : (
            <button type="button" className="mx-degree-card empty" onClick={() => { if (guest) { leaveGuest("auth"); return; } setDegreePickerOpen(true); loadDegrees(); setMobileMain(true); }}><strong>{guest ? "CCConnect" : "Pick your program"}</strong><span>{guest ? "York University" : "Join your program's forum"}</span>{!guest && <small>Tap to choose →</small>}</button>
          )}
          <label className="mx-search mx-tree-search"><Search size={16} aria-hidden="true" /><input value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} placeholder="Search your courses" /></label>
          <button type="button" className={chatShowing && tab === "general-forum" ? "mx-channel mx-general active" : "mx-channel mx-general"} onClick={shellOpenGeneral}><Newspaper size={18} /><span>General Forum</span></button>
          {!guest && <button type="button" className={chatShowing && tab === "events" ? "mx-channel mx-general active" : "mx-channel mx-general"} onClick={() => { shellOpenGeneral(); setTab("events"); }}><CalendarDays size={18} /><span>Events</span></button>}
          {!guest && <button type="button" className={chatShowing && tab === "clubs" ? "mx-channel mx-general active" : "mx-channel mx-general"} onClick={() => { shellOpenGeneral(); setClubView(null); setTab("clubs"); }}><UsersRound size={18} /><span>Clubs</span></button>}
          {!guest && <button type="button" className={chatShowing && tab === "assistant" ? "mx-channel mx-general active" : "mx-channel mx-general"} onClick={() => { shellOpenGeneral(); setTab("assistant"); }}><ClubSparkles size={18} /><span>Ask AI</span></button>}
          {DEGREE_FORUM && degree && !guest && <button type="button" className={onDegreePosts ? "mx-channel mx-general active" : "mx-channel mx-general"} onClick={shellOpenDegree}><Newspaper size={18} /><span>Degree Forum</span></button>}
          <div className="mx-section">
            {(() => {
              if (guest) {
                // Visitors: the courses they've looked at, newest first (kept on this device), plus + to find more.
                const order = [...(guestCourseIds() || [])].reverse();
                const recent = order.map((id) => shownCourses.find((group) => group.id === id)).filter((group): group is CourseGroup => Boolean(group));
                return <>
                  <div className="mx-section-head"><span>Recently visited</span><span className="mx-section-actions"><button type="button" aria-label="Find a course" onClick={() => shellGo("browse-courses")}><Plus size={17} /></button></span></div>
                  {recent.length === 0 && <p className="mx-tree-note">Courses you open show up here.</p>}
                  {recent.map((group) => <button type="button" key={group.id} className={inCourse && chatShowing && activeCourseGroup?.id === group.id ? "mx-channel mx-recent active" : "mx-channel mx-recent"} onClick={() => shellOpenCourse(group)}><Newspaper size={17} /><span>{courseLabel(group)}</span></button>)}
                </>;
              }
              return <div className="mx-section-head"><span>My courses</span><span className="mx-section-actions"><button type="button" aria-label="Add a course" onClick={() => shellGo("browse-courses")}><Plus size={17} /></button></span></div>;
            })()}
            {(guest ? [] : shownCourses).map((group) => {
              const open = openCourses.includes(group.id);
              const here = Boolean(inCourse && chatShowing && activeCourseGroup?.id === group.id);
              // A–Z, so opening a group (which bumps its activity) never reshuffles the list.
              const rooms = chatPreviews.projectRooms.filter((room) => room.courseGroupId === group.id).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
              const unread = (group.unreadCount || 0) + rooms.reduce((total, room) => total + (room.unreadCount || 0), 0);
              return (
                <div className="mx-course" key={group.id}>
                  <div className="mx-course-head">
                    <button type="button" className="mx-course-row" aria-expanded={open} onClick={() => setOpenCourses(open ? [] : [group.id])} {...chatMenuProps({ id: group.id, label: group.courseCode, group, course: true, ids: [group.id, ...rooms.map((room) => room.id)] })}><ChevronRight className={open ? "mx-caret open" : "mx-caret"} size={16} aria-hidden="true" /><span>{group.courseCode}{group.instructor && <small> · Prof. {group.instructor}</small>}</span>{isMuted(group.id) && <BellOff size={13} className="mx-channel-muted" aria-label="Muted" />}{!open && unread > 0 && <b className="mx-unread">{capCount(unread)}</b>}</button>
                    {!guest && <button type="button" className="mx-course-more" aria-label={`Options for ${group.courseCode}`} onClick={(event) => { event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); setChatMenu({ id: group.id, label: group.courseCode, group, course: true, ids: [group.id, ...rooms.map((room) => room.id)], x: box.right - 220, y: box.bottom, sheet: !isWide() }); }}><MoreHorizontal size={16} /></button>}

                    {courseAddMenu === group.id && (
                      <div className="mx-add-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                        <button type="button" role="menuitem" onClick={() => openDiscover(group)}><Compass size={17} /><span><strong>Discover groups</strong><small>Join or ask to join groups in {group.courseCode}</small></span></button>
                        <button type="button" role="menuitem" onClick={() => { setCourseAddMenu(null); setCourseHome(group); openProjectPicker("create", group); }}><Plus size={17} /><span><strong>Create group</strong><small>Private or professor group</small></span></button>
                      </div>
                    )}
                  </div>
                  {/* Always rendered so collapsing animates closed as well as open (grid rows 0fr <-> 1fr in shell.css). */}
                  <div className={open ? "mx-course-collapse open" : "mx-course-collapse"} inert={!open}>
                    <div className="mx-course-children">
                      <div className="mx-channel-wrap">
                        <button type="button" className={here && courseGroupView === "chat" ? "mx-channel active" : "mx-channel"} onClick={() => { if (!here) shellOpenCourse(group); else setMobileMain(true); setCourseGroupView("chat"); }} {...chatMenuProps({ id: group.id, label: `${group.courseCode} class-chat`, group })}>{COURSE_FORUM ? <Newspaper size={17} /> : <Hash size={17} />}<span>{COURSE_FORUM ? "forum" : "class-chat"}</span>{isMuted(group.id) && <BellOff size={13} className="mx-channel-muted" aria-label="Muted" />}{(group.unreadCount || 0) > 0 && !here && <b className={isMuted(group.id) ? "mx-unread soft" : "mx-unread"}>{capCount(group.unreadCount)}</b>}</button>
                        {!guest && <button type="button" className="mx-channel-more" aria-label={`Options for ${group.courseCode} class-chat`} onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setChatMenu({ id: group.id, label: `${group.courseCode} class-chat`, group, x: box.right, y: box.bottom, sheet: !isWide() }); }}><MoreHorizontal size={16} /></button>}
                      </div>
                      {notes.filter((note) => note.courseGroupId === group.id).map((note) => (
                        <div className="mx-channel-wrap" key={note.id}>
                          <button type="button" className={tab === "note" && chatShowing && activeNote?.id === note.id ? "mx-channel mx-note-row active" : "mx-channel mx-note-row"} onClick={() => openNote(note)} onContextMenu={(event) => { event.preventDefault(); deleteNote(note); }}><NotebookPen size={16} /><span>{note.name}</span></button>
                        </div>
                      ))}
                      {rooms.map((room) => (
                        <div className="mx-channel-wrap" key={room.id}>
                          <button type="button" className={inProject && activeProject?.id === room.id ? "mx-channel strong active" : room.unreadCount > 0 ? "mx-channel strong" : "mx-channel"} onClick={() => shellOpenProject(room)} {...chatMenuProps({ id: room.id, label: room.name, room })}>{room.isPublic ? <Users size={15} /> : <Lock size={15} />}<span>{room.name}</span>{isMuted(room.id) && <BellOff size={13} className="mx-channel-muted" aria-label="Muted" />}{room.unreadCount > 0 && !(inProject && chatShowing && activeProject?.id === room.id) && <b className={isMuted(room.id) ? "mx-unread soft" : "mx-unread"}>{capCount(room.unreadCount)}</b>}</button>
                          {!guest && <button type="button" className="mx-channel-more" aria-label={`Options for ${room.name}`} onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setChatMenu({ id: room.id, label: room.name, room, x: box.right, y: box.bottom, sheet: !isWide() }); }}><MoreHorizontal size={16} /></button>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {pendingRequests.filter((item) => item.requestedByMe).map((item) => (
              <div className="mx-course mx-course-pending" key={item.id}>
                <div className="mx-course-head"><button type="button" className="mx-course-row" onClick={() => shellGo("browse-courses")}><Clock size={15} aria-hidden="true" /><span>{item.courseCode}{item.instructor && <small> · Prof. {item.instructor}</small>}<em>Waiting for a classmate to join</em></span></button></div>
              </div>
            ))}
            {myCourses.length === 0 && !guest && <button type="button" className="mx-channel muted" onClick={() => shellGo("browse-courses")}><Plus size={16} /><span>Add your courses</span></button>}
          </div>
          </>)}
        </aside>
        {subFromFull && <div className="mx-under" aria-hidden="true" inert><section className="mx-page"><header className="mx-page-header"><span className="mx-page-back mx-menu-button"><Menu size={22} /></span><h2>My Profile</h2></header><div className="mx-page-scroll">{profileBody}</div></section></div>}
        <main className="mx-main" inert={!mobileMain && !isWide() && !drawer} onTouchStart={swipeStart} onTouchMove={swipeMove} onTouchEnd={swipeEnd} onTouchCancel={swipeEnd} key={mainKey} data-nav={navMotion.current.dir}>{main}</main>
        {renderOverlays()}
      </div>
    );
  };
  if (NEW_SHELL && tab !== "moderation") return renderShell();
  return (
    <main className={isNativeApp ? `dashboard app-shell ${appRootTab ? "app-root" : "app-detail"} app-tab-${tab}${ROOMS_ENABLED ? "" : " no-bell"}` : "dashboard"} onClick={() => { setOpenPostMenu(null); setOpenCommentMenu(null); setOpenActivityMenu(null); setNotificationsOpen(false); setSenderCard(null); }}>
      {isNativeApp && (appRootTab || tab === "create") && (
        // iOS app only: compact title bar (the website uses the sidebar and page intros instead).
        <header className="app-topbar">
          {tab === "create" ? <button type="button" className="app-topbar-text" onClick={() => setTab(homeTab(guest))}>Cancel</button> : null}
          {tab === "alerts" && !POSTS_ENABLED ? <button type="button" className="app-topbar-back" aria-label="Back" onClick={() => goTab(alertsReturn.current)}><ChevronLeft size={24} /></button> : null}
          {tab === "social" ? <span className="app-brand">ccconnect<span>.</span></span> : <h1>{appTitle}</h1>}
          <div className="app-topbar-actions">
            {POSTS_ENABLED && tab === "your-courses" && <button type="button" aria-label="Browse courses" onClick={() => setTab("browse-courses")}><Plus size={22} /></button>}
            {POSTS_ENABLED && tab === "browse-courses" && !guest && <button type="button" className="app-topbar-text" onClick={() => setTab("your-courses")}>Done</button>}
            {!POSTS_ENABLED && !guest && tab !== "alerts" && <button type="button" aria-label={unreadNotifications ? `Alerts, ${unreadNotifications} new` : "Alerts"} onClick={openAlerts}><Bell size={22} />{unreadNotifications > 0 && <span className="app-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>}</button>}
            {tab === "profile" && isAdmin && <button type="button" aria-label="Moderation" onClick={() => { setTab("moderation"); loadModeration().catch((error) => setNotice(error.message)); }}><ShieldCheck size={21} />{openReportCount > 0 && <span className="app-badge">{openReportCount > 99 ? "99+" : openReportCount}</span>}</button>}
          </div>
        </header>
      )}
      {isNativeApp && appRootTab && (
        // iOS app only: bottom tab bar.
        !POSTS_ENABLED ? (
          <nav className="app-tabbar three" aria-label="Main">
            <button type="button" className={tab === "your-courses" ? "active" : ""} onClick={() => { if (membersOnly("see your chats")) return; goTab("your-courses"); }}><MessageCircle size={23} /><span>Chats</span>{totalCourseUnread > 0 && <b className="app-badge">{totalCourseUnread > 99 ? "99+" : totalCourseUnread}</b>}</button>
            <button type="button" className={tab === "browse-courses" ? "active" : ""} onClick={() => goTab("browse-courses")}><Compass size={23} /><span>Discover</span></button>
            <button type="button" className={tab === "profile" || tab === "moderation" ? "active" : ""} onClick={() => guest ? leaveGuest("auth") : goTab("profile")}><UserRound size={23} /><span>{guest ? "Sign up" : "Profile"}</span></button>
          </nav>
        ) :
        <nav className="app-tabbar" aria-label="Main">
          <button type="button" className={tab === "social" ? "active" : ""} onClick={() => goTab("social")}><House size={23} /><span>Home</span></button>
          <button type="button" className={tab === "your-courses" || tab === "browse-courses" ? "active" : ""} onClick={() => goTab(guest ? "browse-courses" : "your-courses")}><MessageCircle size={23} /><span>Chats</span>{totalCourseUnread > 0 && <b className="app-badge">{totalCourseUnread > 99 ? "99+" : totalCourseUnread}</b>}</button>
          <button type="button" className="app-tabbar-create" aria-label="Create post" onClick={startNewPost}><Plus size={22} strokeWidth={2.6} /></button>
          {ROOMS_ENABLED ? <button type="button" className={tab === "rooms" ? "active" : ""} onClick={() => goTab("rooms")}><Users size={23} /><span>Rooms</span></button> : <button type="button" className={tab === "alerts" ? "active" : ""} onClick={() => { if (membersOnly("see notifications")) return; openAlerts(); }}><Bell size={23} /><span>Alerts</span>{unreadNotifications > 0 && <b className="app-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</b>}</button>}
          <button type="button" className={tab === "profile" || tab === "moderation" ? "active" : ""} onClick={() => guest ? leaveGuest("auth") : goTab("profile")}><UserRound size={23} /><span>{guest ? "Sign up" : "Profile"}</span></button>
        </nav>
      )}
      <aside className="sidebar">
        <div>
          <span className="brand">
            MIXBY<span>.</span>
          </span>
          <span className="campus">York University</span>
        </div>
        <nav className="side-nav">
          {POSTS_ENABLED && <button
            className={(tab === "social" || tab === "post") && !roomsOpen ? "active" : ""}
            onClick={() => closeRooms(() => { leaveRoom(); setTab("social"); })}
          >
            <Icon>◌</Icon> Social
          </button>}
          {ROOMS_ENABLED && <button
            className={tab === "rooms" && !roomsOpen ? "active" : ""}
            onClick={() => closeRooms(() => { leaveRoom(); setTab("rooms"); })}
          >
            <Icon>users</Icon> Rooms
          </button>}
          <button
            className={tab === "browse-courses" ? "active" : ""}
            onClick={() => closeRooms(() => { leaveRoom(); setTab("browse-courses"); })}
          >
            <Icon>compass</Icon> {POSTS_ENABLED ? "Browse Courses" : "Discover"}
          </button>
          {!guest && <button
            className={tab === "your-courses" || tab === "course-home" || tab === "project-room" ? "active" : ""}
            onClick={() => closeRooms(() => { leaveRoom(); setTab("your-courses"); })}
          >
            <Icon>cap</Icon> Your Courses
            {totalCourseUnread > 0 && <span className="side-nav-count" aria-label={`${totalCourseUnread} unread`}>{totalCourseUnread > 99 ? "99+" : totalCourseUnread}</span>}
          </button>}
          {isAdmin && <button
            className={tab === "moderation" ? "active" : ""}
            onClick={() => closeRooms(() => { leaveRoom(); setTab("moderation"); loadModeration().catch((error) => setNotice(error.message)); })}
          >
            <span className="icon" aria-hidden="true"><ShieldCheck size={18} strokeWidth={2} /></span> Moderation
            {openReportCount > 0 && <span className="side-nav-count" aria-label={`${openReportCount} open reports`}>{openReportCount > 99 ? "99+" : openReportCount}</span>}
          </button>}
        </nav>
        {guest ? (
          <button className="account-link guest-account" onClick={() => leaveGuest("auth")}>
            <span className="avatar guest-avatar" aria-hidden="true"><UserRound size={16} /></span>
            <span className="account-link-text"><strong>Browsing as guest</strong><small>Sign up with your York email</small></span>
            <ChevronRight size={16} className="account-link-chevron" aria-hidden="true" />
          </button>
        ) : (
          <button className={tab === "profile" ? "account-link active" : "account-link"} onClick={() => closeRooms(() => { leaveRoom(); setTab("profile"); })} aria-label="Open profile">
            <Avatar name={identity.displayName || account?.email.split("@")[0]} />
            <span className="account-link-text"><strong>{identity.displayName || account?.email.split("@")[0]}</strong><small>{account?.email}</small></span>
            <ChevronRight size={16} className="account-link-chevron" aria-hidden="true" />
          </button>
        )}
      </aside>
      {notice && (
        <div className="toast" role="status" onClick={(event) => event.stopPropagation()}>
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice("")}><X size={16} /></button>
        </div>
      )}
      {!guest && !(isNativeApp && !ROOMS_ENABLED) && <div className="notifications">
        <button type="button" className="notifications-button" aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : "Notifications"} aria-expanded={notificationsOpen} onClick={(event) => { event.stopPropagation(); toggleNotifications(); }}>
          <Bell size={19} />
          {unreadNotifications > 0 && <span className="notifications-badge">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>}
        </button>
        {notificationsOpen && (
          <div className="notifications-panel" role="dialog" aria-label="Notifications" onClick={(event) => event.stopPropagation()}>
            <header><h2>Notifications</h2></header>
            {notifications.length === 0 ? (
              <div className="notifications-empty">
                <span aria-hidden="true"><Bell size={20} /></span>
                <strong>You're all caught up</strong>
                <p>When someone comments on your post, it'll show up here.</p>
              </div>
            ) : (
              <div className="notifications-list">
                {notifications.map(renderNotification)}
              </div>
            )}
          </div>
        )}
      </div>}
      <section className="dashboard-main">
        <header className="topbar">
          <div className="topbar-actions">
            {!guest && <button type="button" className="profile-menu" onClick={() => closeRooms(() => { leaveRoom(); setTab("profile"); })} aria-label="Open profile">
              <Avatar name={identity.displayName || account?.email.split("@")[0]} />
            </button>}
          </div>
        </header>
        {postingBannedUntil && (
          <div className="guest-banner ban-banner" role="status">
            <span className="guest-banner-icon" aria-hidden="true"><Ban size={18} /></span>
            <p><strong>You can't post or send messages until {formatBanDate(postingBannedUntil)}.</strong> You can still browse, read and join groups.</p>
          </div>
        )}
        {guest && (
          <div className="guest-banner">
            <span className="guest-banner-icon" aria-hidden="true"><UserRound size={18} /></span>
            <p><strong>You're browsing as a guest.</strong> Sign up with your York email to {POSTS_ENABLED ? "post, comment and " : ""}join {ROOMS_ENABLED ? "Rooms and courses" : "course chats"}.</p>
            <div>
              <button type="button" className="text-button" onClick={() => leaveGuest("login")}>Log in</button>
              <button type="button" className="post-button" onClick={() => leaveGuest("auth")}>Sign up</button>
            </div>
          </div>
        )}
        {tab === "social" ? (
          <section className="social-page">
            <div className="page-intro">
              <p className="eyebrow">SOCIAL</p>
              <h1>What is happening at York?</h1>
              <p>Share updates, find communities, or meet new people.</p>
            </div>
            <div className="feed-toolbar">
              <label className="search feed-search">
                <span>⌕</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posts, people, or programs..." />
              </label>
              <button type="button" className="feed-create-post" onClick={startNewPost}>+ Create Post</button>
            </div>
            <div className="post-feed">
              {filteredPosts.length === 0 ? (
                <div className="feed-empty">
                  <span className="feed-empty-icon" aria-hidden="true"><MessageCircle size={22} /></span>
                  <h3>{search.trim() ? "No posts match that search." : "The feed is quiet right now."}</h3>
                  <p>{search.trim() ? "Try a different word, or start the conversation yourself." : "Be the first York student to post something today."}</p>
                  <button type="button" className="post-button" onClick={startNewPost}>Write the first post</button>
                </div>
              ) : (
                filteredPosts.map((post) => {
                  const [title, ...bodyParts] = post.body.split("\n\n");
                  return <article
                    className={`post-card post-${post.kind}${post.imageUrls?.length ? " has-images" : ""}`}
                    key={post.id}
                    onClick={() => openComments(post)}
                  >
                    <div className="post-content">
                      <header>
                        <div>
                          <button type="button" className="post-author-button" disabled={post.isMine} aria-label={`${post.author.displayName || "York Student"}: options`} onClick={(event) => toggleSenderCard(`post-${post.id}`, event)}>
                            <Avatar name={post.author.displayName || "York Student"} seed={post.author.displayName || post.id} />
                            <strong>{post.author.displayName || "York Student"}</strong>
                          </button>
                          {senderCard === `post-${post.id}` && <SenderConsole anchor={senderAnchor} name={post.author.displayName || "York Student"} seed={post.author.displayName || post.id} bio={post.author.bio} onClose={() => setSenderCard(null)} onReport={() => openReport({ type: "post", id: post.id, what: "post", authorName: post.author.displayName || "York Student", preview: post.body.split("\n\n")[0] })} onBlock={() => blockAuthor({ type: "post", id: post.id, what: "post", authorName: post.author.displayName || "York Student", preview: post.body.split("\n\n")[0] })} />}
                          <time className="post-time" dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
                        </div>
                        {!guest && <div className="post-actions">
                          <button aria-label="Post actions" onClick={(event) => { event.stopPropagation(); setOpenPostMenu(openPostMenu === post.id ? null : post.id); }}>...</button>
                          {openPostMenu === post.id && <div className="post-actions-menu">{post.isMine ? <><button onClick={(event) => { event.stopPropagation(); editPost(post); }}>Edit</button><button onClick={(event) => { event.stopPropagation(); askDeletePost(post); setOpenPostMenu(null); }}>Delete</button></> : <><button onClick={(event) => { event.stopPropagation(); openReport({ type: "post", id: post.id, what: "post", authorName: post.author.displayName || "York Student", preview: post.body.split("\n\n")[0] }); }}>Report</button><button onClick={(event) => { event.stopPropagation(); blockAuthor({ type: "post", id: post.id, what: "post", authorName: post.author.displayName || "York Student", preview: post.body.split("\n\n")[0] }); }}>Block</button></>}</div>}
                        </div>}
                      </header>
                      <h3>{title}</h3>
                      {post.flair ? <span className={`post-label flair-${post.flair}`}>{flairLabel(post.flair)}</span> : post.kind !== "info" && <span className="post-label">{post.kind === "connection" ? "Campus crush" : post.kind}</span>}
                      {post.imageUrls?.length ? <ImageCarousel images={post.imageUrls} className="post-feed-images" /> : bodyParts.length > 0 && <p><LinkedText text={bodyParts.join("\n\n")} /></p>}
                      {post.externalUrl && (
                        <a
                          href={post.externalUrl}
                          onClick={(event) => event.stopPropagation()}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Visit community ↗
                        </a>
                      )}
                      <span className="comment-count">{post.commentCount} comment{post.commentCount === 1 ? "" : "s"}</span>
                      {post.kind === "connection" && !post.isMine && !guest && (
                        <footer>
                          <button
                            className="connect-button"
                            onClick={(event) => { event.stopPropagation(); connect(post.id); }}
                          >
                            Connect
                          </button>
                        </footer>
                      )}
                    </div>
                  </article>;
                })
              )}
            </div>
          </section>
        ) : tab === "rooms" ? (
          <section className="rooms-page">
            {activeRoom ? (
              <div className="room-chat">
                <header className="rooms-page-header">
                  <button type="button" className="rooms-page-back" aria-label="Back to Rooms" onClick={leaveRoom}><ChevronLeft size={20} /></button>
                  <span className="course-tile room-tile" aria-hidden="true">{activeRoom.isGeneral ? <Users size={18} /> : activeRoom.title.trim()[0]?.toUpperCase()}</span>
                  <div className="chat-header-title">
                    <h1>{activeRoom.title}</h1>
                    <p><span className="chat-live-dot" aria-hidden="true" />{roomCount} here now{activeRoom.host?.displayName ? ` · Hosted by ${activeRoom.host.displayName}` : ""}{activeRoom.expiresAt ? ` · ${closesIn(activeRoom.expiresAt)}` : ""}</p>
                  </div>
                </header>
                <div className="room-messages rooms-page-messages">
                  {roomMessages.length === 0 && <div className="chat-empty"><span className="feed-empty-icon" aria-hidden="true"><MessageCircle size={22} /></span><h3>Say something</h3><p>Be the first to start the conversation in this Room.</p></div>}
                  {roomMessages.map((message, index) => {
                    const previous = roomMessages[index - 1];
                    const { newDay, grouped } = chatMessageFlags(previous && { createdAt: previous.createdAt, mine: previous.mine, author: previous.authorAccountId || previous.author.displayName }, { createdAt: message.createdAt, mine: message.mine, author: message.authorAccountId || message.author.displayName });
                    return <Fragment key={message.id}>{newDay && <div className="chat-day-divider"><span>{chatDayLabel(message.createdAt)}</span></div>}<div className={`msg-row${message.mine ? " mine" : ""}${grouped ? " grouped" : ""}`}>{message.mine ? <Avatar name={message.author.displayName || undefined} seed={message.authorAccountId || message.id} /> : <button type="button" className="msg-avatar-button" aria-label={`${message.author.displayName || "York Student"}: options`} onClick={(event) => toggleSenderCard(message.id, event)}><Avatar name={message.author.displayName || undefined} seed={message.authorAccountId || message.id} /></button>}{senderCard === message.id && <SenderConsole anchor={senderAnchor} name={message.author.displayName || "York Student"} seed={message.authorAccountId || message.id} bio={message.author.bio} onClose={() => setSenderCard(null)} onReport={() => openReport({ type: "room_message", id: message.id, what: "message", authorName: message.author.displayName || "York Student", preview: message.body })} onBlock={() => blockAuthor({ type: "room_message", id: message.id, what: "message", authorName: message.author.displayName || "York Student", preview: message.body })} />}<div className="msg-content">{!message.mine && !grouped && <button type="button" className="msg-author" onClick={(event) => toggleSenderCard(message.id, event)}>{message.author.displayName || "York Student"}</button>}<p className={message.mine ? "mine" : ""}>{message.body}{message.attachmentUrl && (message.attachmentUrl.includes(".pdf") ? <a className="chat-file" href={message.attachmentUrl} target="_blank" rel="noreferrer">{message.attachmentName || "Attachment"}</a> : <img className="chat-image" src={message.attachmentUrl} alt={message.attachmentName || "Attachment"} />)}{message.pollOptions?.map((option) => <button className="chat-poll-option" type="button" key={option}>{option}</button>)}</p><time className="chat-time" dateTime={message.createdAt}>{chatTime(message.createdAt)}</time></div></div></Fragment>;
                  })}
                  <TypingIndicator typers={roomTypers} />
                </div>
                {guest ? <div className="guest-composer"><span>You're browsing as a guest.</span><button type="button" className="post-button" onClick={() => leaveGuest("auth")}>Sign up to chat</button></div> : postingBannedUntil ? <div className="guest-composer ban-composer"><span>You can't send messages until {formatBanDate(postingBannedUntil)}.</span></div> : <form className="chat-composer rooms-page-composer" onSubmit={sendRoomMessage}>
                  <textarea placeholder="Type a message" value={roomDraft} onChange={(event) => { setRoomDraft(event.target.value); signalRoomTyping(Boolean(event.target.value)); }} onInput={(event) => { const textarea = event.currentTarget; textarea.style.height = "0px"; textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`; }} onKeyDown={sendChatOnEnter} />
                  <button disabled={!roomDraft.trim()}>Send</button>
                </form>}
              </div>
            ) : (
              <>
                <div className="page-intro">
                  <p className="eyebrow">ROOMS</p>
                  <h1>Rooms</h1>
                  <p>Drop into a live conversation, or start a Room about anything.</p>
                </div>
                {!guest && <section className="course-section course-request room-start">
                  <h2>Start a Room</h2>
                  <p>Pick a topic and anyone at York can drop in and chat. Rooms close automatically 1 hour after they start.</p>
                  <form className="room-create" onSubmit={createRoom}>
                    <input placeholder="e.g. Study session for MATH 1300 midterm" maxLength={100} value={roomTitle} onChange={(event) => setRoomTitle(event.target.value)} required enterKeyHint={isNativeApp ? "done" : undefined} onKeyDown={(event) => { if (isNativeApp && event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
                    <button className="post-button">Start Room</button>
                  </form>
                </section>}
                <label className="search rooms-page-search">
                  <span>⌕</span>
                  <input value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} placeholder="Search Rooms" />
                </label>
                <h2 className="rooms-section-title">All Rooms · {rooms.length}</h2>
                <div className="rooms-page-list">
                  {rooms.filter((room) => room.title.toLowerCase().includes(roomSearch.toLowerCase())).length === 0 && <p className="empty-state">No Rooms match that search.</p>}
                  {rooms.filter((room) => room.title.toLowerCase().includes(roomSearch.toLowerCase())).map((room) => (
                    <button className={room.isGeneral ? "full-room-card general-room" : "full-room-card"} onClick={() => enterRoom(room, false)} key={room.id}>
                      <span className="course-tile room-tile" aria-hidden="true">{room.isGeneral ? <Users size={18} /> : room.title.trim()[0]?.toUpperCase()}</span>
                      <div className="room-card-content">
                        <strong>{room.title}</strong>
                        <div>
                          <span>{room.host?.displayName ? `Hosted by ${room.host.displayName}` : "Open Room"}</span>
                          <span>{room.expiresAt ? closesIn(room.expiresAt) : "No end date"}</span>
                        </div>
                      </div>
                      <div className="room-meta">
                        <span className={room.memberCount > 0 ? "room-members live" : "room-members"}>{room.memberCount} here</span>
                      </div>
                      <span className="course-row-open">Join<ChevronRight size={16} aria-hidden="true" /></span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        ) : tab === "browse-courses" && isNativeApp ? (() => {
          const query = courseQuery.trim().toLowerCase();
          const inTerm = (termName: string) => !discoverTerm || termName === discoverTerm;
          const available = [...courseGroups].sort((a, b) => discoverSort === "az" ? a.courseCode.localeCompare(b.courseCode) : b.memberCount - a.memberCount).filter((group) => inTerm(group.termName) && (!query || group.courseCode.toLowerCase().includes(query)));
          const requested = pendingRequests.filter((item) => inTerm(item.termName) && (!query || item.courseCode.toLowerCase().includes(query))).sort((a, b) => discoverSort === "az" ? a.courseCode.localeCompare(b.courseCode) : b.requesterCount - a.requesterCount);
          const activeFilters = (discoverFilter !== "available" ? 1 : 0) + (discoverTerm ? 1 : 0) + (discoverSort !== "members" ? 1 : 0);
          const rows = discoverFilter === "available" ? available : requested;
          return (
            // iOS app Discover: search, filter chips (Available / Requested / semester), one list, and a Request button.
            <section className="discover-page">
              <div className="discover-searchbar">
                <label className="chats-search"><Search size={17} aria-hidden="true" /><input value={courseQuery} onChange={(event) => setCourseQuery(event.target.value.toUpperCase())} placeholder="Search courses" /></label>
                <button type="button" className={activeFilters ? "discover-filter-button active" : "discover-filter-button"} aria-label={activeFilters ? `Filters, ${activeFilters} on` : "Filters"} onClick={() => setFiltersDraft({ show: discoverFilter, term: discoverTerm, sort: discoverSort })}><SlidersHorizontal size={19} />{activeFilters > 0 && <b>{activeFilters}</b>}</button>
              </div>
              <p className="discover-summary">{discoverFilter === "available" ? "Available" : "Requested"} · {discoverTerm || "All terms"} · {discoverSort === "az" ? "A–Z" : discoverFilter === "available" ? "Most members" : "Most requested"}</p>
              {discoverFilter === "requested" && !courseRequestsSetup ? <p className="discover-empty">Course requests aren't set up yet. Run migration 013.</p> : rows.length === 0 ? (
                <div className="discover-empty">
                  <strong>{query ? "No courses match that search" : discoverFilter === "available" ? "No courses here yet" : "No requested courses"}</strong>
                  <p>{discoverFilter === "available" ? "Can't find your course? Request it and it becomes official when a classmate joins." : "Courses students have asked for show up here until a second student joins."}</p>
                </div>
              ) : (
                <div className="discover-list">
                  {discoverFilter === "available" ? available.map((group) => (
                    <button type="button" className="discover-row" key={group.id} onClick={() => openCourseGroup(group)}>
                      <span className="chat-row-avatar" aria-hidden="true">{group.courseCode.split(" ")[0].slice(0, 2)}</span>
                      <span className="discover-row-main"><strong>{group.courseCode}</strong><em>{group.termName} · {group.memberCount} member{group.memberCount === 1 ? "" : "s"}</em></span>
                      <b className={group.joined ? "discover-pill joined" : "discover-pill"}>{group.joined ? "Open" : guest ? "View" : "Join"}</b>
                    </button>
                  )) : requested.map((item) => (
                    <div className="discover-row" key={item.id}>
                      <span className="chat-row-avatar requested" aria-hidden="true">{item.courseCode.split(" ")[0].slice(0, 2)}</span>
                      <span className="discover-row-main"><strong>{item.courseCode}</strong><em>{item.termName} · {item.requestedByMe ? "You requested it" : `${item.requesterCount} student${item.requesterCount === 1 ? "" : "s"} requested`}</em></span>
                      {item.requestedByMe ? <b className="discover-pill joined">Waiting</b> : <button type="button" className="discover-pill" onClick={() => { if (membersOnly("join requested courses")) return; joinRequestedCourse(item); }}>Join</button>}
                    </div>
                  ))}
                </div>
              )}
              {!guest && <button type="button" className="discover-request" onClick={() => { setCourseRequestCode(courseQuery.trim()); setCourseRequestTermId(currentTermId); setRequestPageOpen(true); }}><Plus size={18} />Request a course</button>}
            </section>
          );
        })() : tab === "browse-courses" ? (
          <section className="browse-courses-page">
            <div className="page-intro"><p className="eyebrow">BROWSE COURSES</p><h1>Find your courses.</h1><p>Search the current term catalogue and add a course, or request one that isn't there yet.</p></div>
            <label className="search course-search">
              <span>⌕</span>
              <input value={courseQuery} onChange={(event) => setCourseQuery(event.target.value.toUpperCase())} placeholder="Search courses, e.g. BIOL 1000" />
            </label>
            {!guest && <section className="course-section course-request">
              <h2>Request a Course</h2>
              <p>Pick the course and the semester you are taking it in. It waits in Requested Courses until another student joins it.</p>
              <form className="course-create course-request-form" onSubmit={requestCourse}>
                <label className="course-field">
                  <span>Course name</span>
                  <input value={courseRequestCode} onChange={(event) => setCourseRequestCode(event.target.value.toUpperCase())} placeholder="BIOL 1000" required />
                </label>
                <label className="course-field">
                  <span>Semester</span>
                  <select className="course-select" value={courseRequestTermId || currentTermId} onChange={(event) => setCourseRequestTermId(event.target.value)}>
                    {courseTerms.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}
                  </select>
                </label>
                <button className="post-button">Request Course</button>
              </form>
            </section>}
            <section className="course-section">
              <h2>{courseQuery.trim() ? `Available Courses · "${courseQuery.trim()}"` : "Available Courses"}</h2>
              {browseCourses.length === 0 ? (
                <p className="empty-state">
                  {courseGroups.length === 0 ? (isNativeApp ? "No courses have been set up this term yet. Request one below to get" : "No courses have been set up this term yet. Request one above to get")+" started." : courseQuery.trim() ? "No courses match that search." : "You have added every available course this term."}
                </p>
              ) : (
                <div className="course-list">
                  {browseCourses.map((group) => (
                    <button className="course-row" type="button" key={group.id} onClick={() => openCourseGroup(group)}>
                      <span className="course-tile" aria-hidden="true">{group.courseCode.split(" ")[0].slice(0, 4)}</span>
                      <span className="course-row-main"><strong>{group.courseCode}</strong><em>{group.termName} · {group.memberCount} member{group.memberCount === 1 ? "" : "s"}</em></span>
                      <span className="course-row-meta">{group.joined ? <b className="access-pill">Joined</b> : guest ? <b className="access-pill">View chat</b> : <b className="access-pill pending">{isNativeApp ? "Join" : "Not added"}</b>}<ChevronRight size={18} className="course-row-chevron" aria-hidden="true" /></span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section className="course-section">
              <h2>Requested Courses</h2>
              {!courseRequestsSetup ? (
                <p className="course-request-setup">Course requests are not set up yet. Run migration 013 on Supabase to enable this section.</p>
              ) : pendingRequests.length === 0 ? (
                <p className="empty-state">No courses are waiting to be joined.{guest ? "" : isNativeApp ? " Request one below." : " Request one above."}</p>
              ) : (
                <>
                  <p className="course-request-note">A requested course becomes official once another student joins it.</p>
                  <div className="course-list">
                    {pendingRequests.map((item) => (
                      <div className="course-row is-static" key={item.id}>
                        <span className="course-tile" aria-hidden="true">{item.courseCode.split(" ")[0].slice(0, 4)}</span>
                        <span className="course-row-main"><strong>{item.courseCode}</strong><em>{item.termName} · {item.requesterCount} student{item.requesterCount === 1 ? "" : "s"} requested</em></span>
                        <span className="course-row-meta">
                          <b className="access-pill pending">Pending</b>
                          {item.requestedByMe ? (
                            <em className="course-row-count">Waiting on another student</em>
                          ) : (
                            <button className="course-join-button" type="button" onClick={() => { if (membersOnly("join requested courses")) return; joinRequestedCourse(item); }}>Join &amp; make official</button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </section>
        ) : tab === "your-courses" && isNativeApp ? (
          // iOS app Chats list: course chats and project rooms together, newest first, with last-message previews.
          <section className="chats-page">
            <label className="chats-search"><Search size={17} aria-hidden="true" /><input value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} placeholder="Search chats" /></label>
            {(() => {
              const query = chatSearch.trim().toLowerCase();
              const items = [
                ...myCourses.map((group) => ({ key: `c-${group.id}`, title: group.courseCode, badge: group.courseCode.split(" ")[0].slice(0, 2), preview: chatPreviews.courses[group.id] || null, unread: group.unreadCount || 0, time: chatPreviews.courses[group.id]?.createdAt || "", open: () => openCourseGroup(group) })),
              ].filter((item) => !query || item.title.toLowerCase().includes(query))
                .sort((a, b) => (b.time ? new Date(b.time).getTime() : 0) - (a.time ? new Date(a.time).getTime() : 0));
              if (items.length === 0) return (
                <div className="chats-empty">
                  <strong>{query ? "No chats match that search" : "No chats yet"}</strong>
                  <p>{query ? "Try a course code." : "Add your courses to join their group chats."}</p>
                  {!query && <button type="button" className="post-button" onClick={() => setTab("browse-courses")}>Browse courses</button>}
                </div>
              );
              return (
                <div className="chats-list">
                  {items.map((item) => (
                    <button type="button" className="chat-row" key={item.key} onClick={item.open}>
                      <span className="chat-row-avatar" aria-hidden="true">{item.badge}</span>
                      <span className="chat-row-main">
                        <span className="chat-row-top"><strong>{item.title}</strong><time className={item.unread > 0 ? "unread" : ""}>{listTime(item.time)}</time></span>
                        <span className="chat-row-bottom">
                          <span className="chat-row-preview">{item.preview ? `${item.preview.mine ? "You" : item.preview.authorName}: ${item.preview.body}` : "No messages yet"}</span>
                          {item.unread > 0 && <b className="chat-row-badge">{item.unread > 99 ? "99+" : item.unread}</b>}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </section>
        ) : tab === "your-courses" ? (
          <section className="your-courses-page">
            <div className="page-intro"><p className="eyebrow">YOUR COURSES</p><h1>Your course access.</h1><p>Every course you added from Browse Courses, with your access status.</p></div>
            <div className="course-summary">
              <div><span>Courses</span><strong>{myCourses.length}</strong><small>this term</small></div>
              <div><span>Classmates</span><strong>{classmateCount}</strong><small>across your courses</small></div>
              <div><span>Term</span><strong>{currentTermName || "—"}</strong><small>current</small></div>
            </div>
            <section className="course-section">
              <h2>Access</h2>
              {myCourses.length === 0 ? (
                <p className="empty-state">You have not added any courses yet. Browse the catalogue to get started.</p>
              ) : (
                <div className="course-list">
                  {myCourses.map((group) => (
                    <div className="course-row" role="button" tabIndex={0} key={group.id} onClick={() => openCourseHome(group)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openCourseHome(group); } }}>
                      <span className="course-tile" aria-hidden="true">{group.courseCode.split(" ")[0].slice(0, 4)}</span>
                      <span className="course-row-main"><strong>{group.courseCode}</strong><em>{group.termName} · {group.memberCount} member{group.memberCount === 1 ? "" : "s"}</em></span>
                      <span className="course-row-meta">{(group.unreadCount || 0) > 0 && <span className="course-unread" aria-label={`${group.unreadCount} unread`}>{(group.unreadCount || 0) > 99 ? "99+" : group.unreadCount}{isNativeApp ? "" : " new"}</span>}<b className="access-pill">Access granted</b><button type="button" className="course-row-open" onClick={(event) => { event.stopPropagation(); openCourseGroup(group); }}>Open chat<ChevronRight size={16} aria-hidden="true" /></button></span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {upcomingCourses.length > 0 && (
              <section className="course-section">
                <h2>Upcoming</h2>
                <div className="course-list">
                  {upcomingCourses.map((item) => (
                    <div className="course-row is-static" key={item.id}>
                      <span className="course-tile" aria-hidden="true">{item.courseCode.split(" ")[0].slice(0, 4)}</span>
                      <span className="course-row-main"><strong>{item.courseCode}</strong><em>Requested for {item.termName}</em></span>
                      <span className="course-row-meta"><b className="access-pill pending">Starts {item.termName}</b></span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section className="course-section">
              <p className="course-add-hint">Looking for something new? <button type="button" onClick={() => setTab("browse-courses")}>Browse Courses</button></p>
            </section>
          </section>
        ) : tab === "moderation" && isAdmin ? (
          <section className="moderation-page">
            <div className="page-intro"><p className="eyebrow">MODERATION</p><h1>Reports</h1><p>Review what people reported, remove content, and ban accounts from posting for a set number of days.</p></div>
            <div className="mod-tabs" role="tablist">
              {([["open", `Open${openReportCount ? ` · ${openReportCount}` : ""}`], ["resolved", "Resolved"], ["bans", "Banned users"]] as const).map(([view, label]) => (
                <button key={view} type="button" role="tab" aria-selected={modView === view} className={modView === view ? "active" : ""} onClick={() => { setModView(view); loadModeration(view).catch((error) => setNotice(error.message)); }}>{label}</button>
              ))}
            </div>
            {modView === "bans" ? (
              modBans.length === 0 ? <p className="empty-state">Nobody is banned from posting right now.</p> : (
                <div className="mod-list">
                  {modBans.map((person) => (
                    <article className="mod-card mod-ban" key={person.id}>
                      <Avatar name={person.name} seed={person.name} />
                      <div><strong>{person.name}</strong><small>{person.email}</small><span className="mod-ban-until">Banned until {person.postingBannedUntil && formatBanDate(person.postingBannedUntil)}</span></div>
                      <button type="button" className="mod-action" onClick={() => person.id && setPostingBan(person.id, 0)}>Lift ban</button>
                    </article>
                  ))}
                </div>
              )
            ) : modReports.length === 0 ? <p className="empty-state">{modView === "open" ? "No open reports. Nice and quiet." : "No resolved reports yet."}</p> : (
              <div className="mod-list">
                {modReports.map((report) => (
                  <article className="mod-card" key={report.id}>
                    <header>
                      <span className="mod-type">{report.targetType.replace("_", " ")}</span>
                      <span className="mod-category">{REPORT_CATEGORIES.find((category) => category.id === report.category)?.label || report.reason}</span>
                      {report.status !== "open" && <span className={`mod-status ${report.status}`}>{report.status}</span>}
                      <time dateTime={report.createdAt}>{agoText(report.createdAt)}</time>
                    </header>
                    <blockquote className="report-quote"><strong>{report.reported?.name || "Unknown user"}</strong><span>{report.evidence.body || "(no text)"}</span>{report.evidence.imageUrl && <img src={report.evidence.imageUrl} alt="Reported attachment" />}</blockquote>
                    {report.reason.includes(":") && <p className="mod-details">"{report.reason.split(":").slice(1).join(":").trim()}"</p>}
                    <p className="mod-meta">Reported by <strong>{report.reporter?.name || "someone"}</strong>{report.reported?.postingBannedUntil && <> · <span className="mod-ban-until">{report.reported.name} is banned until {formatBanDate(report.reported.postingBannedUntil)}</span></>}</p>
                    {report.status === "open" && (
                      <footer>
                        <button type="button" className="mod-action danger-action" onClick={() => askConfirm({ title: "Remove this content?", message: "It's hidden for everyone and the report is closed.", action: "Remove" }).then((ok) => { if (ok) resolveReport(report, "remove"); })}><Trash2 size={15} /> Remove content</button>
                        {report.reported?.id && <button type="button" className="mod-action danger-action" onClick={() => { setBanReason(""); setBanOther(""); setBanTarget({ person: report.reported as ModPerson, reportId: report.id }); }}><Ban size={15} /> Ban from posting…</button>}
                        <button type="button" className="mod-action" onClick={() => resolveReport(report, "reviewed")}>Mark reviewed</button>
                        <button type="button" className="mod-action" onClick={() => resolveReport(report, "dismiss")}>Dismiss</button>
                      </footer>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : tab === "course-home" && courseHome ? (
          <section className="course-home-page">
            <header className="course-home-header">
              <button type="button" className="rooms-page-back" aria-label="Back to your courses" onClick={() => setTab("your-courses")}><ChevronLeft size={20} /></button>
              <span className="course-tile" aria-hidden="true">{courseHome.courseCode.split(" ")[0].slice(0, 4)}</span>
              <div><p className="eyebrow">YOUR COURSE</p><h1>{courseHome.courseCode}</h1><p>{courseHome.termName} · {courseHome.memberCount} member{courseHome.memberCount === 1 ? "" : "s"}</p></div>
            </header>
            <p className="course-home-label">PINNED</p>
            <button type="button" className="course-home-chat" onClick={() => openCourseGroup(courseHome)}>
              <span className="course-home-chat-icon" aria-hidden="true"><MessageCircle size={22} /></span>
              <span className="course-home-chat-text"><strong>Course group chat</strong><small>Everyone in {courseHome.courseCode}</small></span>
              {(courseGroups.find((group) => group.id === courseHome.id)?.unreadCount || 0) > 0 && <span className="course-unread">{courseGroups.find((group) => group.id === courseHome.id)?.unreadCount}{isNativeApp ? "" : " new"}</span>}
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <div className="course-home-section">
              <h2>Project rooms</h2>
              <button type="button" className="post-button" onClick={() => { if (!postingBannedUntil) openProjectPicker("create"); else setNotice("You can't create rooms while you're banned from posting."); }}><Plus size={16} /> New project room</button>
            </div>
            {projectSetupRequired ? <p className="course-request-setup">Project rooms aren't set up yet. Run migration 019 in Supabase.</p> : projectRooms.length === 0 ? (
              <div className="project-empty">
                <span className="feed-empty-icon" aria-hidden="true"><FolderKanban size={22} /></span>
                <strong>No project rooms yet</strong>
                <p>Got a group project? Make a private room and invite your group from {courseHome.courseCode}.</p>
              </div>
            ) : (
              <div className="project-list">
                {projectRooms.map((room) => {
                  const status = projectStatus(room);
                  return (
                    <button type="button" className="project-card" key={room.id} onClick={() => openProjectRoom(room.id)}>
                      <span className="project-card-main">
                        <strong>{room.name}</strong>
                        <small className={status.warn ? "warn" : ""}>{status.text}</small>
                      </span>
                      <span className="typing-avatars stacked project-avatars" aria-label={`${room.members.length} members`}>
                        {room.members.slice(0, 3).map((member) => <Avatar key={member.id} name={member.name} seed={member.name} className="typing-avatar" />)}
                        {room.members.length > 3 && <span className="typing-avatar-more">+{room.members.length - 3}</span>}
                      </span>
                      {room.unreadCount > 0 && <span className="course-unread">{capCount(room.unreadCount)}{isNativeApp ? "" : " new"}</span>}
                      <ChevronRight size={18} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            )}
            <p className="course-home-note">Project rooms are private: only people invited can see them. A room closes after 30 days without messages.</p>
          </section>
        ) : tab === "project-room" && activeProject ? (
          <section className="rooms-page project-page">
            <div className="room-chat project-chat">
              {isNativeApp && (() => { const group = courseGroups.find((candidate) => candidate.id === activeProject.courseGroupId); return group ? <div className="project-chips-slot">{renderCourseChips(group)}</div> : null; })()}
              <header className="rooms-page-header">
                <button type="button" className="rooms-page-back" aria-label="Back to the course" onClick={closeProjectRoom}><ChevronLeft size={20} /></button>
                <span className="course-tile room-tile" aria-hidden="true"><FolderKanban size={18} /></span>
                <div className="chat-header-title">
                  <h1>{activeProject.name}</h1>
                  <p>{activeProject.members.length} member{activeProject.members.length === 1 ? "" : "s"} · {projectStatus(activeProject).text}</p>
                </div>
                <button type="button" className="project-manage-button" aria-expanded={projectPanelOpen} onClick={() => { setProjectPanelOpen((open) => !open); setProjectRenameDraft(activeProject.name); }}>{isNativeApp ? <Settings2 size={21} aria-label="Room info" /> : <><Settings2 size={17} /> Members</>}</button>
              </header>
              {projectPanelOpen && isNativeApp && (
                // iOS app: room settings as a full page (website keeps the pop-over panel below).
                <section className="room-info-page" aria-label="Room info">
                  <header className="room-info-header">
                    <button type="button" aria-label="Back to the room" onClick={() => setProjectPanelOpen(false)}><ChevronLeft size={22} /></button>
                    <h2>Room info</h2>
                  </header>
                  <div className="room-info-scroll">
                    <div className="room-info-hero">
                      <span className="room-info-icon" aria-hidden="true"><FolderKanban size={30} /></span>
                      <h1>{activeProject.name}</h1>
                      <p>{courseGroups.find((group) => group.id === activeProject.courseGroupId)?.courseCode || "Project room"} · {activeProject.members.length} member{activeProject.members.length === 1 ? "" : "s"}</p>
                    </div>
                    {activeProject.isCreator && (
                      <>
                        <h3 className="room-info-label">Name</h3>
                        <form className="room-info-card room-info-rename" onSubmit={renameProject}>
                          <input aria-label="Room name" maxLength={60} value={projectRenameDraft} onChange={(event) => setProjectRenameDraft(event.target.value)} />
                          <button disabled={!projectRenameDraft.trim() || projectRenameDraft.trim() === activeProject.name}>Save</button>
                        </form>
                      </>
                    )}
                    <h3 className="room-info-label">Members · {activeProject.members.length}</h3>
                    <ul className="room-info-card room-info-members">
                      {activeProject.isCreator && !activeProject.isPublic && (
                        <li><button type="button" className="room-info-invite" onClick={() => openProjectPicker("invite", courseGroups.find((group) => group.id === activeProject.courseGroupId) || courseHome)}><span className="room-info-invite-icon" aria-hidden="true"><Plus size={20} /></span>Invite classmates</button></li>
                      )}
                      {activeProject.members.map((member) => (
                        <li key={member.id}>
                          <Avatar name={member.name} seed={member.name} />
                          <span className="room-info-name">{member.name}{member.id === account?.id ? " (you)" : ""}</span>
                          {member.isCreator ? <em>Creator</em> : activeProject.isCreator && <button type="button" className="room-info-remove" onClick={() => { askConfirm({ title: `Remove ${member.name}?`, message: `They'll be taken out of ${activeProject.name}.`, action: "Remove" }).then((ok) => { if (ok) removeProjectMember(member.id); }); }}>Remove</button>}
                        </li>
                      ))}
                    </ul>
                    {(activeProject.pendingInvites?.length || 0) > 0 && (
                      <>
                        <h3 className="room-info-label">Invited · waiting to accept</h3>
                        <ul className="room-info-card room-info-members">
                          {activeProject.pendingInvites?.map((invite) => (
                            <li key={invite.id}>
                              <Avatar name={invite.name} seed={invite.name} />
                              <span className="room-info-name pending">{invite.name}</span>
                              {activeProject.isCreator ? <button type="button" className="room-info-remove" onClick={() => cancelInvite(invite)}>Cancel</button> : <em>Invited</em>}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <div className="room-info-card room-info-danger">
                      {canDeleteGroup(activeProject)
                        ? <button type="button" onClick={deleteProject}>Delete room</button>
                        : <button type="button" onClick={() => { if (account) askConfirm({ title: `Leave ${activeProject.name}?`, message: activeProject.isPublic ? "You can join again from Discover." : "You'll need a new invite to come back.", action: "Leave group" }).then((ok) => { if (ok) removeProjectMember(account.id); }); }}>Leave room</button>}
                    </div>
                    <p className="room-info-note">Only members can see this room. Invited classmates join when they accept. It closes after 30 days without messages.</p>
                  </div>
                </section>
              )}
              {projectPanelOpen && !isNativeApp && (
                <aside className="project-panel" aria-label="Project room members">
                  <h2>Members</h2>
                  <ul>
                    {activeProject.members.map((member) => (
                      <li key={member.id}>
                        <Avatar name={member.name} seed={member.name} />
                        <span>{member.name}{member.id === account?.id ? " (you)" : ""}</span>
                        {member.isCreator ? <em>Creator</em> : activeProject.isCreator && <button type="button" onClick={() => removeProjectMember(member.id)}>Remove</button>}
                      </li>
                    ))}
                  </ul>
                  {(activeProject.pendingInvites?.length || 0) > 0 && <p className="project-pending">Invited (waiting to accept): {activeProject.pendingInvites?.map((invite) => invite.name).join(", ")}</p>}
                  {activeProject.isCreator ? (
                    <>
                      {!activeProject.isPublic && <button type="button" className="post-button" onClick={() => openProjectPicker("invite")}><Plus size={15} /> Invite classmates</button>}
                      <form className="project-rename" onSubmit={renameProject}><input aria-label="Room name" maxLength={60} value={projectRenameDraft} onChange={(event) => setProjectRenameDraft(event.target.value)} /><button className="mod-action" disabled={!projectRenameDraft.trim() || projectRenameDraft.trim() === activeProject.name}>Rename</button></form>
                      {canDeleteGroup(activeProject) ? <button type="button" className="mod-action danger-action" onClick={deleteProject}>Delete room</button> : <button type="button" className="mod-action danger-action" onClick={() => { if (account) askConfirm({ title: `Leave ${activeProject.name}?`, message: "You can join again from Discover.", action: "Leave group" }).then((ok) => { if (ok) removeProjectMember(account.id); }); }}>Leave room</button>}
                    </>
                  ) : (
                    <button type="button" className="mod-action danger-action" onClick={() => account && removeProjectMember(account.id)}>Leave room</button>
                  )}
                </aside>
              )}
              <div className="room-messages rooms-page-messages">
                {projectMessages.length === 0 && !chatLoading && <div className="chat-empty"><span className="feed-empty-icon" aria-hidden="true"><FolderKanban size={22} /></span><h3>Kick off the project</h3><p>Only the people in this room can see these messages.</p></div>}
                {projectMessages.map((message, index) => {
                  const previous = projectMessages[index - 1];
                  const { newDay, grouped } = chatMessageFlags(previous && { createdAt: previous.createdAt, mine: previous.mine, author: previous.authorAccountId }, { createdAt: message.createdAt, mine: message.mine, author: message.authorAccountId });
                  const name = message.author.displayName || "York Student";
                  return <Fragment key={message.id}>{newDay && <div className="chat-day-divider"><span>{chatDayLabel(message.createdAt)}</span></div>}<div className={`msg-row${message.mine ? " mine" : ""}${grouped ? " grouped" : ""}`}>{message.mine ? <Avatar name={name} seed={message.authorAccountId} /> : <button type="button" className="msg-avatar-button" aria-label={`${name}: options`} onClick={(event) => toggleSenderCard(message.id, event)}><Avatar name={name} seed={message.authorAccountId} /></button>}{senderCard === message.id && <SenderConsole anchor={senderAnchor} name={name} seed={message.authorAccountId} bio={message.author.bio} onClose={() => setSenderCard(null)} onReport={() => openReport({ type: "project_message", id: message.id, what: "message", authorName: name, preview: message.body })} onBlock={() => blockAuthor({ type: "project_message", id: message.id, what: "message", authorName: name, preview: message.body })} />}<div className="msg-content">{!message.mine && !grouped && <button type="button" className="msg-author" onClick={(event) => toggleSenderCard(message.id, event)}>{name}</button>}<p className={message.mine ? "mine" : ""}><LinkedText text={message.body} /></p><time className="chat-time" dateTime={message.createdAt}>{chatTime(message.createdAt)}</time></div></div></Fragment>;
                })}
                <TypingIndicator typers={projectTypers} />
              </div>
              {postingBannedUntil ? <div className="guest-composer ban-composer"><span>You can't send messages until {formatBanDate(postingBannedUntil)}.</span></div> : <form className={projectDraft.trim() ? "chat-composer rooms-page-composer has-content" : "chat-composer rooms-page-composer"} onSubmit={sendProjectMessage}>
                <textarea placeholder={isNativeApp ? "Type a message" : `Message ${activeProject.name}`} maxLength={20000} value={projectDraft} onChange={(event) => { setProjectDraft(event.target.value); signalProjectTyping(Boolean(event.target.value)); }} onInput={(event) => { const textarea = event.currentTarget; textarea.style.height = "0px"; textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`; }} onKeyDown={sendChatOnEnter} />
                <button disabled={!projectDraft.trim()}>Send</button>
              </form>}
            </div>
          </section>
        ) : tab === "profile" ? (
          <section className="profile-page">
            <div className="profile-hero">
              <Avatar name={identity.displayName || account?.email.split("@")[0]} className="avatar-large profile-hero-avatar" />
              <div>
                <p className="eyebrow">YOUR MIXBY PROFILE</p>
                <h1>{identity.displayName || account?.email.split("@")[0] || "York Student"}</h1>
                <p>{account?.email}</p>
              </div>
            </div>
            <form className="profile-form" onSubmit={saveIdentity}>
              <div className="profile-form-heading"><div><h2>Profile details</h2><p>Update how you appear on CCConnect.</p></div><button className="post-button">Save profile</button></div>
              <label className="profile-wide">Username<input autoComplete="username" maxLength={32} value={identity.displayName} onChange={(event) => setIdentity((current) => ({ ...current, displayName: event.target.value }))} required /></label>
            </form>
            {POSTS_ENABLED && <section className="profile-activity">
              <button className="profile-activity-toggle" type="button" aria-expanded={showActivity} onClick={toggleProfileActivity}><span>Your posts and comments</span><span>{showActivity ? "−" : "+"}</span></button>
              {showActivity && (
                <div className="profile-activity-list">
                  {!profileActivity ? <p>Loading activity...</p> : <>
                    {profileActivity.posts.map((post) => <article key={`post-${post.id}`}><span>POST</span><div><strong>{post.body.split("\n\n")[0]}</strong><p>{post.body.split("\n\n").slice(1).join("\n\n")}</p></div><div className="activity-actions"><button aria-label="Post actions" onClick={(event) => { event.stopPropagation(); setOpenActivityMenu(openActivityMenu === post.id ? null : post.id); }}>...</button>{openActivityMenu === post.id && <div><button onClick={() => openComments(activityPostToPost(post))}>View</button><button onClick={() => editPost(activityPostToPost(post))}>Edit</button><button onClick={() => { setConfirmDeletePost(activityPostToPost(post)); setOpenActivityMenu(null); }}>Delete</button></div>}</div></article>)}
                    {profileActivity.comments.map((comment) => <article key={`comment-${comment.id}`}><span>COMMENT</span><div><strong>On: {comment.post?.body.split("\n\n")[0] || "Deleted post"}</strong><p>{comment.body}</p></div>{comment.post && <div className="activity-actions"><button aria-label="Comment actions" onClick={(event) => { event.stopPropagation(); setOpenActivityMenu(openActivityMenu === comment.id ? null : comment.id); }}>...</button>{openActivityMenu === comment.id && <div><button onClick={() => openComments(activityPostToPost({ ...comment.post!, created_at: comment.createdAt }))}>View post</button><button onClick={() => editActivityComment(comment)}>Edit</button><button onClick={() => deleteActivityComment(comment)}>Delete</button></div>}</div>}</article>)}
                    {profileActivity.posts.length === 0 && profileActivity.comments.length === 0 && <p>No activity yet.</p>}
                  </>}
                </div>
              )}
            </section>}
            {isNativeApp && (
              <section className="appearance-card">
                <h2>Appearance</h2>
                <div className="appearance-options" role="radiogroup" aria-label="Appearance">
                  <button type="button" role="radio" aria-checked={theme === "light"} className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><span className="appearance-swatch light" aria-hidden="true" />Light</button>
                  <button type="button" role="radio" aria-checked={theme === "dark"} className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><span className="appearance-swatch dark" aria-hidden="true" />Dark</button>
                </div>
              </section>
            )}
            <section className="blocked-card">
              <h2>Blocked people</h2>
              {blockedPeople.length === 0 ? <p>No one. To block someone, use Block on their post, comment or message.</p> : (
                <ul>
                  {blockedPeople.map((person) => (
                    <li key={person.id}><Avatar name={person.name} seed={person.name} /><span>{person.name}</span><button type="button" onClick={() => unblock(person)}>Unblock</button></li>
                  ))}
                </ul>
              )}
            </section>
            <section className="account-card">
              <div><strong>Verified York account</strong><span>{account?.email}</span></div>
              <button type="button" className="text-button" onClick={logout}>Sign out</button>
              <button type="button" className="text-button delete-account" onClick={deleteAccount}>Delete account</button>
            </section>
          </section>
        ) : tab === "alerts" ? (
          <section className="alerts-page">
            {notifications.length === 0 ? (
              <div className="notifications-empty">
                <span aria-hidden="true"><Bell size={20} /></span>
                <strong>You're all caught up</strong>
                <p>When someone comments on your post or adds you to a project room, it'll show up here.</p>
              </div>
            ) : (
              <div className="notifications-list">
                {notifications.map(renderNotification)}
              </div>
            )}
          </section>
        ) : tab === "post" && commentPost ? (
          <section className="post-detail-page">
            <article className={`post-detail post-${commentPost.kind}`}>
              <div className="post-detail-meta"><button className="back-to-feed" aria-label="Back to Social" onClick={() => { setCommentPost(null); setTab(homeTab(guest)); }}>←</button><header><button type="button" className="post-author-button" disabled={commentPost.isMine} aria-label={`${commentPost.author.displayName || "York Student"}: options`} onClick={(event) => toggleSenderCard(`postpage-${commentPost.id}`, event)}><Avatar name={commentPost.author.displayName || "York Student"} seed={commentPost.author.displayName || commentPost.id} /><strong>{commentPost.author.displayName || "York Student"}</strong></button>{senderCard === `postpage-${commentPost.id}` && <SenderConsole anchor={senderAnchor} name={commentPost.author.displayName || "York Student"} seed={commentPost.author.displayName || commentPost.id} bio={commentPost.author.bio} onClose={() => setSenderCard(null)} onReport={() => openReport({ type: "post", id: commentPost.id, what: "post", authorName: commentPost.author.displayName || "York Student", preview: commentPost.body.split("\n\n")[0] })} onBlock={() => blockAuthor({ type: "post", id: commentPost.id, what: "post", authorName: commentPost.author.displayName || "York Student", preview: commentPost.body.split("\n\n")[0] })} />}<time className="post-time" dateTime={commentPost.createdAt}>{timeAgo(commentPost.createdAt)}</time></header><div className="post-actions"><button aria-label="Post actions" onClick={(event) => { event.stopPropagation(); setOpenPostMenu(openPostMenu === commentPost.id ? null : commentPost.id); }}>...</button>{openPostMenu === commentPost.id && <div className="post-actions-menu">{commentPost.isMine ? <><button onClick={() => editPost(commentPost)}>Edit</button><button onClick={() => { setConfirmDeletePost(commentPost); setOpenPostMenu(null); }}>Delete</button></> : <button onClick={() => { openReport({ type: "post", id: commentPost.id, what: "post", authorName: commentPost.author.displayName || "York Student", preview: commentPost.body.split("\n\n")[0] }); }}>Report</button>}</div>}</div></div>
              <h1>{commentPost.body.split("\n\n")[0]}</h1>
              {commentPost.flair ? <span className={`post-label flair-${commentPost.flair}`}>{flairLabel(commentPost.flair)}</span> : commentPost.kind !== "info" && <span className="post-label">{commentPost.kind === "connection" ? "Campus crush" : commentPost.kind}</span>}
              {commentPost.imageUrls?.length ? <ImageCarousel images={commentPost.imageUrls} className="post-detail-images" /> : null}
              {commentPost.body.split("\n\n").slice(1).join("\n\n") && <p><LinkedText text={commentPost.body.split("\n\n").slice(1).join("\n\n")} /></p>}
              {commentPost.externalUrl && <a href={commentPost.externalUrl} target="_blank" rel="noreferrer">Visit community ↗</a>}
            </article>
            {guest ? <div className="guest-composer"><span>You're browsing as a guest.</span><button type="button" className="post-button" onClick={() => leaveGuest("auth")}>Sign up to comment</button></div> : postingBannedUntil ? <div className="guest-composer ban-composer"><span>You can't comment until {formatBanDate(postingBannedUntil)}.</span></div> : <form className="detail-comment-composer" onSubmit={addComment}>{replyTo && <span>Replying to {replyTo.authorName || "York Student"} <button type="button" onClick={() => setReplyTo(null)}>Cancel</button></span>}<input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength={20000} placeholder={replyTo ? "Write a reply" : "Join the conversation"} required /><button>Comment</button></form>}
            <section className="detail-comments">
              <div className="detail-comments-heading"><strong>Comments</strong><span>{comments.length}</span></div>
              {comments.length === 0 ? <p className="comments-empty">No comments yet. Start the conversation.</p> : renderComments(null)}
            </section>
          </section>
        ) : (
          <section className="create-post-page">
            <div className="page-intro">
              <p className="eyebrow">{editingPost ? "EDIT POST" : "CREATE POST"}</p>
              <h1>{editingPost ? "Update your post." : "Share with York."}</h1>
              <p>Ask a question, share what's happening on campus, or start a discussion.</p>
            </div>
            <form className="post-editor" onSubmit={publishPost}>
              <label><input aria-label="Title" placeholder="Title*" value={postTitle} onChange={(event) => setPostTitle(event.target.value)} maxLength={120} required /></label>
              <button type="button" className="flair-trigger" onClick={() => setShowFlairPicker(true)}>⌾ {postFlair ? flairLabel(postFlair) : "Add flair"}</button>
              {postKind === "connection" && <p className="crush-note">Campus Crush is a limited experiment and may be removed. Do not name, identify, or share private details about anyone. Keep it respectful: no harassment, targeting, or explicit content. Confirmed reports can lead to a ban from CCConnect. Posts may be removed at any time.</p>}
              <div className="post-body-field">
                <textarea ref={postBodyRef} aria-label="Body text" placeholder="Body text*" value={postBody} onChange={(event) => setPostBody(event.target.value)} maxLength={19000} required />
                <div className="post-toolbar" role="toolbar" aria-label="Formatting">
                  <label className={postImages.length >= MAX_POST_IMAGES ? "post-toolbar-button disabled" : "post-toolbar-button"} title={`Add images (up to ${MAX_POST_IMAGES})`}>
                    <ImageIcon size={18} />
                    <span className="sr-only">Add images</span>
                    <input type="file" multiple disabled={postImages.length >= MAX_POST_IMAGES} accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { choosePostImages(event.target.files); event.target.value = ""; }} />
                  </label>
                  <button type="button" className={linkFormOpen ? "post-toolbar-button active" : "post-toolbar-button"} title="Insert link" aria-label="Insert link" aria-expanded={linkFormOpen} onClick={() => setLinkFormOpen((open) => !open)}>
                    <Link2 size={18} />
                  </button>
                  {postBody.length > 18000 && <span className="post-toolbar-count">{postBody.length}/19000</span>}
                </div>
                {linkFormOpen && (
                  <div className="post-link-form">
                    <input autoFocus aria-label="Link URL" placeholder="https://..." value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); insertPostLink(); } }} />
                    <input aria-label="Link text (optional)" placeholder="Link text (optional)" value={linkText} onChange={(event) => setLinkText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); insertPostLink(); } }} />
                    <button type="button" className="post-button" onClick={insertPostLink}>Insert</button>
                  </div>
                )}
                {postImages.length > 0 && (
                  <div className="post-image-previews">
                    {postImages.map((image, imageIndex) => (
                      <div className="post-image-preview" key={image.src}>
                        <img src={image.src} alt={image.name || `Image ${imageIndex + 1}`} />
                        <button type="button" aria-label={`Remove image ${imageIndex + 1}`} onClick={() => setPostImages((current) => current.filter((_, i) => i !== imageIndex))}><X size={14} /></button>
                      </div>
                    ))}
                    <span className="post-image-count">{postImages.length}/{MAX_POST_IMAGES}</span>
                  </div>
                )}
              </div>
              {postKind === "community" && <label>Community link<input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://..." required /></label>}
              <footer><button type="button" className="text-button" onClick={() => setTab(homeTab(guest))}>Cancel</button><button className="post-button">{editingPost ? "Save changes" : "Post"}</button></footer>
            </form>
          </section>
        )}
      </section>
      {!(tab === "rooms" && activeRoom) && tab !== "course-group" && (
        <aside className="page-rail" aria-label="Community guidelines">
          <section className="rail-panel rail-guidelines">
            <p className="eyebrow">COMMUNITY GUIDELINES</p>
            <h2>Keep CCConnect good for everyone.</h2>
            <p className="rail-guidelines-intro">CCConnect is an independent space for York students. These guidelines apply to posts, comments, course chats and Rooms.</p>
            <ol>
              <li><strong>Current launch access.</strong> Accounts are currently verified with a York email. Don't share your account or post on someone else's behalf.</li>
              <li><strong>Be kind.</strong> Disagree with ideas, not people. No harassment, bullying, threats, or hate based on identity.</li>
              <li><strong>Respect privacy.</strong> Don't name, identify, or share private details about anyone without their consent, including photos and screenshots of chats.</li>
              <li><strong>Keep it appropriate.</strong> No sexual or explicit content, graphic violence, or anything promoting self-harm.</li>
              <li><strong>Academic honesty.</strong> Study together and share notes, but don't share exam answers, sell assignments, or help others cheat.</li>
              <li><strong>No spam or scams.</strong> No repeated self-promotion, misleading links, or selling things that break York policy.</li>
              <li><strong>Report, don't escalate.</strong> If something feels off, report it instead of replying. Reports are reviewed by moderators.</li>
            </ol>
            <p className="rail-guidelines-footer">Breaking these guidelines can get posts removed or lead to a ban. If you're in immediate danger, contact York Security or call 911.</p>
          </section>
        </aside>
      )}
      {roomsOpen && (
        <aside className={closingRooms ? "rooms-drawer closing" : "rooms-drawer"} aria-label="Rooms">
          {activeRoom ? <>
            <header><button className="rooms-drawer-back" onClick={leaveRoom}>‹</button><div><p className="eyebrow">ROOM · {roomCount} HERE</p><h2>{activeRoom.title}</h2></div><button className="rooms-drawer-close" onClick={() => closeRooms(leaveRoom)}>Close</button></header>
            <div className="room-messages">
              {roomMessages.length === 0 && <p className="empty-state">Be the first to say something.</p>}
              {roomMessages.map((message) => <div className={message.mine ? "msg-row mine" : "msg-row"} key={message.id}><Avatar name={message.author.displayName || undefined} seed={message.authorAccountId || message.id} /><p className={message.mine ? "mine" : ""}><b>{message.author.displayName || "York Student"}</b>{message.body}{message.attachmentUrl && (message.attachmentUrl.includes(".pdf") ? <a className="chat-file" href={message.attachmentUrl} target="_blank" rel="noreferrer">{message.attachmentName || "Attachment"}</a> : <img className="chat-image" src={message.attachmentUrl} alt={message.attachmentName || "Attachment"} />)}{message.pollOptions?.map((option) => <button className="chat-poll-option" type="button" key={option}>{option}</button>)}</p></div>)}
              <TypingIndicator typers={roomTypers} />
            </div>
            <form className="chat-composer" onSubmit={sendRoomMessage}><textarea placeholder={roomPollOptions.length ? "Write your poll question" : "Type a message"} value={roomDraft} onChange={(event) => { setRoomDraft(event.target.value); signalRoomTyping(Boolean(event.target.value)); }} onInput={(event) => { const textarea = event.currentTarget; textarea.style.height = "0px"; textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`; }} onKeyDown={sendChatOnEnter} />{roomPollOptions.length > 0 && <span className="chat-selection">{roomPollOptions.length} poll options</span>}<button>Send</button></form>
          </> : <>
            <header><div><p className="eyebrow">ROOMS</p><h2>Open a Room</h2></div><button className="rooms-drawer-close" onClick={() => closeRooms()}>Close</button></header>
            <form className="rooms-drawer-create" onSubmit={createRoom}><input placeholder="Give your Room a topic" maxLength={100} value={roomTitle} onChange={(event) => setRoomTitle(event.target.value)} required /><button>Start</button></form>
            <label className="rooms-drawer-search"><span>⌕</span><input value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} placeholder="Search Rooms" /></label>
            <div className="rooms-drawer-list">{rooms.filter((room) => room.title.toLowerCase().includes(roomSearch.toLowerCase())).map((room) => <button onClick={() => enterRoom(room)} key={room.id}><span className="room-live" /><div><strong>{room.title}</strong><small>{room.memberCount} here</small></div><b>›</b></button>)}</div>
          </>}
        </aside>
      )}
      {tab === "course-group" && activeCourseGroup && (
        <aside className="room-drawer course-group-drawer">
          <header><button type="button" className="course-chat-back" aria-label={guest ? "Back to courses" : "Back"} onClick={() => closeRooms(() => { leaveRoom(); if (isNativeApp) setTab(guest ? "browse-courses" : "your-courses"); else if (!guest && courseHome && courseHome.id === activeCourseGroup.id) { setTab("course-home"); loadCourseHome(courseHome.id).catch(() => {}); } else setTab(guest ? "browse-courses" : "your-courses"); })}><ChevronLeft size={20} /></button><span className="course-tile chat-header-tile" aria-hidden="true">{activeCourseGroup.courseCode.split(" ")[0].slice(0, 4)}</span><div className="chat-header-title"><h2>{activeCourseGroup.courseCode}</h2><p><span className="chat-live-dot" aria-hidden="true" />{activeCourseGroup.termName} · {activeCourseGroup.memberCount} member{activeCourseGroup.memberCount === 1 ? "" : "s"}</p></div><div className="course-group-view-toggle" role="tablist" aria-label="Course view"><button className={courseGroupView === "chat" ? "active" : ""} type="button" role="tab" aria-selected={courseGroupView === "chat"} onClick={() => setCourseGroupView("chat")}>Chat</button><button className={courseGroupView === "pinned" ? "active" : ""} type="button" role="tab" aria-selected={courseGroupView === "pinned"} onClick={() => setCourseGroupView("pinned")}>Pinned</button></div>{isNativeApp && !guest && <button type="button" className="course-chat-info" aria-label="Course details" onClick={() => setCourseInfoOpen(true)}><Settings2 size={21} /></button>}</header>
          {isNativeApp && !guest && renderCourseChips(activeCourseGroup)}
          {isNativeApp && courseQrOpen && (
            // iOS app: a big QR code classmates can scan to join this course chat.
            <section className="room-info-page course-qr-page" aria-label="Course QR code">
              <header className="room-info-header">
                <button type="button" aria-label="Back to group info" onClick={() => setCourseQrOpen(false)}><ChevronLeft size={22} /></button>
                <h2>QR code</h2>
              </header>
              <div className="course-qr-body">
                <h1>{activeCourseGroup.courseCode}</h1>
                <p>{activeCourseGroup.termName}</p>
                <div className="course-qr-card"><CourseQr url={courseLink(activeCourseGroup.id)} /></div>
                <p className="course-qr-hint">Scan with your phone's camera to join the {activeCourseGroup.courseCode} chat on CCConnect.</p>
              </div>
            </section>
          )}
          {isNativeApp && courseInfoOpen && (
            // iOS app: course chat settings as a page (members, leave) instead of the website's course page.
            <section className="room-info-page" aria-label="Group info">
              <header className="room-info-header">
                <button type="button" aria-label="Back to the chat" onClick={() => setCourseInfoOpen(false)}><ChevronLeft size={22} /></button>
                <h2>Group info</h2>
              </header>
              <div className="room-info-scroll">
                <div className="room-info-hero">
                  <span className="room-info-icon course" aria-hidden="true">{activeCourseGroup.courseCode.split(" ")[0].slice(0, 4)}</span>
                  <h1>{activeCourseGroup.courseCode}</h1>
                  <p>{activeCourseGroup.termName} · {activeCourseGroup.memberCount} member{activeCourseGroup.memberCount === 1 ? "" : "s"}</p>
                  <button type="button" className="room-info-qr-button" onClick={() => setCourseQrOpen(true)}><QrCode size={18} />QR code</button>
                </div>
                <h3 className="room-info-label">Members · {activeCourseGroup.memberCount}</h3>
                <ul className="room-info-card room-info-members">
                  <li><Avatar name={identity.displayName || account?.email.split("@")[0]} /><span className="room-info-name">{identity.displayName || "You"} (you)</span></li>
                  {courseMembers === null && <li><span className="room-info-name">Loading…</span></li>}
                  {(courseMembers || []).map((member) => (
                    <li key={member.id}><Avatar name={member.name} seed={member.name} /><span className="room-info-name">{member.name}</span></li>
                  ))}
                </ul>
                <div className="room-info-card room-info-danger">
                  <button type="button" onClick={() => leaveCourseChat(activeCourseGroup)}>Leave course</button>
                </div>
                <p className="room-info-note">Everyone who added {activeCourseGroup.courseCode} this term is in this chat. Project rooms you're in stay after you leave.</p>
              </div>
            </section>
          )}
          <div className="room-messages">
              {visibleCoursePosts.map((post, index) => {
                const previous = visibleCoursePosts[index - 1];
                const { newDay, grouped } = chatMessageFlags(previous && { createdAt: previous.createdAt, mine: previous.isMine, author: previous.author?.displayName || "" }, { createdAt: post.createdAt, mine: post.isMine, author: post.author?.displayName || "" });
                return <Fragment key={post.id}>{newDay && post.createdAt && <div className="chat-day-divider"><span>{chatDayLabel(post.createdAt)}</span></div>}<div className={`msg-row${post.isMine ? " mine" : ""}${grouped ? " grouped" : ""}`}>{post.isMine ? <Avatar name={post.author?.displayName || undefined} seed={post.author?.displayName || post.id} /> : <button type="button" className="msg-avatar-button" aria-label={`${post.author?.displayName || "York Student"}: options`} onClick={(event) => toggleSenderCard(post.id, event)}><Avatar name={post.author?.displayName || undefined} seed={post.author?.displayName || post.id} /></button>}{senderCard === post.id && <SenderConsole anchor={senderAnchor} allowVoteMute name={post.author?.displayName || "York Student"} seed={post.author?.displayName || post.id} bio={post.author?.bio} onClose={() => setSenderCard(null)} onReport={() => openReport({ type: "course_message", id: post.id, what: "message", authorName: post.author?.displayName || "York Student", preview: post.body || post.attachmentName || "Image" })} onBlock={() => blockAuthor({ type: "course_message", id: post.id, what: "message", authorName: post.author?.displayName || "York Student", preview: post.body || post.attachmentName || "Image" })} />}<div className="course-post-content" {...holdToOpen(post)}>{(post.pinnedAt || (!post.isMine && !grouped)) && (post.isMine ? <span className="msg-author">{post.pinnedAt && <Pin className="pinned-icon" size={12} aria-label="Pinned" />}Pinned</span> : <button type="button" className="msg-author" onClick={(event) => toggleSenderCard(post.id, event)}>{post.pinnedAt && <Pin className="pinned-icon" size={12} aria-label="Pinned" />}{post.author?.displayName || "York Student"}</button>)}<p className={post.isMine ? "mine" : ""}>{post.body}{post.imageUrl && (post.kind === "image" ? <img className="chat-image" src={post.imageUrl} alt={post.attachmentName || "Attachment"} /> : <a className="chat-file" href={post.imageUrl} target="_blank" rel="noreferrer">{post.attachmentName || "Attachment"}</a>)}{post.pollOptions?.map((option) => <button className="chat-poll-option" type="button" key={option}>{option}</button>)}</p>{(post.reactions?.length || 0) > 0 && <div className="msg-reactions">{post.reactions?.map((reaction) => <button type="button" key={reaction.emoji} className={post.myReaction === reaction.emoji ? "mine" : ""} aria-label={`${reaction.emoji} ${reaction.count}`} onClick={() => reactToCoursePost(post, reaction.emoji)}>{reaction.emoji}{reaction.count > 1 && <span>{reaction.count}</span>}</button>)}</div>}{post.isMine && <button className="course-post-menu-trigger" type="button" aria-label="Message options" aria-expanded={coursePostMenuId === post.id} onClick={() => setCoursePostMenuId((current) => current === post.id ? null : post.id)}><ChevronDown size={15} /></button>}{post.isMine && coursePostMenuId === post.id && <div className="course-post-menu"><button type="button" onClick={() => toggleCoursePostPin(post)}>{post.pinnedAt ? "Unpin" : "Pin comment"}</button><button type="button" onClick={() => deleteCoursePost(post)}>Delete</button></div>}{post.createdAt && <time className="chat-time" dateTime={post.createdAt}>{chatTime(post.createdAt)}</time>}</div></div></Fragment>;
              })}
            {courseGroupView === "chat" && <TypingIndicator typers={courseGroupTypers} />}
          </div>
          {courseGroupView === "chat" && guest && <div className="guest-composer"><span>You're browsing as a guest.</span><button type="button" className="post-button" onClick={() => leaveGuest("auth")}>Sign up to chat</button></div>}
          {courseGroupView === "chat" && !guest && postingBannedUntil && <div className="guest-composer ban-composer"><span>You can't send messages until {formatBanDate(postingBannedUntil)}.</span></div>}
          {courseGroupView === "chat" && !guest && !postingBannedUntil && <form className={coursePostBody.trim() || courseAttachment || coursePollOptions.length ? "chat-composer has-content" : "chat-composer"} onSubmit={publishCoursePost}>
            {isNativeApp ? (
              // iOS app (WhatsApp-style): + attaches a photo or PDF straight away; the camera sits on the right until you type.
              <label className="composer-plus" aria-label="Attach a photo or PDF"><Plus size={26} strokeWidth={1.8} /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(event) => { chooseChatAttachment(event.target.files?.[0], setCourseAttachment); event.target.value = ""; }} /></label>
            ) : (
              <details className="chat-add"><summary aria-label="Add attachment"><ImagePlus size={18} /></summary><label><ImagePlus size={15} /> Image or PDF<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(event) => chooseChatAttachment(event.target.files?.[0], setCourseAttachment)} /></label></details>
            )}
            <textarea placeholder={coursePollOptions.length ? "Write your poll question" : "Type a message"} value={coursePostBody} onChange={(event) => { setCoursePostBody(event.target.value); signalCourseTyping(Boolean(event.target.value)); }} onInput={(event) => { const textarea = event.currentTarget; textarea.style.height = "0px"; textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`; }} onKeyDown={sendChatOnEnter} />
            {(courseAttachment || coursePollOptions.length > 0) && <span className="chat-selection">{courseAttachment?.name || `${coursePollOptions.length} poll options`}{courseAttachment && isNativeApp && <button type="button" className="chat-selection-clear" aria-label="Remove attachment" onClick={() => setCourseAttachment(null)}><X size={13} /></button>}</span>}
            {isNativeApp && <label className="composer-camera" aria-label="Take a photo"><Camera size={24} strokeWidth={1.8} /><input type="file" accept="image/*" capture="environment" onChange={(event) => { chooseChatAttachment(event.target.files?.[0], setCourseAttachment); event.target.value = ""; }} /></label>}
            <button>Send</button>
          </form>}
        </aside>
      )}
      {renderOverlays()}
    </main>
  );
}

const renderApp = () => createRoot(document.getElementById("app")!).render(<App />);
// App Store screenshot builds only (`--mode screenshots`): fake data and a self-running tour. Not in normal builds.
if (import.meta.env.VITE_SCREENSHOTS === "true") import("./screenshots").then(({ installScreenshotMode }) => { installScreenshotMode(); renderApp(); });
else renderApp();
