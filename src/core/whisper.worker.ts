import { pipeline, env, type ProgressInfo } from "@huggingface/transformers";

// Under the DOM lib `self` is typed as `Window`; a module worker only needs
// this narrow slice, so cast once instead of pulling in the webworker lib.
const ctx = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void
  ) => void;
};

// Everything runs in this worker: mel extraction, tokenizer, decoder loop, and
// the WebGPU/WASM inference. Keeping it off the main thread means the editor
// stays responsive while a long clip transcribes.
env.allowLocalModels = false;

// Small is the browser default: ~3x faster and ~2.7x smaller than medium,
// which matters because word timestamps need an extra decoder pass per chunk.
const MODEL_ID = "onnx-community/whisper-small_timestamped";
const SAMPLE_RATE = 16_000;

// transformers.js leaks GPU memory per decoded 30s chunk on WebGPU (upstream
// issues #860/#1739, still open). Keep GPU work to short clips; long audio
// uses the CPU backend, which has no such leak.
const WEBGPU_SAFE_SECONDS = 2 * 60;

type Device = "webgpu" | "wasm";

interface TranscriberOutput {
  text: string;
  chunks?: Array<{ text: string; timestamp: [number, number] }>;
}

interface Transcriber {
  fn: (
    audio: Float32Array,
    options: Record<string, unknown>
  ) => Promise<TranscriberOutput>;
  device: Device;
}

let transcriberPromise: Promise<Transcriber> | null = null;

function post(message: Record<string, unknown>): void {
  ctx.postMessage(message);
}

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function forwardProgress(info: ProgressInfo): void {
  // Both per-file and aggregate events are forwarded; the main thread prefers
  // the aggregate one when it arrives so the percentage doesn't jump around.
  const record = info as unknown as Record<string, unknown>;
  post({
    type: "progress",
    status: typeof record.status === "string" ? record.status : "progress",
    file: typeof record.file === "string" ? record.file : undefined,
    loaded: typeof record.loaded === "number" ? record.loaded : 0,
    total: typeof record.total === "number" ? record.total : 0,
    progress: typeof record.progress === "number" ? record.progress : 0,
  });
}

async function loadTranscriber(forceWasm: boolean): Promise<Transcriber> {
  if (transcriberPromise) {
    const loaded = await transcriberPromise;
    if (!forceWasm || loaded.device === "wasm") return loaded;
    // A previous short clip loaded WebGPU. Drop the reference and load the CPU
    // model for this long clip; the worker is unloaded after the job anyway.
    transcriberPromise = null;
  }

  transcriberPromise = (async () => {
    if (!forceWasm && hasWebGPU()) {
      try {
        const fn = await pipeline("automatic-speech-recognition", MODEL_ID, {
          device: "webgpu",
          // q4 everywhere: encoder ~63MB, decoder ~223MB. Keeps the model
          // small enough for integrated GPUs while staying fast on WebGPU.
          dtype: { encoder_model: "q4", decoder_model_merged: "q4" },
          progress_callback: forwardProgress,
        });
        post({ type: "status", message: "Compiling shaders and warming up model…" });
        await fn(new Float32Array(SAMPLE_RATE), { language: "en" });
        return { fn: fn as unknown as Transcriber["fn"], device: "webgpu" };
      } catch (err) {
        post({
          type: "warning",
          message: `WebGPU unavailable, falling back to CPU: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }

    const fn = await pipeline("automatic-speech-recognition", MODEL_ID, {
      device: "wasm",
      dtype: "q8",
      progress_callback: forwardProgress,
    });
    return { fn: fn as unknown as Transcriber["fn"], device: "wasm" };
  })();

  return transcriberPromise;
}

function toWordTimings(
  chunks: Array<{ text: string; timestamp: [number, number] }> | undefined,
  duration: number
): Array<{ word: string; start: number; end: number }> {
  if (!chunks?.length) return [];

  const words: Array<{ word: string; start: number; end: number }> = [];
  let cursor = 0;

  for (const chunk of chunks) {
    const text = (chunk.text ?? "").trim();
    if (!text) continue;

    const [rawStart, rawEnd] = chunk.timestamp ?? [];
    let start = typeof rawStart === "number" ? rawStart : cursor;
    let end =
      typeof rawEnd === "number"
        ? rawEnd
        : start + Math.max(0.08, text.length * 0.05);

    start = Math.max(0, Math.min(start, duration));
    if (!(end > start)) end = start + Math.max(0.08, text.length * 0.05);
    end = Math.max(start + 0.01, Math.min(end, duration));

    words.push({ word: text, start, end });
    cursor = end;
  }

  return words;
}

async function run({
  audio,
  duration,
  language,
}: {
  audio: Float32Array;
  duration: number;
  language?: string;
}): Promise<void> {
  const longClip = duration > WEBGPU_SAFE_SECONDS;
  let { fn, device } = await loadTranscriber(longClip);

  post({
    type: "status",
    message:
      longClip && device === "wasm"
        ? "Long clip — using the CPU backend to avoid the WebGPU memory leak. This can take a while…"
        : `Transcribing on ${device}…`,
  });

  const options = {
    return_timestamps: "word" as const,
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(language ? { language, task: "transcribe" } : {}),
  };

  // Multilingual model: when no language is supplied, Whisper detects it from
  // the audio. Passing one explicitly skips detection for that language.
  let output: TranscriberOutput;
  try {
    output = await fn(audio, options);
  } catch (err) {
    if (device !== "webgpu") throw err;
    // Short clips can still hit the GPU leak. Retry this one on CPU instead of
    // failing the whole upload.
    post({
      type: "warning",
      message: `WebGPU failed, retrying on CPU: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    post({ type: "status", message: "GPU ran out of memory — retrying on CPU…" });
    transcriberPromise = null;
    ({ fn, device } = await loadTranscriber(true));
    output = await fn(audio, options);
  }

  const words = toWordTimings(output.chunks, duration);

  post({
    type: "complete",
    device,
    text: output.text ?? "",
    duration,
    language: language ?? "auto",
    words,
  });
}

ctx.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as {
    type?: string;
    audio?: Float32Array;
    duration?: number;
    language?: string;
  };

  if (data?.type !== "transcribe" || !data.audio) return;

  run({
    audio: data.audio,
    duration: data.duration || data.audio.length / SAMPLE_RATE,
    language: data.language,
  }).catch((err) => {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  });
});
