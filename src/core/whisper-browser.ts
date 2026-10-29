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
      // `progress_total` is the aggregate across every model file; using it
      // avoids the percentage resetting to zero as each shard finishes.
      if (data.status === "progress_total") {
        pending?.onProgress?.(data.loaded ?? 0, data.total ?? 0, data.status);
      } else if (data.status === "progress") {
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
      return;
    }

    if (data?.type === "error") {
      const job = pending;
      pending = null;
      job?.reject(new Error(data.message || "Transcription failed"));
    }
  });

  next.addEventListener("error", (event) => {
    const job = pending;
    pending = null;
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

// ffmpeg.wasm already ships with the app for export. Decoding to raw 16kHz
// mono float32 PCM is exactly what the Whisper feature extractor expects, so
// this skips a second resample and avoids the ~4.5MB serverless body limit
// entirely — the audio never leaves the browser.
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

// Fallback for containers ffmpeg.wasm can't open. `OfflineAudioContext` with a
// 16kHz rate makes the browser resample during `decodeAudioData`.
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
    onStatus?.("Extracting audio…");
    return await decodeWithFfmpeg(file);
  } catch (err) {
    console.warn("ffmpeg audio extraction failed, using Web Audio:", err);
    onStatus?.("Decoding audio…");
    return await decodeWithWebAudio(file);
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
