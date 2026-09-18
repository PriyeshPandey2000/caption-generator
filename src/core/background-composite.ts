import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { createSegmenter, segmentFrame } from "./background-removal";
import { smoothMaskTemporal, featherMask } from "./temporal-smoothing";
import type { BackgroundSettings } from "./types";

// Offline (export) counterpart to BackgroundLayer.tsx's live compositing.
// Same mask -> feather -> person-cutout math, but driven by an explicit
// seek+render loop instead of rAF, and against its own ImageSegmenter
// instance (see createSegmenter's docs — never the live-preview singleton).
export interface BackgroundCompositor {
  /** Segments `video`'s current (already-seeked) frame and returns a canvas
   * with the chosen background composited behind the cut-out subject, sized
   * to the video's native resolution. Returns null while the frame isn't
   * decoded yet or a background image is still loading. */
  renderFrame(
    video: HTMLVideoElement,
    background: BackgroundSettings,
    timestampMs: number
  ): Promise<HTMLCanvasElement | null>;
  dispose(): void;
}

export async function createBackgroundCompositor(): Promise<BackgroundCompositor> {
  const segmenter: ImageSegmenter = await createSegmenter();
  let prevMask: Float32Array | null = null;
  const outCanvas = document.createElement("canvas");
  const maskCanvas = document.createElement("canvas");
  const personCanvas = document.createElement("canvas");
  const bgImageCache = new Map<string, HTMLImageElement>();

  async function loadBgImage(url: string): Promise<HTMLImageElement> {
    const cached = bgImageCache.get(url);
    if (cached) return cached;
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load background image"));
    });
    bgImageCache.set(url, img);
    return img;
  }

  return {
    async renderFrame(video, background, timestampMs) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) return null;

      const seg = segmentFrame(segmenter, video, timestampMs);
      if (!seg) return null;
      const { mask, width: mw, height: mh } = seg;
      const smoothed = smoothMaskTemporal(prevMask, mask, 0.5);
      prevMask = smoothed;
      const feathered = featherMask(smoothed, mw, mh, 2);

      outCanvas.width = w;
      outCanvas.height = h;
      const ctx = outCanvas.getContext("2d");
      if (!ctx) return null;

      maskCanvas.width = mw;
      maskCanvas.height = mh;
      const maskCtx = maskCanvas.getContext("2d");
      if (!maskCtx) return null;
      const maskImageData = maskCtx.createImageData(mw, mh);
      for (let i = 0; i < feathered.length; i++) {
        const a = Math.max(0, Math.min(255, Math.round(feathered[i] * 255)));
        maskImageData.data[i * 4 + 3] = a;
      }
      maskCtx.putImageData(maskImageData, 0, 0);

      // Background layer.
      if (background.mode === "blur") {
        ctx.filter = `blur(${background.blurAmount}px)`;
        ctx.drawImage(video, 0, 0, w, h);
        ctx.filter = "none";
      } else if (background.mode === "color") {
        ctx.fillStyle = background.color;
        ctx.fillRect(0, 0, w, h);
      } else if (background.mode === "image" && background.imageUrl) {
        try {
          const img = await loadBgImage(background.imageUrl);
          ctx.drawImage(img, 0, 0, w, h);
        } catch {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, w, h);
        }
      } else {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, w, h);
      }

      // Sharp person cutout on top, clipped by the (scaled-up) mask.
      personCanvas.width = w;
      personCanvas.height = h;
      const personCtx = personCanvas.getContext("2d");
      if (!personCtx) return null;
      personCtx.clearRect(0, 0, w, h);
      personCtx.drawImage(video, 0, 0, w, h);
      personCtx.globalCompositeOperation = "destination-in";
      personCtx.drawImage(maskCanvas, 0, 0, mw, mh, 0, 0, w, h);
      personCtx.globalCompositeOperation = "source-over";

      ctx.drawImage(personCanvas, 0, 0);
      return outCanvas;
    },
    dispose() {
      prevMask = null;
      segmenter.close();
    },
  };
}
