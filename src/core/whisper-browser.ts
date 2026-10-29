import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface BrowserTranscription {
  words: WordTiming[];
  text: string;
  language: string;
  duration: number;
  device: "webgpu" | "wasm" | null;
}

export interface TranscribeInBrowserOptions {
  language?: string;
  onStatus?: (status: string) => void;
  onProgress?: (loaded: number, total: number, status: string) => void;
}

const SAMPLE_RATE = 16_000;

type Pending = {
  resolve: (result: BrowserTranscription) => void;
  reject: (error: Error) => void;
  onStatus?: (status: string) => void;
  onProgress?: (loaded: number, total: number, status: string) => void;
};

let worker: Worker | null = null;
let pending: Pending | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

// The model + ONNX sessions hold hundreds of MB for as long as the worker
// lives. Drop it when the user stops transcribing; the model itself stays in
// the browser Cache API, so the next job reloads without a network download.
const IDLE_UNLOAD_MS = 30_000;

function cancelIdleUnload(): void {
  if (idleTimer === null) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdleUnload(): void {
  cancelIdleUnload();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pending) return;
    worker?.terminate();
    worker = null;
  }, IDLE_UNLOAD_MS);
}

function getWorker(): Worker {
  if (worker) return worker;

  const next = new Worker(new URL("./whisper.worker.ts", import.meta.url), {
    type: "module",
  });

  next.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as {
      type?: string;
      message?: string;
      status?: string;
      loaded?: number;
      total?: number;
      progress?: number;
      device?: BrowserTranscription["device"];
      text?: string;
      duration?: number;
      language?: string;
      words?: WordTiming[];
    };

    if (data?.type === "progress") {
      // Only the aggregate `progress_total` counts. Per-file `progress` events
      // race with each other and reset the percentage whenever the next shard
      // starts, which makes the UI jump backwards.
      if (data.status === "progress_total") {
        pending?.onProgress?.(data.loaded ?? 0, data.total ?? 0, data.status);
      }
      return;
    }

    if (data?.type === "status" && data.message) {
      pending?.onStatus?.(data.message);
      return;
    }

    if (data?.type === "warning") {
      console.warn(data.message);
      return;
    }

    if (data?.type === "complete") {
      const job = pending;
      pending = null;
      job?.resolve({
        words: data.words ?? [],
        text: data.text ?? "",
        language: data.language ?? "auto",
        duration: data.duration ?? 0,
        device: data.device ?? null,
      });
      scheduleIdleUnload();
      return;
    }

    if (data?.type === "error") {
      const job = pending;
      pending = null;
      job?.reject(new Error(data.message || "Transcription failed"));
      scheduleIdleUnload();
    }
  });

  next.addEventListener("error", (event) => {
    const job = pending;
    pending = null;
    cancelIdleUnload();
    worker?.terminate();
    worker = null;
    job?.reject(new Error(event.message || "Transcription worker crashed"));
  });

  worker = next;
  return next;
}

function extensionOf(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext && /^[a-z0-9]{1,6}$/.test(ext) ? ext : "mp4";
}

// Fallback decoder. ffmpeg.wasm copies the whole container into its MEMFS
// heap before writing PCM, so only use it when the browser cannot decode the
// container natively.
async function decodeWithFfmpeg(file: File): Promise<Float32Array> {
  const ffmpeg = new FFmpeg();
  try {
    await ffmpeg.load();
    const inputName = `input.${extensionOf(file)}`;
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await ffmpeg.exec([
      "-i", inputName,
      "-vn",
      "-ar", String(SAMPLE_RATE),
      "-ac", "1",
      "-f", "f32le",
      "-c:a", "pcm_f32le",
      "audio.f32",
    ]);
    const data = (await ffmpeg.readFile("audio.f32")) as Uint8Array;
    if (data.byteLength === 0) throw new Error("No audio track found");
    if (data.byteLength % 4 !== 0) throw new Error("Unexpected PCM length");
    // Copy out of ffmpeg's heap-backed buffer before transferring it.
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
  } finally {
    ffmpeg.terminate();
  }
}

// Native decoder. `OfflineAudioContext` with a 16kHz rate makes the browser
// resample during `decodeAudioData`, and it avoids ffmpeg's MEMFS copy of the
// whole video for the common MP4/WebM/MOV cases.
async function decodeWithWebAudio(file: File): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = await context.decodeAudioData(arrayBuffer);
  return decoded.getChannelData(0).slice();
}

async function decodeAudio(
  file: File,
  onStatus?: (status: string) => void
): Promise<Float32Array> {
  try {
    onStatus?.("Decoding audio…");
    return await decodeWithWebAudio(file);
  } catch (err) {
    console.warn("Web Audio decoding failed, using ffmpeg:", err);
    onStatus?.("Extracting audio…");
    return await decodeWithFfmpeg(file);
  }
}

export async function transcribeInBrowser(
  file: File,
  options: TranscribeInBrowserOptions = {}
): Promise<BrowserTranscription> {
  if (typeof window === "undefined") {
    throw new Error("Browser transcription is only available in the browser");
  }
  if (pending) {
    throw new Error("A transcription is already running");
  }

  const audio = await decodeAudio(file, options.onStatus);
  if (audio.length === 0) {
    throw new Error("No audio track found in this video");
  }

  const duration = audio.length / SAMPLE_RATE;
  cancelIdleUnload();
  const target = getWorker();

  return new Promise<BrowserTranscription>((resolve, reject) => {
    pending = {
      resolve,
      reject,
      onStatus: options.onStatus,
      onProgress: options.onProgress,
    };

    try {
      target.postMessage(
        {
          type: "transcribe",
          audio,
          language: options.language,
          duration,
        },
        [audio.buffer]
      );
    } catch (err) {
      pending = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
