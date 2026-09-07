import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { readFile, writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

const ACCEPTED_EXTS = new Set([
  "flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "opus", "wav", "webm",
]);

const EXT_TO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  opus: "audio/opus",
  mpeg: "video/mpeg",
  mpga: "audio/mpeg",
};

const UNSUPPORTED_EXT_MAP: Record<string, string> = {
  mov: "mp4",
  avi: "mp4",
  mkv: "mp4",
  m4v: "mp4",
  ts: "mp4",
  mts: "mp4",
};

let ffmpegChecked = false;
let ffmpegAvailable: Promise<boolean> | null = null;

// Probe for a system ffmpeg once per server process. The fallback path needs a
// real binary (installed on the host/production), so we detect availability
// up front instead of swallowing an execFile error mid-request and silently
// handing the user the original failed response.
function isFfmpegAvailable(): Promise<boolean> {
  if (!ffmpegChecked && !ffmpegAvailable) {
    ffmpegChecked = true;
    ffmpegAvailable = new Promise<boolean>((resolve) => {
      execFile("ffmpeg", ["-version"], (err) => resolve(!err));
    });
  }
  return ffmpegAvailable ?? Promise.resolve(false);
}

async function tryGroqDirect(
  file: File,
  apiKey: string
): Promise<Response> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const groqExt = ACCEPTED_EXTS.has(ext) ? ext : (UNSUPPORTED_EXT_MAP[ext] ?? "mp4");
  const mimeType = EXT_TO_MIME[groqExt] ?? "video/mp4";
  const groqName = `upload.${groqExt}`;

  const blob = new Blob([await file.arrayBuffer()], { type: mimeType });

  const fd = new FormData();
  fd.append("file", blob, groqName);
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("response_format", "verbose_json");
  fd.append("timestamp_granularities[]", "word");
  fd.append("timestamp_granularities[]", "segment");
  fd.append("language", "en");

  return fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
}

// Normalize the upload to 16kHz mono WAV via server-side ffmpeg. This handles
// container/codec combos Groq's direct upload parser rejects (e.g. AVI with an
// unusual codec, or MOV variants), and also shrinks payload vs. sending video.
// Requires a system ffmpeg on the server; callers must check isFfmpegAvailable
// first. Returns null only on ffmpeg failure so the route can respond clearly.
async function tryWithFfmpeg(
  file: File,
  apiKey: string
): Promise<Response | null> {
  const id = randomUUID();
  const tmpIn = join(tmpdir(), `${id}_in`);
  const tmpWav = join(tmpdir(), `${id}.wav`);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp4";

  try {
    await writeFile(`${tmpIn}.${ext}`, Buffer.from(await file.arrayBuffer()));

    await new Promise<void>((resolve, reject) =>
      execFile(
        "ffmpeg",
        ["-i", `${tmpIn}.${ext}`, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-y", tmpWav],
        (err) => (err ? reject(err) : resolve())
      )
    );

    const audioBytes = await readFile(tmpWav);
    const blob = new Blob([audioBytes], { type: "audio/wav" });

    const fd = new FormData();
    fd.append("file", blob, "audio.wav");
    fd.append("model", "whisper-large-v3-turbo");
    fd.append("response_format", "verbose_json");
    fd.append("timestamp_granularities[]", "word");
    fd.append("timestamp_granularities[]", "segment");
    fd.append("language", "en");

    return fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
  } catch (err) {
    console.error("ffmpeg normalization failed:", err);
    return null;
  } finally {
    await Promise.allSettled([
      unlink(`${tmpIn}.mp4`).catch(() => {}),
      unlink(`${tmpIn}.mov`).catch(() => {}),
      unlink(`${tmpIn}.avi`).catch(() => {}),
      unlink(`${tmpIn}.mkv`).catch(() => {}),
      unlink(`${tmpIn}.m4v`).catch(() => {}),
      unlink(`${tmpIn}.ts`).catch(() => {}),
      unlink(`${tmpIn}.mts`).catch(() => {}),
      unlink(`${tmpIn}.webm`).catch(() => {}),
      unlink(`${tmpIn}.ogg`).catch(() => {}),
      unlink(`${tmpIn}.mp3`).catch(() => {}),
      unlink(`${tmpIn}.m4a`).catch(() => {}),
      unlink(`${tmpIn}.wav`).catch(() => {}),
      unlink(tmpWav).catch(() => {}),
    ]);
  }
}

function errResponse(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const apiKey = formData.get("apiKey") as string | null;

    if (!file) {
      return errResponse("No file provided", 400);
    }
    if (!apiKey) {
      return errResponse("Groq API key required", 400);
    }

    const direct = await tryGroqDirect(file, apiKey);

    // Direct upload succeeded — done.
    if (direct.ok) {
      return NextResponse.json(await direct.json());
    }

    // Groq rejected the direct upload. Try normalizing the audio server-side.
    const ffmpeg = await isFfmpegAvailable();
    if (ffmpeg) {
      const normalized = await tryWithFfmpeg(file, apiKey);
      if (normalized && normalized.ok) {
        return NextResponse.json(await normalized.json());
      }
    }

    // We could not transcribe the file. Give a helpful message rather than
    // silently returning Groq's raw rejection. The ffmpeg path depends on an
    // ffmpeg binary installed on this server; if it isn't present we say so.
    const raw = await direct.text();
    console.error("Groq API error:", direct.status, raw);

    const reasoning = ffmpeg
      ? "The video format could not be read even after audio conversion."
      : "The server is missing ffmpeg, which is required to convert this video format.";

    return errResponse(
      `Transcription failed (${direct.status}). ${reasoning} Please upload an MP4, MOV, WebM, or MP3/WAV file. (${raw.slice(0, 200)})`,
      direct.status
    );
  } catch (error) {
    console.error("Transcription failed:", error);
    return errResponse(`Transcription failed: ${error}`, 500);
  }
}
