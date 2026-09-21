"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import CaptionOverlay from "./CaptionOverlay";
import TransportControls from "./TransportControls";
import PlatformPreviewOverlay, { PlatformPreviewToggle } from "./PlatformPreviewOverlay";
import BackgroundLayer from "./BackgroundLayer";
import { sampleZoom } from "@/core/zoom";
import { sfxEngine } from "@/core/audio";
import { EXPORT_DESIGN_WIDTH } from "@/core/scene-renderer";

// Transient affordance for platform-crop reframing. Keyed by the selected
// platform in the parent so re-picking a platform shows it again; it fades on
// its own 6s timer (state initialized, never set synchronously in the effect).
function ReframeHint({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!active) return undefined;
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [active]);

  if (!active || !visible) return null;
  return (
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-2.5 py-1 rounded-full bg-black/70 text-white/90 text-[11px] whitespace-nowrap">
      Drag to reframe · double-click to reset
    </div>
  );
}

export default function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  // Live preview surface (container rect + source aspect once the video
  // loads). Drives CaptionOverlay's scaleFactor so the on-screen caption size
  // tracks the export's fixed design surface (see captionScale below).
  const [surface, setSurface] = useState<{ w: number; h: number; aspect: number } | null>(null);
  const previewPlatform = useEditorStore((s) => s.previewPlatform);
  const setPreviewPlatform = useEditorStore((s) => s.setPreviewPlatform);
  const videoUrl = useEditorStore((s) => s.videoUrl);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const videoEffects = useEditorStore((s) => s.project.globalStyle.videoEffects);
  const sfxSettings = useEditorStore((s) => s.project.globalStyle.sfx);
  const sfxEvents = useEditorStore((s) => s.project.composition.sfxEvents);
  const backgroundMode = useEditorStore((s) => s.project.globalStyle.background.mode);
  const reframe = useEditorStore((s) => s.project.globalStyle.videoEffects.reframe);
  const setReframe = useEditorStore((s) => s.setReframe);
  const cropActive = previewPlatform !== "none";

  // Platform-crop reframing: the aspect-[9/16] box clips the object-cover
  // video; dragging shifts which part of the source fills the frame. Mirrors
  // the export's cover-scale margin so what the user frames is what renders.
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    tx: 0,
    ty: 0,
    marginX: 0,
    marginY: 0,
    moved: false,
  });
  const suppressClickRef = useRef(false);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, [setCurrentTime]);

  const handlePlayPause = useCallback(
    (rate?: number) => {
      if (!videoRef.current) return;
      const r = rate ?? useEditorStore.getState().playbackRate;
      if (videoRef.current.paused) {
        // Resume the audio context inside the user gesture (browser autoplay
        // policy) rather than relying on the attach effect that ran on mount.
        if (sfxSettings.enabled) sfxEngine.ensureContext();
        videoRef.current.playbackRate = r;
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    },
    [setIsPlaying, sfxSettings.enabled]
  );

  // Keep the HTMLVideoElement in sync with the store's playback rate (the
  // speed menu can change while playing).
  const playbackRate = useEditorStore((s) => s.playbackRate);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  const handleSeek = useCallback(
    (t: number) => {
      const video = videoRef.current;
      if (video) video.currentTime = t;
    },
    []
  );

  // Bridge every seek surface (timeline scrubber, playhead drag, word-block
  // clicks, transcript clicks, search jump) to the real <video>: those paths
  // only write the store clock, so without this pressing play would resume
  // from the video's own stale position and the first timeupdate would snap
  // the playhead back from where the user clicked. During playback the store
  // clock tracks video.currentTime via timeupdate, so the drift stays near
  // zero and this no-ops — but a scrub mid-playback still re-seeks the video.
  const currentTime = useEditorStore((s) => s.currentTime);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (!Number.isFinite(video.duration)) return;
    if (Math.abs(video.currentTime - currentTime) > 0.15) {
      video.currentTime = currentTime;
    }
  }, [currentTime, videoUrl]);

  const handleVideoClick = useCallback(() => {
    // A reframe drag ends with a click on the same element; don't also toggle
    // playback when the user was just grabbing the frame.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    handlePlayPause();
  }, [handlePlayPause]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => setIsPlaying(false);
    video.addEventListener("ended", handleEnded);
    return () => video.removeEventListener("ended", handleEnded);
  }, [setIsPlaying]);

  // Measure the preview surface so captions scale with the rendered frame AND
  // match the export's caption ratio. The export always sizes captions as
  // `designPx / 1280` of the output frame width (EXPORT_DESIGN_WIDTH), no
  // matter the resolution or crop — so to reproduce that ratio on screen the
  // preview must scale captions by `displayedVideoWidth / 1280`, not `1` (None)
  // and not `portraitW/containerW`. `displayedVideoWidth` is the 9:16 box width
  // when a platform crop is active, else the object-contain fit of the video
  // (which can be narrower than the container for letterboxed portrait clips).
  const measureSurface = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const v = videoRef.current;
    const aspect =
      v && v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 16 / 9;
    setSurface({ w: rect.width, h: rect.height, aspect });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    measureSurface();
    const ro = new ResizeObserver(measureSurface);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureSurface, videoUrl]);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        handlePlayPause();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [handlePlayPause]);

  // Audio engine: attach video, feed events + settings, preload sounds.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    sfxEngine.attachVideo(video);
    sfxEngine.setEvents(sfxEvents);
    const names = Array.from(new Set(sfxEvents.map((e) => e.sound)));
    if (names.length) sfxEngine.preload(names);
  }, [videoUrl, sfxEvents]);

  // RAF-driven camera zoom + SFX scheduling
  useEffect(() => {
    const video = videoRef.current;
    const zoomEl = zoomRef.current;
    if (!video || !zoomEl) return;

    let rafId: number;

    const tick = () => {
      if (isPlaying && !video.paused) {
        if (videoEffects.cameraEvents.length > 0) {
          const scale = sampleZoom(
            video.currentTime,
            videoEffects.cameraEvents,
            videoEffects
          );
          zoomEl.style.transform = `scale(${scale})`;
        }
        if (sfxSettings.enabled && sfxEvents.length > 0) {
          sfxEngine.setRunning(true);
          sfxEngine.scheduleAhead(video.currentTime);
        } else {
          sfxEngine.setRunning(false);
        }
      } else {
        zoomEl.style.transform = "scale(1)";
        sfxEngine.setRunning(false);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, videoEffects, sfxSettings.enabled, sfxEvents]);

  // --- Platform-crop reframing gestures (pointer events on the crop box) ---
  const handleReframePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!cropActive) return;
      const video = videoRef.current;
      const box = e.currentTarget;
      if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
      const boxW = box.clientWidth;
      const boxH = box.clientHeight;
      if (boxW <= 0 || boxH <= 0) return;
      // Cover scale + overflow margin in display px — the room the crop
      // window can slide in (same geometry as the export's cover math, at
      // zoom = 1; reframing is authored while paused/scrubbing).
      const cover = Math.max(boxW / video.videoWidth, boxH / video.videoHeight);
      const dispW = video.videoWidth * cover;
      const dispH = video.videoHeight * cover;
      const marginX = Math.max(0, (dispW - boxW) / 2);
      const marginY = Math.max(0, (dispH - boxH) / 2);
      const cur = useEditorStore.getState().project.globalStyle.videoEffects.reframe;
      dragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        tx: cur.x,
        ty: cur.y,
        marginX,
        marginY,
        moved: false,
      };
      try {
        box.setPointerCapture(e.pointerId);
      } catch {
        // Pointer already gone; pointermove will no-op on !active.
      }
    },
    [cropActive]
  );

  const handleReframePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d.active) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      suppressClickRef.current = true;
      // 1:1 track: a drag over the full overflow margin sweeps the frame.
      // The content follows the pointer: pulling the picture right (dx > 0)
      // moves what's under the window left (reframe.x decreases).
      const nx = d.marginX > 0.5 ? d.tx - dx / d.marginX : d.tx;
      const ny = d.marginY > 0.5 ? d.ty - dy / d.marginY : d.ty;
      setReframe({ x: nx, y: ny });
    },
    [setReframe]
  );

  const handleReframePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d.active) return;
      d.active = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Capture may already be released after pointerup.
      }
      if (d.moved) suppressClickRef.current = true;
    },
    []
  );

  const handleReframeReset = useCallback(() => {
    if (!cropActive) return;
    setReframe(null);
  }, [cropActive, setReframe]);

  if (!videoUrl) return null;

  const displayedVideoWidth = surface
    ? previewPlatform !== "none"
      ? Math.min(surface.h * (9 / 16), surface.w)
      : Math.min(surface.w, surface.h * surface.aspect)
    : 0;
  // Scale captions as `designPx / 1280` of the rendered frame width — the same
  // ratio the export always produces (its outW/1280 scaleFactor cancels with
  // the output width). Lets the preview reproduce the export at any window size:
  // (designPx * displayedW/1280) / displayedW == designPx/1280.
  const captionScale = surface ? displayedVideoWidth / EXPORT_DESIGN_WIDTH : 1;

  return (
    <div className="w-full h-full flex flex-col gap-2">
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 bg-zinc-950 rounded-lg overflow-hidden flex items-center justify-center"
      >
        <div
          onPointerDown={cropActive ? handleReframePointerDown : undefined}
          onPointerMove={cropActive ? handleReframePointerMove : undefined}
          onPointerUp={cropActive ? handleReframePointerUp : undefined}
          onPointerCancel={cropActive ? handleReframePointerUp : undefined}
          onDoubleClick={handleReframeReset}
          className={`relative h-full bg-black overflow-hidden ${
            cropActive
              ? "aspect-[9/16] max-w-full ring-1 ring-white/15 cursor-grab active:cursor-grabbing select-none"
              : "w-full"
          }`}
          style={cropActive ? { touchAction: "none" } : undefined}
        >
          <div
            ref={zoomRef}
            className="w-full h-full"
            style={{ transformOrigin: "center center" }}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                setDuration(Number.isFinite(d) && d > 0 ? d : 0);
                measureSurface();
                // When a replacement video loads while the store clock is at a
                // nonzero playhead, the [currentTime, videoUrl] bridge above ran
                // before the new duration existed and returned. Re-align the
                // media now, or its first timeupdate would clobber the playhead.
                const storeT = useEditorStore.getState().currentTime;
                if (
                  Number.isFinite(d) &&
                  d > 0 &&
                  Math.abs(e.currentTarget.currentTime - storeT) > 0.15
                ) {
                  e.currentTarget.currentTime = Math.min(storeT, d - 0.001);
                }
              }}
              className={`w-full h-full ${cropActive ? "object-cover" : "object-contain"} ${
                backgroundMode !== "none" ? "opacity-0" : ""
              }`}
              style={
                cropActive
                  ? { objectPosition: `${(reframe.x + 1) * 50}% ${(reframe.y + 1) * 50}%` }
                  : undefined
              }
              playsInline
              onClick={handleVideoClick}
            />
            {backgroundMode !== "none" && (
              <BackgroundLayer
                videoRef={videoRef}
                onClick={handleVideoClick}
                className={`absolute inset-0 w-full h-full cursor-pointer ${
                  cropActive ? "object-cover" : "object-contain"
                }`}
                style={
                  cropActive
                    ? { objectPosition: `${(reframe.x + 1) * 50}% ${(reframe.y + 1) * 50}%` }
                    : undefined
                }
              />
            )}
          </div>
          <div
            className="absolute inset-x-0 bottom-0 pointer-events-none"
            style={{
              height: "35%",
              background:
                "linear-gradient(to top, rgba(0,0,0,0.65), transparent)",
            }}
          />
          <CaptionOverlay onBackgroundClick={handlePlayPause} scaleFactor={captionScale} />
          <PlatformPreviewOverlay platform={previewPlatform} />
          <ReframeHint key={previewPlatform} active={cropActive} />
        </div>
        <PlatformPreviewToggle
          value={previewPlatform}
          onChange={setPreviewPlatform}
          className="absolute top-2 left-2 z-20"
        />
      </div>

      <div className="shrink-0">
        <TransportControls
          duration={duration}
          onPlayPause={handlePlayPause}
          onSeek={handleSeek}
        />
      </div>
    </div>
  );
}
