"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/store/editor-store";

// Module-scoped ownership so exactly ONE demo RAF loop can ever run, even if
// the effect re-mounts (React StrictMode double-invoke / HMR re-evaluation in
// dev can otherwise spin up several loops and make demo time run too fast).
let activeLoopId = 0;
let activeLoopRaf: number | null = null;

export function useDemoPlayback(active: boolean) {
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    const duration =
      useEditorStore.getState().project.transcription?.duration || 0;

    // Claim ownership; cancel any prior loop so only the newest survives.
    const loopId = ++activeLoopId;
    if (activeLoopRaf != null) cancelAnimationFrame(activeLoopRaf);

    const tick = (t: number) => {
      if (activeLoopId !== loopId) return;
      const state = useEditorStore.getState();
      if (!state.isPlaying) {
        lastRef.current = null;
        activeLoopRaf = requestAnimationFrame(tick);
        return;
      }
      if (lastRef.current != null) {
        const dt = (t - lastRef.current) / 1000;
        let next = state.currentTime + dt;
        if (next >= duration) {
          next = 0;
          state.setIsPlaying(false);
        }
        state.setCurrentTime(next);
      }
      lastRef.current = t;
      activeLoopRaf = requestAnimationFrame(tick);
    };

    activeLoopRaf = requestAnimationFrame(tick);

    return () => {
      if (activeLoopId === loopId && activeLoopRaf != null) {
        cancelAnimationFrame(activeLoopRaf);
        activeLoopRaf = null;
      }
    };
  }, [active]);
}
