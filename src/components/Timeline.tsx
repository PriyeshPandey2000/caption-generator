"use client";

import { useRef, useCallback, useMemo } from "react";
import { useEditorStore } from "@/store/editor-store";
import { formatTime } from "@/core/captions";
import EditableWord from "@/components/EditableWord";

export default function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const transcription = useEditorStore((s) => s.project.transcription);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const selectWord = useEditorStore((s) => s.selectWord);
  const updateWordText = useEditorStore((s) => s.updateWordText);
  const retimeWord = useEditorStore((s) => s.retimeWord);

  const duration = transcription?.duration || 0;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || !duration) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      setCurrentTime(pct * duration);
    },
    [duration, setCurrentTime]
  );

  const playheadPct = duration ? (currentTime / duration) * 100 : 0;

  const wordPositions = useMemo(() => {
    if (!transcription) return [];
    return transcription.words.map((w) => ({
      ...w,
      startPct: (w.start / duration) * 100,
      widthPct: ((w.end - w.start) / duration) * 100,
    }));
  }, [transcription, duration]);

  return (
    <div className="w-full bg-zinc-900 border-t border-zinc-800 px-4 py-3">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-zinc-400 font-mono w-20">
          {formatTime(currentTime)}
        </span>
        <span className="text-xs text-zinc-600">/</span>
        <span className="text-xs text-zinc-500 font-mono w-20">
          {formatTime(duration)}
        </span>
      </div>

      <div
        ref={containerRef}
        onClick={handleClick}
        className="relative h-16 bg-zinc-800 rounded-lg cursor-crosshair overflow-hidden"
      >
        {wordPositions.map((w, i) => {
          const prevEnd = i > 0 ? wordPositions[i - 1].end : 0;
          const nextStart = i < wordPositions.length - 1 ? wordPositions[i + 1].start : duration;
          return (
            <div
              key={w.id}
              onClick={(e) => {
                e.stopPropagation();
                selectWord(w.id, e.metaKey || e.ctrlKey);
              }}
              className={`
                absolute top-1 bottom-1 rounded-sm cursor-pointer transition-opacity
                ${
                  selectedWordIds.includes(w.id)
                    ? "bg-blue-500/60 opacity-100"
                    : "bg-zinc-600/50 hover:bg-zinc-500/60 opacity-70"
                }
              `}
              style={{
                left: `${w.startPct}%`,
                width: `${Math.max(w.widthPct, 0.3)}%`,
              }}
              title={w.text}
            >
              {/* Left edge handle */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 hover:bg-[#00FF66]/60 transition-colors rounded-l-sm"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const rect = containerRef.current!.getBoundingClientRect();
                  const startX = e.clientX;
                  const startVal = w.start;
                  const move = (ev: MouseEvent) => {
                    const dx = ev.clientX - startX;
                    const dt = (dx / rect.width) * duration;
                    const newStart = Math.min(Math.max(startVal + dt, prevEnd), w.end - 0.05);
                    retimeWord(w.id, newStart, w.end);
                  };
                  const up = () => {
                    window.removeEventListener("mousemove", move);
                    window.removeEventListener("mouseup", up);
                  };
                  window.addEventListener("mousemove", move);
                  window.addEventListener("mouseup", up);
                }}
              />
              {/* Right edge handle */}
              <div
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 hover:bg-[#00FF66]/60 transition-colors rounded-r-sm"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const rect = containerRef.current!.getBoundingClientRect();
                  const startX = e.clientX;
                  const startVal = w.end;
                  const move = (ev: MouseEvent) => {
                    const dx = ev.clientX - startX;
                    const dt = (dx / rect.width) * duration;
                    const newEnd = Math.max(Math.min(startVal + dt, nextStart), w.start + 0.05);
                    retimeWord(w.id, w.start, newEnd);
                  };
                  const up = () => {
                    window.removeEventListener("mousemove", move);
                    window.removeEventListener("mouseup", up);
                  };
                  window.addEventListener("mousemove", move);
                  window.addEventListener("mouseup", up);
                }}
              />
            </div>
          );
        })}

        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
        </div>
      </div>

      {transcription && (
        <div className="mt-2 flex flex-wrap gap-1">
          {transcription.words
            .filter(
              (w) =>
                currentTime >= w.start - 0.1 && currentTime <= w.end + 0.1
            )
            .map((w) => (
              <EditableWord
                key={w.id}
                text={w.text}
                onSelect={() => {
                  setCurrentTime(w.start);
                  selectWord(w.id);
                }}
                onCommit={(t) => updateWordText(w.id, t)}
                fieldName={`timeline-word-${w.id}`}
                className={`
                  text-xs px-2 py-0.5 rounded cursor-pointer transition-colors inline-block
                  ${
                    selectedWordIds.includes(w.id)
                      ? "bg-blue-500/30 text-blue-300"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }
                `}
                inputClassName="text-xs px-2 py-0.5 rounded ring-2 ring-[#00FF66]"
              />
            ))}
        </div>
      )}
    </div>
  );
}
