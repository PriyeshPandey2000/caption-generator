"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import CaptionOverlay from "./CaptionOverlay";
import TransportControls from "./TransportControls";
import { sampleZoom } from "@/core/zoom";
import { sfxEngine } from "@/core/audio";

export default function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const videoUrl = useEditorStore((s) => s.videoUrl);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const videoEffects = useEditorStore((s) => s.project.globalStyle.videoEffects);
  const sfxSettings = useEditorStore((s) => s.project.globalStyle.sfx);
  const sfxEvents = useEditorStore((s) => s.project.composition.sfxEvents);

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

  const handleVideoClick = useCallback(() => {
    handlePlayPause();
  }, [handlePlayPause]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => setIsPlaying(false);
    video.addEventListener("ended", handleEnded);
    return () => video.removeEventListener("ended", handleEnded);
  }, [setIsPlaying]);

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

  if (!videoUrl) return null;

  return (
    <div className="w-full h-full flex flex-col gap-2">
      <div className="relative flex-1 min-h-0 bg-black rounded-lg overflow-hidden">
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
            }}
            className="w-full h-full object-contain"
            playsInline
            onClick={handleVideoClick}
          />
        </div>
        <div
          className="absolute inset-x-0 bottom-0 pointer-events-none"
          style={{
            height: "35%",
            background:
              "linear-gradient(to top, rgba(0,0,0,0.65), transparent)",
          }}
        />
        <CaptionOverlay onBackgroundClick={handlePlayPause} />
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
