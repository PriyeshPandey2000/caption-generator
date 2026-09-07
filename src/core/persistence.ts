import {
  TranscriptionResult,
  GlobalStyle,
  WordStyle,
  WordMotion,
  Composition,
} from "@/core/types";

const STORAGE_KEY = "captionlab_project_v1";

export interface PersistedGroupLayout {
  x: number;
  y: number;
  scale: number;
}

export interface PersistedProject {
  transcription: TranscriptionResult | null;
  globalStyle: GlobalStyle;
  composition?: Composition;
  speakerStyles: Record<string, Partial<WordStyle>>;
  speakerMotions: Record<string, Partial<WordMotion>>;
  groupLayouts: Record<string, PersistedGroupLayout>;
  savedAt: number;
}

export function saveProjectToStorage(
  data: Omit<PersistedProject, "savedAt">
): void {
  if (typeof window === "undefined") return;
  const payload: PersistedProject = { ...data, savedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // storage full or unavailable — do nothing, project still works in-memory
  }
}

export function loadProjectFromStorage(): PersistedProject | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedProject;
    if (!parsed || !parsed.globalStyle) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearProjectFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// --- Video persistence (IndexedDB) -------------------------------

const VIDEO_DB = "captionlab-video";
const VIDEO_STORE = "files";
const VIDEO_KEY = "current";

export interface PersistedVideo {
  blob: Blob;
  name: string;
  type: string;
}

function openVideoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VIDEO_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VIDEO_STORE)) {
        db.createObjectStore(VIDEO_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openVideoDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(VIDEO_STORE, mode);
    const store = tx.objectStore(VIDEO_STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Returns true when the video was persisted, false when it could not be saved
// (no IndexedDB, quota exceeded, private-mode blocking, etc.). Callers surface a
// warning so users aren't surprised when the file vanishes after a refresh.
export async function saveVideoToStorage(video: PersistedVideo): Promise<boolean> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return false;
  try {
    await withStore("readwrite", (store) => store.put(video, VIDEO_KEY));
    return true;
  } catch (err) {
    console.warn("CaptionLab: could not persist video to IndexedDB", err);
    return false;
  }
}

export async function loadVideoFromStorage(): Promise<PersistedVideo | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return null;
  try {
    const video = await withStore<PersistedVideo | undefined>(
      "readonly",
      (store) => store.get(VIDEO_KEY)
    );
    return video ?? null;
  } catch {
    return null;
  }
}

export async function clearVideoFromStorage(): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  try {
    await withStore("readwrite", (store) => store.delete(VIDEO_KEY));
  } catch {
    // ignore
  }
}
