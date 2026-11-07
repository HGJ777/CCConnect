// Course notes, local first (owner's call, Oct 30 2026): what you write in a note is saved on this device straight
// away and shown at once; Mixby then syncs it to the cloud in the background (now, or when the connection is back),
// so the note opens on your other devices and its photos can be shared in the course forum.
//
// One IndexedDB database on the device ("mixby-note-photos", the name from when photos never left the phone):
//   photos    { id, noteId, dataUrl }           photos not uploaded yet (and old device-only ones)
//   snapshots { key: "<account>:<note>", entries } the note as the cloud last sent it, so it opens instantly
//   outbox    { id, account, noteId, ... }        changes made here that the cloud hasn't got yet, oldest first

export type SyncedEntry = { id: string; body: string; imageUrl: string | null; createdAt: string; pending?: boolean };
export type NoteOp =
  | { id: string; kind: "add"; account: string; noteId: string; body: string; photoId: string | null; createdAt: string }
  | { id: string; kind: "delete"; account: string; noteId: string; entryId: string; createdAt: string }
  | { id: string; kind: "photo"; account: string; noteId: string; entryId: string; photoId: string; createdAt: string };

export const DEVICE_PHOTO = "device:";
const photoCache = new Map<string, string>();

function store<T>(name: "photos" | "snapshots" | "outbox", mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const open = indexedDB.open("mixby-note-photos", 2);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" }).createIndex("noteId", "noteId");
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "key" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = run(db.transaction(name, mode).objectStore(name));
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
  });
}

// ---- Photos kept on the device until they're uploaded ----
export const cachedPhoto = (id: string) => photoCache.get(id);
export const savePhoto = (id: string, noteId: string, dataUrl: string) => { photoCache.set(id, dataUrl); return store("photos", "readwrite", (photos) => photos.put({ id, noteId, dataUrl })); };
export const loadPhoto = async (id: string) => photoCache.get(id) ?? (await store<{ dataUrl: string } | undefined>("photos", "readonly", (photos) => photos.get(id)).catch(() => undefined))?.dataUrl ?? null;
export const forgetPhoto = (id: string) => { photoCache.delete(id); return store("photos", "readwrite", (photos) => photos.delete(id)).catch(() => undefined); };

// ---- The note as the cloud last sent it ----
export const readNoteSnapshot = (account: string, noteId: string) => store<{ entries: SyncedEntry[] } | undefined>("snapshots", "readonly", (snapshots) => snapshots.get(`${account}:${noteId}`)).then((row) => row?.entries ?? null).catch(() => null);
export const writeNoteSnapshot = (account: string, noteId: string, entries: SyncedEntry[]) => store("snapshots", "readwrite", (snapshots) => snapshots.put({ key: `${account}:${noteId}`, entries })).catch(() => undefined);

// ---- Changes waiting for the cloud ----
export const queueOp = (op: NoteOp) => store("outbox", "readwrite", (outbox) => outbox.put(op));
export const dropOp = (id: string) => store("outbox", "readwrite", (outbox) => outbox.delete(id)).catch(() => undefined);
export const pendingOps = (account: string) => store<NoteOp[]>("outbox", "readonly", (outbox) => outbox.getAll()).then((ops) => ops.filter((op) => op.account === account).sort((a, b) => a.createdAt.localeCompare(b.createdAt))).catch(() => [] as NoteOp[]);

// What the note looks like here: the cloud's copy, minus entries deleted here, plus entries written here that the
// cloud hasn't got yet (shown as pending).
export function noteView(snapshot: SyncedEntry[], ops: NoteOp[], noteId: string): SyncedEntry[] {
  const mine = ops.filter((op) => op.noteId === noteId);
  const deleted = new Set(mine.flatMap((op) => op.kind === "delete" ? [op.entryId] : []));
  const added = mine.flatMap((op) => op.kind === "add" ? [{ id: op.id, body: op.body, imageUrl: op.photoId ? `${DEVICE_PHOTO}${op.photoId}` : null, createdAt: op.createdAt, pending: true }] : []);
  return [...snapshot.filter((entry) => !deleted.has(entry.id)), ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Everything for a deleted note: its outbox changes and photos (the snapshot is overwritten if it ever comes back).
export async function forgetNote(account: string, noteId: string) {
  for (const op of await pendingOps(account)) if (op.noteId === noteId) await dropOp(op.id);
  const ids = await store<IDBValidKey[]>("photos", "readonly", (photos) => photos.index("noteId").getAllKeys(noteId)).catch(() => [] as IDBValidKey[]);
  await Promise.all(ids.map((id) => forgetPhoto(String(id))));
}
