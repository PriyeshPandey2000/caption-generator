import {
  TranscriptionResult,
  GlobalStyle,
  WordStyle,
  WordMotion,
  Composition,
  DictionaryEntry,
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
  dictionary?: DictionaryEntry[];
  groupLayouts: Record<string, PersistedGroupLayout>;
  demoMode?: boolean;
  // The id of the project this snapshot belongs to. It's the stable scope for
  // IndexedDB bytes (video is per-tab, but a project's music track is keyed by
  // this id so two tabs editing different projects never overwrite each other).
  projectId?: string;
  savedAt: number;
}

export function saveProjectToStorage(
  data: Omit<PersistedProject, "savedAt">
): void {
  if (typeof window === "undefined") return;
  const payload: PersistedProject = { ...data, savedAt: Date.now() };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // storage full or unavailable — do nothing, project still works in-memory
  }
}

// True only when this page was reached by refreshing the current tab (navigation
// entry type "reload"). The persisted project + video blobs are meant to carry
// an in-progress edit across an accidental refresh — they must NOT outlive the
// session. sessionStorage is already per-tab, but a duplicated tab, a browser
// restore after a crash, or a back/forward traversal can resurrect stale data,
// so restore is deliberately limited to reload navigation.
export function canRestorePersistedProject(): boolean {
  if (typeof window === "undefined") return false;
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return nav?.type === "reload";
}

export function loadProjectFromStorage(): PersistedProject | null {
  if (typeof window === "undefined") return null;
  if (!canRestorePersistedProject()) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
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
    sessionStorage.removeItem(STORAGE_KEY);
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

// Returns true when the video was removed, false when deletion failed (no
// IndexedDB, transaction error, etc.). Callers surface a warning so a video
// can't silently survive a "New Project" and resurrect on the next reload.
export async function clearVideoFromStorage(): Promise<boolean> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return false;
  try {
    await withStore("readwrite", (store) => store.delete(VIDEO_KEY));
    return true;
  } catch (err) {
    console.warn("CaptionLab: could not remove video from IndexedDB", err);
    return false;
  }
}

// --- Background image persistence (IndexedDB) ---------------------
//
// A background image picked in the editor is exposed to the compositor as an
// object URL, but object URLs are per-document and die with the page. The bytes
// themselves are stored here (same DB/store as the video, different key) so a
// fresh object URL can be recreated on restore. The video's "current" key and
// the background image's "background-image" key never collide.

const BACKGROUND_KEY = "background-image";

export interface PersistedBackgroundImage {
  blob: Blob;
}

// Returns true when the image was persisted, false when it could not be saved
// (no IndexedDB, quota exceeded, private-mode blocking, etc.). Callers surface
// a warning so users aren't surprised when the background vanishes after a
// refresh.
export async function saveBackgroundImageToStorage(image: Blob): Promise<boolean> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return false;
  try {
    await withStore("readwrite", (store) =>
      store.put({ blob: image }, BACKGROUND_KEY)
    );
    return true;
  } catch (err) {
    console.warn("CaptionLab: could not persist background image to IndexedDB", err);
    return false;
  }
}

export async function loadBackgroundImageFromStorage(): Promise<Blob | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return null;
  try {
    const image = await withStore<PersistedBackgroundImage | undefined>(
      "readonly",
      (store) => store.get(BACKGROUND_KEY)
    );
    return image?.blob ?? null;
  } catch {
    return null;
  }
}

// Returns true when the image was removed, false when deletion failed. Cleared
// alongside the video on "New Project" so a stale image can't resurrect.
export async function clearBackgroundImageFromStorage(): Promise<boolean> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return false;
  try {
    await withStore("readwrite", (store) => store.delete(BACKGROUND_KEY));
    return true;
  } catch (err) {
    console.warn("CaptionLab: could not remove background image from IndexedDB", err);
    return false;
  }
}

// --- Background-music persistence (IndexedDB) ---------------------
//
// Mirrors the background image: the track's object URL is per-document, so the
// bytes live here and a fresh URL is recreated on restore. Unlike the video
// (which is per-tab by design) the track is scoped to the project id — the same
// id saved in the project snapshot — so two tabs editing different projects
// can't overwrite each other's music, and the project that uploaded the track
// is the one that can restore it across a reload.

const musicKey = (projectId: string) => `music:${projectId}`;

/**
 * Persists a music track's bytes under the given project's key.
 * @param projectId The project owning the track (used as the IndexedDB key).
 * @param track The music track bytes to store.
 * @returns True when persisted, false when storage is unavailable/full.
 */
export async function saveMusicToStorage(
  projectId: string,
  track: Blob
): Promise<boolean> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return false;
  try {
    await withStore("readwrite", (store) =>
      store.put({ blob: track }, musicKey(projectId))
    );
    return true;
  } catch (err) {
    console.warn("CaptionLab: could not persist music track to IndexedDB", err);
    return false;
  }
}

/**
 * Loads the music track stored for the given project, if any.
 * @param projectId The project whose track should be loaded.
 * @returns The track bytes, or null when none is stored / storage is unavailable.
 */
export async function loadMusicFromStorage(
  projectId: string
): Promise<Blob | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return null;
  try {
    const track = await withStore<{ blob: Blob } | undefined>(
      "readonly",
      (store) => store.get(musicKey(projectId))
    );
    return track?.blob ?? null;
  } catch {
    return null;
  }
}

/**
 * Removes the music track stored for the given project. Returns true when the
 * track was removed, false when deletion failed. Cleared on "New Project" so a
 * stale track from an earlier project can't resurrect.
 * @param projectId The project whose track should be cleared.
 */
export async function clearMusicFromStorage(projectId: string): Promise<boolean> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return false;
  try {
    await withStore("readwrite", (store) => store.delete(musicKey(projectId)));
    return true;
  } catch (err) {
    console.warn("CaptionLab: could not remove music track from IndexedDB", err);
    return false;
  }
}
