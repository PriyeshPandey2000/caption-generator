"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import { formatTime } from "@/core/captions";

const RATES = [0.5, 1, 1.5, 2];

export default function TransportControls({
  duration,
  onPlayPause,
  onSeek,
}: {
  duration: number;
  onPlayPause: (rate: number) => void;
  onSeek: (t: number) => void;
}) {
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const playbackRate = useEditorStore((s) => s.playbackRate);
  const setPlaybackRate = useEditorStore((s) => s.setPlaybackRate);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    onPlayPause(playbackRate);
  }, [playbackRate, onPlayPause]);

  const skip = useCallback(
    (delta: number) => {
      const t = useEditorStore.getState().currentTime;
      const next = Math.max(0, Math.min(duration, t + delta));
      setCurrentTime(next);
      onSeek(next);
    },
    [duration, setCurrentTime, onSeek]
  );

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => skip(-5)}
        title="Back 5s"
        className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-white rounded hover:bg-white/10 transition-colors"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
          <path d="M11 10v-2a1 1 0 0 0-1.7-.7L5 11.6V10a1 1 0 0 0-1.7-.7l-2 2a1 1 0 0 0 0 1.4l2 2A1 1 0 0 0 5 14v-1.6l4.3 4.3A1 1 0 0 0 11 16v-2a1 1 0 0 1 1.7-.7l6 6A1 1 0 0 0 20 18V6a1 1 0 0 0-1.7-.7l-6 6A1 1 0 0 0 11 10z" />
        </svg>
      </button>

      <button
        onClick={toggle}
        title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-[#00FF66] text-black hover:bg-[#22C55E] transition-colors"
      >
        {isPlaying ? (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
            <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
          </svg>
        )}
      </button>

      <button
        onClick={() => skip(5)}
        title="Forward 5s"
        className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-white rounded hover:bg-white/10 transition-colors"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
          <path d="M11 10v-2a1 1 0 0 1 1.7-.7L17 11.6V10a1 1 0 0 1 1.7-.7l2 2a1 1 0 0 1 0 1.4l-2 2A1 1 0 0 1 17 14v-1.6l-4.3 4.3A1 1 0 0 1 11 16v-2a1 1 0 0 0-1.7-.7l-6 6A1 1 0 0 1 2 18V6a1 1 0 0 1 1.7-.7l6 6A1 1 0 0 0 11 10z" />
        </svg>
      </button>

      <div className="flex items-center gap-1 text-xs text-zinc-400 font-mono ml-1">
        <span>{formatTime(currentTime)}</span>
        <span className="text-zinc-600">/</span>
        <span>{formatTime(duration)}</span>
      </div>

      <div className="relative ml-1" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title="Playback speed"
          className="px-1.5 py-1 text-[11px] font-mono text-zinc-300 hover:text-white rounded hover:bg-white/10 transition-colors"
        >
          {playbackRate}×
        </button>
        {menuOpen && (
          <div className="absolute bottom-full left-0 mb-1 min-w-[64px] rounded-lg bg-zinc-700 border border-zinc-600 shadow-xl overflow-hidden z-30">
            {RATES.map((r) => (
              <button
                key={r}
                onClick={() => {
                  setPlaybackRate(r);
                  setMenuOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  playbackRate === r
                    ? "bg-[#00FF66]/20 text-[#00FF66]"
                    : "text-zinc-300 hover:bg-zinc-600"
                }`}
              >
                {r}×
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
