"use client";

import { useMemo, useRef, useState, useLayoutEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import { resolveWordStyle, MIN_CAPTION_Y, MAX_CAPTION_Y } from "@/core/styles";
import { easeProgress } from "@/core/easing";
import { Word, WordStyle } from "@/core/types";
import EditableWord from "@/components/EditableWord";

// Below this drag distance (px), a mousedown-then-up is treated as a plain
// click (clear selection / toggle play), not a marquee — otherwise the
// tiniest hand tremor would start a rubber-band selection.
const MARQUEE_THRESHOLD = 4;

// Matches WordSpan's `exit.duration || 120` fallback (single source of truth
// so the active-group grace window and the rendered fade can never drift).
const EXIT_FADE_DEFAULT_DURATION_MS = 120;

export default function CaptionOverlay({
  onBackgroundClick,
  scaleFactor = 1,
}: {
  /** Fired on a plain click (no drag) on empty overlay space — lets the
   * host (VideoPreview) keep its click-to-play/pause behavior even though
   * this overlay now captures pointer events for marquee selection. */
  onBackgroundClick?: () => void;
  /** Size multiplier applied to everything measured in caption-design px so
   * captions stay proportionally sized when the canvas is narrower than the
   * 1280-wide design surface (e.g. the 9:16 platform crop). Applied to real
   * rendered props (font-size, letter-spacing, stroke, shadows, max-width),
   * not a wrapper transform — a transform would leave the selection frame,
   * drag handles and word hit-testing at unscaled geometry. */
  scaleFactor?: number;
}) {
  const transcription = useEditorStore((s) => s.project.transcription);
  const globalStyle = useEditorStore((s) => s.project.globalStyle);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const selectWord = useEditorStore((s) => s.selectWord);
  const setSelectedWords = useEditorStore((s) => s.setSelectedWords);
  const selectedGroupId = useEditorStore((s) => s.selectedCaptionGroupId);
  const selectCaptionGroup = useEditorStore((s) => s.selectCaptionGroup);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const groupLayouts = useEditorStore((s) => s.groupLayouts);
  const speakerStyles = useEditorStore((s) => s.project.speakerStyles);
  const updateWordStyle = useEditorStore((s) => s.updateWordStyle);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [frame, setFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [wordFrame, setWordFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const activeGroup = useMemo(() => {
    if (!transcription) return null;
    const groups = transcription.captionGroups;
    // A group's wordIds are what it renders while active, so its "active"
    // window must stay open a touch past g.end to cover the last word's
    // exit-fade (see WordSpan) — g.end IS that last word's end, so a plain
    // half-open [start, end) lookup unmounts the group the instant the fade
    // should begin and sentence endings hard-cut instead of fading.
    //
    // Extend the window by the last word's resolved exit duration (its
    // explicit per-word recipe, else the global motion's), but never past
    // the next group's start: if two sentences sit close together the
    // incoming one must not be delayed — the outgoing one just gets its fade
    // cut short. Half-open start-inclusive / end-exclusive rules are kept so
    // a zero-gap boundary still resolves to the incoming group (the "ghost
    // previous word" fix), and when there's no exit animation the grace
    // window collapses to zero.
    //
    // g.end and nextStart are seconds (word timestamps, currentTime); the
    // exit duration is milliseconds (WordSpan converts elapsed time to ms
    // before comparing against exit.duration), so convert before adding.
    const match = groups.find((g, i) => {
      const lastWordId = g.wordIds[g.wordIds.length - 1];
      const lastWord = lastWordId ? transcription.words.find((w) => w.id === lastWordId) : undefined;
      const exit = lastWord?.animation?.exit || globalStyle.motion.exit;
      const exitDurationMs = exit ? exit.duration || EXIT_FADE_DEFAULT_DURATION_MS : 0;
      const nextStart = groups[i + 1]?.start ?? Infinity;
      const graceEnd = Math.min(g.end + exitDurationMs / 1000, nextStart);
      return currentTime >= g.start && currentTime < graceEnd;
    });
    if (match) return match;
    // Exception: the very last group must still render at the transcript's
    // exact closing instant (e.g. scrubbed to the end) — the half-open check
    // above excludes that instant for every group (including the last one)
    // when its exit grace window is zero, and it's already covered by the
    // grace window otherwise.
    const last = groups[groups.length - 1];
    if (last && currentTime === last.end) return last;
    return null;
  }, [transcription, currentTime, globalStyle]);

  const activeWords = useMemo(() => {
    const active: Word[] = [];
    if (!activeGroup || !transcription) return active;
    for (const wid of activeGroup.wordIds) {
      const w = transcription.words.find((word) => word.id === wid);
      if (w) active.push(w);
    }
    return active;
  }, [activeGroup, transcription]);

  const layout = groupLayouts[activeGroup?.id || ""] || { x: 0, y: 0, scale: 1 };
  const isSelected = selectedGroupId === activeGroup?.id;
  const singleWordId = selectedWordIds.length === 1 ? selectedWordIds[0] : null;

  // The row is visually resized via `transform: scale()` (paint-only — it
  // never affects layout), so the wrapper's own box stays at the row's
  // unscaled size. Positioning the resize handles/toolbar from CSS classes
  // anchored to the wrapper would put them at the pre-scale corners, adrift
  // from the actual (bigger/smaller) rendered text. Instead measure the
  // row's real on-screen box and position an exact-sized frame for them.
  // Re-measures on every currentTime tick too, since active/emphasis word
  // pops change the row's rendered size continuously during playback.
  useLayoutEffect(() => {
    if (!isSelected || !rowRef.current || !wrapperRef.current) {
      setFrame(null);
      return;
    }
    const measure = () => {
      if (!rowRef.current || !wrapperRef.current) return;
      const rowRect = rowRef.current.getBoundingClientRect();
      const wrapRect = wrapperRef.current.getBoundingClientRect();
      setFrame({
        left: rowRect.left - wrapRect.left,
        top: rowRect.top - wrapRect.top,
        width: rowRect.width,
        height: rowRect.height,
      });
    };
    measure();
    // Also re-measure when the rendered geometry changes without any of the
    // deps below changing — a floating-toolbar font-family/size edit or a
    // committed word-text edit reflows the row (word pops already tick via
    // currentTime). Without this the selection frame drifts from the text.
    const ro = new ResizeObserver(measure);
    ro.observe(rowRef.current);
    return () => ro.disconnect();
  }, [isSelected, layout.scale, currentTime, activeGroup?.id]);

  // A single selected word gets the same border-frame treatment as a
  // selected group, not a CSS `outline` on the word span itself — outline
  // and border render dashed patterns differently (different dash spacing
  // even at identical width), so reusing one mechanism keeps both looking
  // pixel-identical instead of "why is this one thicker."
  useLayoutEffect(() => {
    if (!singleWordId || !rowRef.current || !wrapperRef.current) {
      setWordFrame(null);
      return;
    }
    const wordEl = rowRef.current.querySelector<HTMLElement>(`[data-word-id="${singleWordId}"]`);
    if (!wordEl) {
      setWordFrame(null);
      return;
    }
    const measure = () => {
      if (!rowRef.current || !wrapperRef.current) return;
      const wordRect = wordEl.getBoundingClientRect();
      const wrapRect = wrapperRef.current.getBoundingClientRect();
      const buffer = 8; // breathing room so the dashed frame isn't flush against the glyphs
      setWordFrame({
        left: wordRect.left - wrapRect.left - buffer,
        top: wordRect.top - wrapRect.top - buffer,
        width: wordRect.width + buffer * 2,
        height: wordRect.height + buffer * 2,
      });
    };
    measure();
    // Font/size/text edits on this word reflow it without changing the deps
    // below; a ResizeObserver keeps the single-word frame glued to it.
    const ro = new ResizeObserver(measure);
    ro.observe(wordEl);
    return () => ro.disconnect();
  }, [singleWordId, layout.scale, currentTime, activeGroup?.id]);

  if (!transcription || activeWords.length === 0) return null;

  const groupBg = globalStyle.style.backgroundColor;
  const hasBg = groupBg && groupBg !== "transparent";

  const yPct = Math.min(MAX_CAPTION_Y, Math.max(MIN_CAPTION_Y, globalStyle.transform.y ?? 80));
  const maxW = globalStyle.style.maxWidth ?? 800;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const startX = e.clientX;
        const startY = e.clientY;
        // Captured once here (an event handler, not render) so the render
        // path never needs to read the ref itself.
        const containerRect = overlayRef.current?.getBoundingClientRect();
        let dragged = false;

        const move = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (!dragged && Math.max(Math.abs(dx), Math.abs(dy)) < MARQUEE_THRESHOLD) return;
          dragged = true;
          const left = (containerRect?.left ?? 0);
          const top = (containerRect?.top ?? 0);
          setMarquee({
            x1: Math.min(startX, ev.clientX) - left,
            y1: Math.min(startY, ev.clientY) - top,
            x2: Math.max(startX, ev.clientX) - left,
            y2: Math.max(startY, ev.clientY) - top,
          });
        };

        const up = (ev: MouseEvent) => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          if (dragged) {
            const rect1 = {
              left: Math.min(startX, ev.clientX),
              top: Math.min(startY, ev.clientY),
              right: Math.max(startX, ev.clientX),
              bottom: Math.max(startY, ev.clientY),
            };
            const nodes = overlayRef.current?.querySelectorAll<HTMLElement>("[data-word-id]") ?? [];
            const hitIds: string[] = [];
            nodes.forEach((el) => {
              const r = el.getBoundingClientRect();
              const intersects =
                r.left < rect1.right && r.right > rect1.left && r.top < rect1.bottom && r.bottom > rect1.top;
              if (intersects && el.dataset.wordId) hitIds.push(el.dataset.wordId);
            });
            setSelectedWords(hitIds);
            setMarquee(null);
          } else {
            clearSelection();
            onBackgroundClick?.();
          }
        };

        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    >
      {marquee && (
        <div
          className="absolute border border-blue-400 bg-blue-400/15 pointer-events-none"
          style={{
            left: marquee.x1,
            top: marquee.y1,
            width: marquee.x2 - marquee.x1,
            height: marquee.y2 - marquee.y1,
          }}
        />
      )}
      <div
        ref={wrapperRef}
        className="relative"
        style={{
          position: "absolute",
          left: "50%",
          top: `${yPct}%`,
          transform: `translate(-50%, -50%) translate(${layout.x}px, ${layout.y}px)`,
          width: "max-content",
          maxWidth: `min(${maxW * scaleFactor}px, 92%)`,
        }}
      >
        <div
          ref={rowRef}
          className="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1 pointer-events-auto cursor-move"
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
          style={{
            transform: `scale(${layout.scale})`,
            ...(hasBg
              ? {
                  backgroundColor: groupBg,
                  padding: `${(globalStyle.style.backgroundPadding ?? 6) * scaleFactor}px ${(globalStyle.style.backgroundPadding ?? 6) * 2 * scaleFactor}px`,
                  borderRadius: `${(globalStyle.style.backgroundBorderRadius ?? 8) * scaleFactor}px`,
                  boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
                }
              : {}),
          }}
        >
          {activeWords.map((word, i) => (
            <WordSpan
              key={word.id}
              word={word}
              scaleFactor={scaleFactor}
              isSelected={selectedWordIds.includes(word.id) && selectedWordIds.length > 1}
              onSelect={(e) => selectWord(word.id, e.metaKey || e.ctrlKey)}
              isGroupLastWord={i === activeWords.length - 1}
            />
          ))}
        </div>

        {isSelected && frame && (
          <div
            className="absolute pointer-events-none border border-dashed border-black"
            style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
          >
            <ResizeHandles
              scale={layout.scale}
              onScale={(s) =>
                activeGroup &&
                useEditorStore
                  .getState()
                  .updateGroupLayout(activeGroup.id, { scale: Math.max(0.5, s) })
              }
            />
            <FloatingToolbar
              style={resolveWordStyle(activeWords[0], speakerStyles, globalStyle)}
              onChange={(patch) => {
                for (const wid of activeGroup?.wordIds ?? []) updateWordStyle(wid, patch);
              }}
            />
          </div>
        )}

        {!isSelected && wordFrame && (
          <div
            className="absolute pointer-events-none border border-dashed border-black"
            style={{ left: wordFrame.left, top: wordFrame.top, width: wordFrame.width, height: wordFrame.height }}
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
  scaleFactor = 1,
  isGroupLastWord,
}: {
  word: Word;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  scaleFactor: number;
  isGroupLastWord: boolean;
}) {
  const globalStyle = useEditorStore((s) => s.project.globalStyle);
  const speakerStyles = useEditorStore((s) => s.project.speakerStyles);
  const currentTime = useEditorStore((s) => s.currentTime);

  const style = resolveWordStyle(word, speakerStyles, globalStyle);
  const baseFontSize = (style.fontSize ?? 48) * scaleFactor;

  const entrance = word.animation?.entrance || globalStyle.motion.entrance;
  const activeAnim = word.animation?.active || globalStyle.motion.active;
  const emphasis = word.animation?.emphasis || globalStyle.motion.emphasis;
  const exit = word.animation?.exit || globalStyle.motion.exit;

  const isSpokenNow = currentTime >= word.start && currentTime < word.end;
  const hasEnded = currentTime >= word.end;

  const animStyle: React.CSSProperties = {};

  const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
  const clampAmount = (v: number) => Math.min(1, Math.max(0, v));
  const clampFont = (px: number) => Math.max(baseFontSize * 0.02, px);

  // Entrance: scale 80→100 in 180ms after word appears (eased per-recipe, so
  // a cubic-bezier overshoot pops). Animate font-size, not transform: scale —
  // same reasoning as the active-word pop below: transform distorts
  // -webkit-text-stroke into a jagged/artifacted outline on scaled glyphs.
  // Fade ramps opacity in; glow ramps a text-shadow bloom up while fading in.
  if (entrance && entrance.type === "scale") {
    const elapsed = (currentTime - word.start) * 1000;
    const duration = entrance.duration || 180;
    const progress = easeProgress(
      Math.min(1, Math.max(0, elapsed / duration)),
      entrance.easing
    );
    const scale =
      (entrance.scaleFrom ?? 80) +
      ((entrance.scaleTo ?? 100) - (entrance.scaleFrom ?? 80)) * progress;
    animStyle.fontSize = `${clampFont((baseFontSize * scale) / 100)}px`;
  }

  const entranceElapsed = (currentTime - word.start) * 1000;
  const entranceActive =
    entrance &&
    currentTime >= word.start &&
    entranceElapsed < (entrance.duration || 250);

  if (entrance && entrance.type === "fade" && entranceActive) {
    const progress = easeProgress(
      Math.min(1, Math.max(0, entranceElapsed / (entrance.duration || 250))),
      entrance.easing
    );
    animStyle.opacity = clampAmount(
      lerp(entrance.from ?? 0, entrance.to ?? (style.opacity ?? 1), progress)
    );
  } else if (entrance && entrance.type === "glow" && entranceActive) {
    const progress = easeProgress(
      Math.min(1, Math.max(0, entranceElapsed / (entrance.duration || 300))),
      entrance.easing
    );
    animStyle.opacity = clampAmount(
      lerp(entrance.from ?? 0, entrance.to ?? (style.opacity ?? 1), progress)
    );
    animStyle.textShadow = `0 0 ${(entrance.glowRadius ?? 20) * scaleFactor * progress}px ${entrance.color || "#FFD700"}`;
  }

  // Active-word or emphasis: pop while spoken. Animate real font-size (not
  // transform: scale) so the word reflows and pushes its neighbors apart
  // instead of visually overlapping them — transform is paint-only and
  // doesn't reserve the extra layout space the enlarged glyph needs. This
  // also avoids a stroke-rendering artifact where -webkit-text-stroke gets
  // stretched by the transform and looks jagged on diagonal letters (A/M/N).
  // Choreography-emphasis words still win over the global while-spoken recipe
  // (camera punch + SFX key off word.animation.emphasis). A "glow" type
  // blooms a text-shadow instead of scaling.
  const isEmphasisWord = !!emphasis;
  const spoken = emphasis ?? activeAnim;
  if (isSpokenNow && spoken && spoken.type === "scale") {
    animStyle.fontSize = `${clampFont((baseFontSize * (spoken.scaleTo ?? (isEmphasisWord ? 140 : 125))) / 100)}px`;
    // A user's explicit per-word color override always wins over the
    // karaoke-style animation color — otherwise a paused, selected word
    // (which is "spoken now" by definition) silently reverts to the
    // animation's color and the color picker looks broken.
    if (spoken.color && !word.style?.color) animStyle.color = spoken.color;
    if (spoken.glowRadius) {
      animStyle.textShadow = `0 0 ${spoken.glowRadius * scaleFactor}px ${spoken.color || "#FFD700"}`;
    }
  } else if (isSpokenNow && spoken && spoken.type === "glow") {
    if (spoken.color && !word.style?.color) animStyle.color = spoken.color;
    animStyle.textShadow = `0 0 ${(spoken.glowRadius ?? 22) * scaleFactor}px ${spoken.color || "#FFD700"}`;
  }

  // Exit: fade out after word ends, optionally shrinking (exit "scale"). Pure
  // function of currentTime (not
  // gated on isPlaying) so pausing or scrubbing mid-fade doesn't snap the
  // word back to fully visible. Only the group's last word fades — an
  // already-spoken word earlier in the same caption line must stay fully
  // visible while its still-being-spoken group-mates are showing, or the
  // line reads as missing a word (a "ghost"/ ghosted-out word) instead of
  // the whole line fading together when the group actually ends.
  if (exit && exit.type !== "none" && hasEnded && isGroupLastWord) {
    const elapsedMs = (currentTime - word.end) * 1000;
    const exitDuration = exit.duration || EXIT_FADE_DEFAULT_DURATION_MS;
    const progress = easeProgress(
      Math.min(1, Math.max(0, elapsedMs / exitDuration)),
      exit.easing
    );
    if (exit.type === "scale") {
      const scale =
        (exit.scaleFrom ?? 100) +
        ((exit.scaleTo ?? 0) - (exit.scaleFrom ?? 100)) * progress;
      animStyle.fontSize = `${clampFont((baseFontSize * scale) / 100)}px`;
    }
    animStyle.opacity = clampAmount(lerp(exit.from ?? 1, exit.to ?? 0, progress));
  }

  const updateWordText = useEditorStore((s) => s.updateWordText);

  return (
    <EditableWord
      text={word.text}
      onSelect={onSelect}
      onCommit={(t) => updateWordText(word.id, t)}
      fieldName={`word-${word.id}`}
      dataWordId={word.id}
      className={`
        inline-block cursor-pointer select-none transition-[transform,font-size]
        ${
          isSelected
            ? "outline outline-1 outline-dashed outline-black outline-offset-4"
            : ""
        }
      `}
      inputClassName="ring-2 ring-[#00FF66] rounded px-0.5"
      style={{
        fontFamily: style.fontFamily,
        fontSize: `${(style.fontSize ?? 48) * scaleFactor}px`,
        color: style.color,
        fontWeight: style.fontWeight,
        letterSpacing: `${(style.letterSpacing ?? 0) * scaleFactor}px`,
        textTransform: style.textTransform,
        WebkitTextStroke: style.strokeWidth
          ? `${style.strokeWidth * scaleFactor}px ${style.strokeColor}`
          : undefined,
        textShadow: style.shadowColor
          ? `${(style.shadowOffsetX || 0) * scaleFactor}px ${(style.shadowOffsetY || 0) * scaleFactor}px ${(style.shadowBlur || 0) * scaleFactor}px ${style.shadowColor}`
          : undefined,
        opacity: style.opacity,
        ...animStyle,
      }}
    />
  );
}

const TOOLBAR_FONTS = [
  { label: "Anton", value: "var(--font-anton), Impact, 'Arial Black', sans-serif" },
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Impact", value: "Impact, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Monospace", value: "monospace" },
  { label: "Comic Sans", value: "'Comic Sans MS', 'Chalkboard SE', sans-serif" },
];

function FloatingToolbar({
  style,
  onChange,
}: {
  style: WordStyle;
  onChange: (patch: Partial<WordStyle>) => void;
}) {
  return (
    <div
      className="absolute top-full mt-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-2 shadow-xl pointer-events-auto whitespace-nowrap z-20 cursor-default"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <select
        value={style.fontFamily ?? ""}
        onChange={(e) => onChange({ fontFamily: e.target.value })}
        className="bg-zinc-800 text-white text-xs rounded px-2 py-1.5 border border-zinc-700 focus:outline-none max-w-[92px]"
        title="Font family"
      >
        {!TOOLBAR_FONTS.some((f) => f.value === style.fontFamily) && (
          <option value={style.fontFamily ?? ""}>
            {style.fontFamily?.split(",")[0] ?? "Custom"}
          </option>
        )}
        {TOOLBAR_FONTS.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      <div
        className="flex items-center gap-1 bg-zinc-800 rounded px-1.5 py-1 border border-zinc-700"
        title="Font size"
      >
        <button
          type="button"
          onClick={() => onChange({ fontSize: Math.max(12, (style.fontSize ?? 48) - 2) })}
          className="w-5 h-5 flex items-center justify-center text-zinc-300 hover:text-white text-sm leading-none"
        >
          −
        </button>
        <span className="text-xs text-white w-7 text-center font-mono">
          {style.fontSize ?? 48}
        </span>
        <button
          type="button"
          onClick={() => onChange({ fontSize: (style.fontSize ?? 48) + 2 })}
          className="w-5 h-5 flex items-center justify-center text-zinc-300 hover:text-white text-sm leading-none"
        >
          +
        </button>
      </div>

      <label
        className="relative w-7 h-7 rounded border border-zinc-700 overflow-hidden cursor-pointer shrink-0"
        title="Text color"
      >
        <input
          type="color"
          value={style.color || "#FFFFFF"}
          onChange={(e) => onChange({ color: e.target.value })}
          className="absolute -inset-1 w-9 h-9 cursor-pointer"
        />
      </label>

      <label
        className="relative w-7 h-7 rounded border border-zinc-700 overflow-hidden cursor-pointer shrink-0"
        title="Stroke color"
      >
        <input
          type="color"
          value={style.strokeColor || "#000000"}
          onChange={(e) => onChange({ strokeColor: e.target.value })}
          className="absolute -inset-1 w-9 h-9 cursor-pointer"
        />
      </label>

      <div
        className="flex items-center gap-1 bg-zinc-800 rounded px-1.5 py-1 border border-zinc-700"
        title="Stroke width"
      >
        <button
          type="button"
          onClick={() => onChange({ strokeWidth: Math.max(0, (style.strokeWidth ?? 0) - 1) })}
          className="w-5 h-5 flex items-center justify-center text-zinc-300 hover:text-white text-sm leading-none"
        >
          −
        </button>
        <span className="text-xs text-white w-5 text-center font-mono">
          {style.strokeWidth ?? 0}
        </span>
        <button
          type="button"
          onClick={() => onChange({ strokeWidth: (style.strokeWidth ?? 0) + 1 })}
          className="w-5 h-5 flex items-center justify-center text-zinc-300 hover:text-white text-sm leading-none"
        >
          +
        </button>
      </div>
    </div>
  );
}

// 4 corners + 4 edge midpoints, Figma-style. Every handle drives the same
// uniform `scale` (there's no separate width/height in the data model — a
// caption block is text, not a box) — `dir` is the outward unit vector for
// that handle's position, so dragging away from the block always grows it
// and dragging toward the center always shrinks it, regardless of which of
// the 8 handles was grabbed.
const RESIZE_HANDLES: { key: string; className: string; dir: [number, number] }[] = [
  { key: "tl", className: "-top-1.5 -left-1.5 cursor-nwse-resize", dir: [-1, -1] },
  { key: "t", className: "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize", dir: [0, -1] },
  { key: "tr", className: "-top-1.5 -right-1.5 cursor-nesw-resize", dir: [1, -1] },
  { key: "r", className: "top-1/2 -translate-y-1/2 -right-1.5 cursor-ew-resize", dir: [1, 0] },
  { key: "br", className: "-bottom-1.5 -right-1.5 cursor-nwse-resize", dir: [1, 1] },
  { key: "b", className: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize", dir: [0, 1] },
  { key: "bl", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize", dir: [-1, 1] },
  { key: "l", className: "top-1/2 -translate-y-1/2 -left-1.5 cursor-ew-resize", dir: [-1, 0] },
];

function ResizeHandles({
  scale,
  onScale,
}: {
  scale: number;
  onScale: (scale: number) => void;
}) {
  return (
    <>
      {RESIZE_HANDLES.map(({ key, className, dir }) => (
        <div
          key={key}
          className={`absolute w-3 h-3 bg-blue-500 border-2 border-white rounded-sm z-10 pointer-events-auto ${className}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const startX = e.clientX;
            const startY = e.clientY;
            const startScale = scale;
            const len = Math.hypot(dir[0], dir[1]) || 1;
            const move = (ev: MouseEvent) => {
              const dx = ev.clientX - startX;
              const dy = ev.clientY - startY;
              // Project the drag onto this handle's outward direction so
              // dragging away from the block grows it, toward it shrinks it.
              const projected = (dx * dir[0] + dy * dir[1]) / len;
              onScale(Math.max(0.5, startScale + projected / 100));
            };
            const up = () => {
              window.removeEventListener("mousemove", move);
              window.removeEventListener("mouseup", up);
            };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
          }}
        />
      ))}
    </>
  );
}
