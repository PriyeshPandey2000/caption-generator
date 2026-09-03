"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/store/editor-store";

export function useDemoPlayback(active: boolean) {
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const duration = useEditorStore.getState().project.transcription?.duration || 0;

    const tick = (t: number) => {
      const state = useEditorStore.getState();
      if (!state.isPlaying) {
        lastRef.current = null;
        rafRef.current = requestAnimationFrame(tick);
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
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);
}
