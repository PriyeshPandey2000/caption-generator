"use client";

import { useMemo } from "react";
import { useEditorStore } from "@/store/editor-store";
import { resolveWordStyle } from "@/core/styles";
import { Word } from "@/core/types";
import EditableWord from "@/components/EditableWord";

export default function CaptionOverlay() {
  const transcription = useEditorStore((s) => s.project.transcription);
  const globalStyle = useEditorStore((s) => s.project.globalStyle);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const selectWord = useEditorStore((s) => s.selectWord);
  const selectedGroupId = useEditorStore((s) => s.selectedCaptionGroupId);
  const selectCaptionGroup = useEditorStore((s) => s.selectCaptionGroup);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const groupLayouts = useEditorStore((s) => s.groupLayouts);

  const activeGroup = useMemo(() => {
    if (!transcription) return null;
    return (
      transcription.captionGroups.find(
        (g) => currentTime >= g.start && currentTime <= g.end
      ) || null
    );
  }, [transcription, currentTime]);

  const activeWords = useMemo(() => {
    const active: Word[] = [];
    if (!activeGroup || !transcription) return active;
    for (const wid of activeGroup.wordIds) {
      const w = transcription.words.find((word) => word.id === wid);
      if (w) active.push(w);
    }
    return active;
  }, [activeGroup, transcription]);

  if (!transcription || activeWords.length === 0) return null;

  const layout = groupLayouts[activeGroup?.id || ""] || { x: 0, y: 0, scale: 1 };
  const isSelected = selectedGroupId === activeGroup?.id;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) clearSelection();
      }}
    >
      <div
        className="relative inline-block"
        style={{
          position: "absolute",
          left: "50%",
          top: `${globalStyle.transform.y}%`,
          transform: `translate(-50%, 0) translate(${layout.x}px, ${layout.y}px) scale(${layout.scale})`,
          maxWidth: `${globalStyle.style.maxWidth}px`,
        }}
      >
        <div
          className="flex flex-wrap justify-center gap-x-2 gap-y-1 pointer-events-auto cursor-move"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            if (!activeGroup) return;
            selectCaptionGroup(activeGroup.id);
            const startX = e.clientX;
            const startY = e.clientY;
            const startLayout = useEditorStore.getState().groupLayouts[activeGroup.id] || { x: 0, y: 0, scale: 1 };
            const move = (ev: MouseEvent) => {
              useEditorStore
                .getState()
                .updateGroupLayout(activeGroup.id, {
                  x: startLayout.x + (ev.clientX - startX),
                  y: startLayout.y + (ev.clientY - startY),
                });
            };
            const up = () => {
              window.removeEventListener("mousemove", move);
              window.removeEventListener("mouseup", up);
            };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
          }}
          style={{ maxWidth: `${globalStyle.style.maxWidth}px` }}
        >
          {activeWords.map((word) => (
            <WordSpan
              key={word.id}
              word={word}
              isSelected={selectedWordIds.includes(word.id)}
              onSelect={(e) => selectWord(word.id, e.metaKey || e.ctrlKey)}
            />
          ))}
        </div>

        {isSelected && (
          <ScaleHandle
            onDelta={() =>
              activeGroup &&
              useEditorStore
                .getState()
                .updateGroupLayout(activeGroup.id, { scale: Math.max(0.5, layout.scale + 0.05) })
            }
          />
        )}
      </div>
    </div>
  );
}

function WordSpan({
  word,
  isSelected,
  onSelect,
}: {
  word: Word;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const globalStyle = useEditorStore((s) => s.project.globalStyle);
  const speakerStyles = useEditorStore((s) => s.project.speakerStyles);
  const currentTime = useEditorStore((s) => s.currentTime);

  const style = resolveWordStyle(word, speakerStyles, globalStyle);

  const entrance = word.animation?.entrance || globalStyle.motion.entrance;
  const activeAnim = word.animation?.active || globalStyle.motion.active;
  const emphasis = word.animation?.emphasis || globalStyle.motion.emphasis;
  const exit = word.animation?.exit || globalStyle.motion.exit;

  const isSpokenNow = currentTime >= word.start && currentTime < word.end;
  const hasEnded = currentTime >= word.end;

  const animStyle: React.CSSProperties = {};

  // Entrance: scale 80→100 in 180ms after word appears
  if (entrance && entrance.type === "scale") {
    const elapsed = (currentTime - word.start) * 1000;
    const duration = entrance.duration || 180;
    const progress = Math.min(1, Math.max(0, elapsed / duration));
    const scale =
      (entrance.scaleFrom || 80) +
      ((entrance.scaleTo || 100) - (entrance.scaleFrom || 80)) * progress;
    animStyle.transform = `scale(${scale / 100})`;
  }

  // Active-word or emphasis: pop while spoken
  if (emphasis && emphasis.type === "scale" && isSpokenNow) {
    animStyle.transform = `scale(${(emphasis.scaleTo || 140) / 100})`;
    if (emphasis.color) animStyle.color = emphasis.color;
    if (emphasis.glowRadius) {
      animStyle.textShadow = `0 0 ${emphasis.glowRadius}px ${emphasis.color || "#FFD700"}`;
    }
  } else if (activeAnim && activeAnim.type === "scale" && isSpokenNow) {
    animStyle.transform = `scale(${(activeAnim.scaleTo || 125) / 100})`;
    if (activeAnim.color) animStyle.color = activeAnim.color;
    if (activeAnim.glowRadius) {
      animStyle.textShadow = `0 0 ${activeAnim.glowRadius}px ${activeAnim.color || "#FFD700"}`;
    }
  }

  // Exit: fade out after word ends. Pure function of currentTime (not
  // gated on isPlaying) so pausing or scrubbing mid-fade doesn't snap the
  // word back to fully visible.
  if (exit && hasEnded) {
    const elapsedMs = (currentTime - word.end) * 1000;
    const exitDuration = exit.duration || 120;
    const progress = Math.min(1, Math.max(0, elapsedMs / exitDuration));
    const fromOpacity = exit.from ?? 1;
    const toOpacity = exit.to ?? 0;
    animStyle.opacity = fromOpacity + (toOpacity - fromOpacity) * progress;
  }

  const updateWordText = useEditorStore((s) => s.updateWordText);

  return (
    <EditableWord
      text={word.text}
      onSelect={onSelect}
      onCommit={(t) => updateWordText(word.id, t)}
      fieldName={`word-${word.id}`}
      className={`
        inline-block cursor-pointer select-none transition-transform
        ${
          isSelected
            ? "ring-2 ring-[#00FF66] ring-offset-2 ring-offset-transparent rounded"
            : ""
        }
      `}
      inputClassName="ring-2 ring-[#00FF66] rounded px-0.5"
      style={{
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSize}px`,
        color: style.color,
        fontWeight: style.fontWeight,
        letterSpacing: `${style.letterSpacing}px`,
        textTransform: style.textTransform,
        WebkitTextStroke: style.strokeWidth
          ? `${style.strokeWidth}px ${style.strokeColor}`
          : undefined,
        textShadow: style.shadowColor
          ? `${style.shadowOffsetX || 0}px ${style.shadowOffsetY || 0}px ${style.shadowBlur || 0}px ${style.shadowColor}`
          : undefined,
        opacity: style.opacity,
        ...animStyle,
      }}
    />
  );
}

function ScaleHandle({ onDelta }: { onDelta: () => void }) {
  return (
    <div
      className="absolute -bottom-3 -right-3 w-6 h-6 bg-blue-500 border-2 border-white rounded cursor-nwse-resize flex items-center justify-center"
      onMouseDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const move = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          if (Math.max(Math.abs(dx), Math.abs(ev.clientY - startY)) > 8) {
            const steps = Math.max(1, Math.round(dx / 24));
            for (let i = 0; i < steps; i++) onDelta();
            window.removeEventListener("mousemove", move);
          }
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    >
      <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M21 3l-6 6m0 0h4m-4 0V5M3 21l6-6m0 0h-4m4 0v4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
