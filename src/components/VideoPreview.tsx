"use client";

import { useRef, useEffect, useCallback } from "react";
import { useEditorStore } from "@/store/editor-store";
import CaptionOverlay from "./CaptionOverlay";
import { sampleZoom } from "@/core/zoom";
import { sfxEngine } from "@/core/audio";

export default function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
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

  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, [setIsPlaying]);

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
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      <div
        ref={zoomRef}
        className="w-full h-full"
        style={{ transformOrigin: "center center" }}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          onTimeUpdate={handleTimeUpdate}
          className="w-full h-full object-contain"
          playsInline
          onClick={handlePlayPause}
        />
      </div>
      <CaptionOverlay />

      <button
        onClick={handlePlayPause}
        className="absolute bottom-4 left-4 px-3 py-1.5 bg-black/70 text-white text-sm rounded-lg hover:bg-black/90 transition-colors"
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
    </div>
  );
}
