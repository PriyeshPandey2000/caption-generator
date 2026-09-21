// Upload-time normalization for background images.
//
// Every later composite (live preview and offline export) stretches the
// chosen image onto the video frame with ctx.drawImage(img, 0, 0, w, h).
// Keeping the source close to or above the output size is what keeps that
// stretch crisp, so this module downsizes oversized uploads once here instead
// of every frame, and re-encodes everything to WebP/JPEG so the browser never
// has to re-scale a 40MP photo inside the 60fps compositor.

export const BACKGROUND_IMAGE_MAX_SIDE = 2048;
const ENCODE_QUALITY = 0.92;

/** Scales a background image so its longest side is no larger than
 * BACKGROUND_IMAGE_MAX_SIDE (never upscales: upscaling at upload would only
 * invent detail that a per-frame high-quality sampler can't recover). Returns
 * a fresh File, or null on any decode/encode failure so callers can fall back
 * to the untouched original. */
export async function preprocessBackgroundImage(file: File): Promise<File | null> {
  try {
    const { source, width, height, close } = await decodeImage(file);
    try {
      const longest = Math.max(width, height);
      const scale = Math.min(1, BACKGROUND_IMAGE_MAX_SIDE / longest);
      const outW = Math.max(1, Math.round(width * scale));
      const outH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, outW, outH);
      const blob = await encode(canvas, file.type);
      if (!blob) return null;
      return new File([blob], file.name, { type: blob.type });
    } finally {
      close();
    }
  } catch {
    return null;
  }
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }
  return await new Promise<DecodedImage>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode background image"));
    };
    img.decoding = "async";
    img.src = url;
  });
}

async function encode(canvas: HTMLCanvasElement, originalType: string): Promise<Blob | null> {
  const candidates: string[] = [];
  if (isWebpSupported()) candidates.push("image/webp");
  if (
    originalType === "image/png" ||
    originalType === "image/gif" ||
    originalType === "image/svg+xml"
  ) {
    candidates.push("image/png");
  }
  candidates.push("image/jpeg");
  for (const type of new Set(candidates)) {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, type === "image/png" ? undefined : ENCODE_QUALITY);
    });
    if (blob) return blob;
  }
  return null;
}

function isWebpSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}