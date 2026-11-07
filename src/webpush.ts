// Installable website (Add to Home Screen) and its notifications (Web Push). Website only: the iPhone app uses
// native push (native.ts) and never registers the service worker.
import { isNativeApp } from "./native";

// Running as the installed Home Screen app (no browser bars)?
export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
export const isIOS = () =>
  typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
// Browsers that can get notifications from a website. On iPhone this is only true inside the Home Screen app (iOS 16.4+).
export const webPushSupported = () =>
  !isNativeApp && typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
export function registerServiceWorker() {
  if (isNativeApp || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  registration ||= navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
  return registration;
}

export async function currentSubscription() {
  if (!webPushSupported()) return null;
  const ready = await registerServiceWorker();
  return ready ? ready.pushManager.getSubscription() : null;
}

const keyBytes = (base64url: string) => {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

// Ask permission (must be called from a tap) and subscribe this browser. Returns the subscription, or a reason.
export async function subscribeToPush(publicKey: string): Promise<{ subscription?: PushSubscription; problem?: "unsupported" | "denied" | "failed" }> {
  if (!webPushSupported()) return { problem: "unsupported" };
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return { problem: "denied" };
  try {
    const ready = await registerServiceWorker();
    if (!ready) return { problem: "failed" };
    const existing = await ready.pushManager.getSubscription();
    const subscription = existing || await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    return { subscription };
  } catch {
    return { problem: "failed" };
  }
}

// A notification tapped while Mixby is open (the service worker sends it the notification's details).
export function onWebPushTap(handler: (data: { kind?: string; projectRoomId?: string; courseGroupId?: string; postId?: string }) => void) {
  if (isNativeApp || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  const listener = (event: MessageEvent) => { if (event.data?.type === "mixby-push-tap") handler(event.data.data || {}); };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}

// Android / desktop Chrome and Edge: the browser's own install prompt. It fires once, early, so it's caught here
// when the page loads and shown later from the "Add Mixby to Home Screen" button. iPhone never fires it.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== "undefined" && !isNativeApp) {
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event as InstallPromptEvent; installListeners.forEach((listener) => listener()); });
  window.addEventListener("appinstalled", () => { installPrompt = null; installListeners.forEach((listener) => listener()); });
}
export const canPromptInstall = () => Boolean(installPrompt);
export const onInstallChange = (listener: () => void) => { installListeners.add(listener); return () => { installListeners.delete(listener); }; };
export async function promptInstall() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }));
  installListeners.forEach((listener) => listener());
  return choice.outcome === "accepted";
}
