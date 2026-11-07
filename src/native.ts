// iOS app (Capacitor) setup. Does nothing on the website.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { PushNotifications } from "@capacitor/push-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";

// AppChromePlugin in AppDelegate.swift: strip colours, light/dark, and keyboard sizes for the new shell.
const AppChrome = registerPlugin<{
  set(options: { top?: string; bottom?: string; dark?: boolean; webKeyboard?: boolean; rail?: string; railWidth?: number }): Promise<void>;
  addListener(event: "keyboard", listener: (info: { height: number; duration: number }) => void): Promise<{ remove: () => Promise<void> }>;
}>("AppChrome");

export const isNativeApp = Capacitor.isNativePlatform();

if (isNativeApp) {
  // `html.native-app` scopes app-only CSS in social.css.
  document.documentElement.classList.add("native-app");
  // Saved Appearance (Profile → Appearance), applied before the first paint so dark mode never flashes white.
  try { if (localStorage.getItem("mixby-theme") === "dark") document.documentElement.classList.add("theme-dark"); } catch { /* private mode */ }
  // Stop iOS zooming the page when a small text field is focused.
  document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1.0");
  // Dark status bar text on the light page.
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  // Tapping a chat's send button keeps focus in the message box, so the keyboard stays up
  // (like WhatsApp) instead of closing and shifting the button away mid-tap.
  document.addEventListener("mousedown", (event) => {
    if ((event.target as Element | null)?.closest?.(".chat-composer > button, .mx-send")) event.preventDefault();
  }, true);
  // `html.keyboard-open` while the keyboard is up, so the bottom tab bar can hide instead of riding up with it.
  Keyboard.addListener("keyboardWillShow", () => document.documentElement.classList.add("keyboard-open"));
  Keyboard.addListener("keyboardWillHide", () => document.documentElement.classList.remove("keyboard-open"));
  // New shell: the web view stays full height and the page itself rides up with the keyboard (same duration),
  // so the message bar moves with the keyboard instead of jumping after it. Sizes come from AppChromePlugin.
  AppChrome.addListener("keyboard", ({ height, duration }) => {
    const root = document.documentElement.style;
    root.setProperty("--kb-dur", `${Math.max(duration, 0.1)}s`);
    root.setProperty("--kb", `${height}px`);
  }).catch(() => {});
}

// Push notifications (iOS app only). The server sends them for comments on your posts,
// being added to a project room, and new project room messages.
export type PushTap = { kind?: string; postId?: string; projectRoomId?: string; courseGroupId?: string };
let deviceToken = "";
let saveDeviceToken: ((token: string) => void) | null = null;
if (isNativeApp) {
  PushNotifications.addListener("registration", ({ value }) => {
    deviceToken = value;
    saveDeviceToken?.(value);
  });
}

// Asks once (iOS remembers the answer), then registers and hands the device token to `save`.
export async function enablePush(save: (token: string) => void) {
  if (!isNativeApp) return;
  saveDeviceToken = save;
  const { receive } = await PushNotifications.requestPermissions();
  if (receive === "granted") await PushNotifications.register();
}

export const currentDeviceToken = () => deviceToken;

// Taps on a notification, including the one that launched the app.
export function onPushTap(handler: (data: PushTap) => void) {
  if (!isNativeApp) return () => {};
  const listener = PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => handler(notification.data || {}));
  return () => { listener.then((handle) => handle.remove()); };
}

// Sign in with Google (iOS app): Google's native SDK via GoogleAuthPlugin in AppDelegate.swift.
// PhotoPickerPlugin in AppDelegate.swift (iOS app only): the camera or Apple's photo picker (full screen). Resolves with the photo shrunk to 2048px as a JPEG data URL, or nothing when cancelled.
export const PhotoPicker = registerPlugin<{ pick(options: { source: "camera" | "gallery" }): Promise<{ dataUrl?: string }> }>("PhotoPicker");
export const GoogleAuth = registerPlugin<{ signIn(options: { clientId: string; serverClientId?: string; hostedDomain?: string }): Promise<{ idToken: string }> }>("GoogleAuth");

// App chrome (iOS app only), AppChrome is declared at the top: colours behind the status bar and home indicator, and light/dark for the whole app
// (keyboard, alerts and pickers follow it). AppChromePlugin in AppDelegate.swift.
// rail/railWidth: the side rail's colour under the status bar and home indicator (left out = no rail piece).
export function setAppChrome(options: { top: string; bottom: string; dark: boolean; webKeyboard?: boolean; rail?: string; railWidth?: number }) {
  if (!isNativeApp) return;
  AppChrome.set(options).catch(() => {});
  StatusBar.setStyle({ style: options.dark ? Style.Dark : Style.Light }).catch(() => {});
}
