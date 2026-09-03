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
