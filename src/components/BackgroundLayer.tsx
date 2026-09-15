"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/store/editor-store";
import { loadSegmenter, segmentFrame } from "@/core/background-removal";
import { smoothMaskTemporal, featherMask } from "@/core/temporal-smoothing";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import type * as RvmApi from "@/core/background-removal-rvm";
import type { RvmSegmenter } from "@/core/background-removal-rvm";

// Composites the video over a chosen background (blur / solid color / image)
// using a person-segmentation alpha mask. Renders as a <canvas> sibling to
// the real <video> element — VideoPreview is responsible for hiding the raw
// video (opacity-0, still playing for audio/timing) whenever this is active,
// and showing it untouched whenever background.mode === "none" (zero cost,
// zero behavior change, matching the plan).
export default function BackgroundLayer({
  videoRef,
  className,
  onClick,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  className?: string;
  onClick?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const personCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevMaskRef = useRef<Float32Array | null>(null);
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const rvmApiRef = useRef<typeof RvmApi | null>(null);
  const rvmRef = useRef<RvmSegmenter | null>(null);
  const lastCapturedTimeRef = useRef<number | null>(null);
  const lastDrawnTimeRef = useRef<number | null>(null);
  const rvmBusyRef = useRef(false);
  const rvmErrorRef = useRef(false);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const bgImageUrlRef = useRef<string | null>(null);

  const background = useEditorStore((s) => s.project.globalStyle.background);
  const isPlaying = useEditorStore((s) => s.isPlaying);

  const setError = useEditorStore((s) => s.setError);

  // Load the segmentation backend once, lazily, the first time a mode other
  // than "none" is selected — not on every editor load. MediaPipe is the
  // default; "?seg=rvm" opts into the RVM proof-of-concept backend.
  useEffect(() => {
    if (background.mode === "none") return;
    let cancelled = false;
    const useRvm =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("seg") === "rvm";

    if (useRvm) {
      if (rvmApiRef.current) return;
      import("@/core/background-removal-rvm")
        .then((mod) => {
          rvmApiRef.current = mod;
          return mod.loadRvmSegmenter();
        })
        .then((seg) => {
          if (!cancelled) rvmRef.current = seg;
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("RVM background removal model failed to load:", err);
          setError(
            "Couldn't load the RVM background removal model — check your connection and try again."
          );
        });
      return () => {
        cancelled = true;
      };
    }

    if (segmenterRef.current) return;
    loadSegmenter()
      .then((seg) => {
        if (!cancelled) segmenterRef.current = seg;
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Background removal model failed to load:", err);
        setError(
          "Couldn't load the background removal model — check your connection and try again."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [background.mode, setError]);

  // Keep a loaded <img> for "image" mode in sync with the chosen URL.
  useEffect(() => {
    if (background.mode !== "image" || !background.imageUrl) return;
    if (bgImageUrlRef.current === background.imageUrl && bgImageRef.current) return;
    const img = new Image();
    img.src = background.imageUrl;
    bgImageRef.current = img;
    bgImageUrlRef.current = background.imageUrl;
  }, [background.mode, background.imageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId: number;
    let running = true;

    const getVideo = () => videoRef.current;
    // A fresh effect run (background change, play-state change, re-mount)
    // invalidates anything we composited under the previous configuration.
    lastDrawnTimeRef.current = null;

    // Shares the mask->background->person composite between both backends.
    // MediaPipe hands it the feathered mask, RVM the raw alpha matte.
    const drawMaskTail = (
      ctx: CanvasRenderingContext2D,
      video: HTMLVideoElement,
      w: number,
      h: number,
      mask: Float32Array,
      mw: number,
      mh: number
    ) => {
      // Small offscreen canvas holding the mask as an alpha channel — drawn
      // scaled-up onto the person layer below via destination-in, which also
      // gives free bilinear edge softening on top of the explicit feather.
      if (!maskCanvasRef.current) maskCanvasRef.current = document.createElement("canvas");
      const maskCanvas = maskCanvasRef.current;
      maskCanvas.width = mw;
      maskCanvas.height = mh;
      const maskCtx = maskCanvas.getContext("2d");
      if (!maskCtx) return;
      const maskImageData = maskCtx.createImageData(mw, mh);
      for (let i = 0; i < mask.length; i++) {
        const a = Math.max(0, Math.min(255, Math.round(mask[i] * 255)));
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
      } else if (background.mode === "image" && bgImageRef.current?.complete) {
        ctx.drawImage(bgImageRef.current, 0, 0, w, h);
      } else {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, w, h);
      }

      // Sharp person cutout on top, clipped by the (scaled-up) mask.
      if (!personCanvasRef.current) personCanvasRef.current = document.createElement("canvas");
      const personCanvas = personCanvasRef.current;
      personCanvas.width = w;
      personCanvas.height = h;
      const personCtx = personCanvas.getContext("2d");
      if (!personCtx) return;
      personCtx.drawImage(video, 0, 0, w, h);
      personCtx.globalCompositeOperation = "destination-in";
      personCtx.drawImage(maskCanvas, 0, 0, mw, mh, 0, 0, w, h);
      personCtx.globalCompositeOperation = "source-over";

      ctx.drawImage(personCanvas, 0, 0);
    };

    // RVM is async and stateful: skip frames while a run is in flight, and
    // reset its recurrent memory when playback jumps (seek, re-entering).
    const runRvmTick = async (
      ctx: CanvasRenderingContext2D,
      video: HTMLVideoElement,
      w: number,
      h: number
    ) => {
      const rvm = rvmRef.current;
      const api = rvmApiRef.current;
      if (!rvm || !api || rvmBusyRef.current || rvmErrorRef.current) return;
      const t = video.currentTime;
      const last = lastCapturedTimeRef.current;
      if (last !== null && (t < last - 0.05 || t > last + 0.6)) rvm.reset();
      lastCapturedTimeRef.current = t;
      rvmBusyRef.current = true;
      try {
        const seg = await api.segmentFrameRvm(rvm, video);
        if (!seg) return;
        drawMaskTail(ctx, video, w, h, seg.mask, seg.width, seg.height);
        lastDrawnTimeRef.current = t;
      } catch (err) {
        rvmErrorRef.current = true;
        console.error("RVM segmentation failed — disabling RVM:", err);
      } finally {
        rvmBusyRef.current = false;
      }
    };

    const tick = () => {
      if (!running) return;
      rafId = requestAnimationFrame(tick);

      if (background.mode === "none") return;
      const video = getVideo();
      if (!video) return;
      const paused = !isPlaying || video.paused;
      const frameTime = video.currentTime;
      // While paused (scrubbing, seek, fresh selection) recomposite only when
      // the playhead actually moved — the loop keeps running, but drawing the
      // same frame on every RAF tick would be free model work for nothing.
      if (paused && lastDrawnTimeRef.current === frameTime) return;
      const segmenter = segmenterRef.current;
      const rvm = rvmRef.current;
      if (!segmenter && !rvm) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (rvm) {
        void runRvmTick(ctx, video, w, h);
        return;
      }
      if (!segmenter) return;

      const seg = segmentFrame(segmenter, video, performance.now());
      if (!seg) return;
      const { mask, width: mw, height: mh } = seg;

      const smoothed = smoothMaskTemporal(prevMaskRef.current, mask, 0.5);
      prevMaskRef.current = smoothed;
      const feathered = featherMask(smoothed, mw, mh, 2);

      drawMaskTail(ctx, video, w, h, feathered, mw, mh);
      lastDrawnTimeRef.current = frameTime;
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, [videoRef, background, isPlaying]);

  // Reset temporal smoothing whenever the mode turns off so re-enabling
  // doesn't blend against a stale mask from a previous session/video.
  useEffect(() => {
    if (background.mode === "none") prevMaskRef.current = null;
  }, [background.mode]);

  // A mode change (leaving/entering RVM, or a fresh mount) gets a fresh
  // zero-initialized memory. Deliberately NOT keyed on isPlaying — a plain
  // pause/resume with no seek shouldn't discard RVM's accumulated temporal
  // stability, which is the entire point of its recurrence. Real
  // discontinuities (seeks, scrubbing while paused) are already caught by
  // the gap check inside runRvmTick (t vs lastCapturedTimeRef) regardless of
  // play state, so this only needs to fire on mode changes.
  useEffect(() => {
    rvmRef.current?.reset();
  }, [background.mode]);

  if (background.mode === "none") return null;

  return <canvas ref={canvasRef} className={className} onClick={onClick} />;
}
