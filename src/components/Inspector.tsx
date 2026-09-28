"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import { Word, WordStyle, WordMotion, AnimationRecipe, SfxName, SfxEvent } from "@/core/types";
import { MIN_CAPTION_Y, MAX_CAPTION_Y, resolveWordStyle, resolveWordMotion, FONT_FAMILY_OPTIONS } from "@/core/styles";
import {
  SHADOW_LOOKS,
  alphaOf,
  resolveShadowSpec,
  shadowFineTunePatch,
  shadowLookHint,
  shadowLookOf,
  shadowPatchForLook,
} from "@/core/shadow";
import { sliderFillStyle } from "./rangeFill";

// MotionControls always emits a full per-phase recipe merged against the word
// it's currently showing (see its updateRecipe), not just the field the user
// touched — correct when applying to that one word, but wrong for "all
// words": it would stamp the displayed word's untouched fields (type, easing,
// ...) over every other word's own recipe. Diffing the emitted recipe against
// the one MotionControls was rendered with recovers just what changed, which
// applyMotionToAllWords can safely layer onto each word's own phase.
function diffWordMotion(
  base: WordMotion,
  next: Partial<WordMotion>
): Partial<Record<keyof WordMotion, Partial<AnimationRecipe>>> {
  const diff: Partial<Record<keyof WordMotion, Partial<AnimationRecipe>>> = {};
  for (const phase of Object.keys(next) as (keyof WordMotion)[]) {
    const nextRecipe = next[phase] as Record<string, unknown> | undefined;
    if (!nextRecipe) continue;
    const baseRecipe = base[phase] as Record<string, unknown> | undefined;
    const changed: Record<string, unknown> = {};
    for (const field of Object.keys(nextRecipe)) {
      if (nextRecipe[field] !== baseRecipe?.[field]) changed[field] = nextRecipe[field];
    }
    diff[phase] = changed as Partial<AnimationRecipe>;
  }
  return diff;
}

export default function Inspector() {
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const transcription = useEditorStore((s) => s.project.transcription);
  const globalStyle = useEditorStore((s) => s.project.globalStyle);
  const speakerStyles = useEditorStore((s) => s.project.speakerStyles);
  const speakerMotions = useEditorStore((s) => s.project.speakerMotions);
  const updateWordStyle = useEditorStore((s) => s.updateWordStyle);
  const updateWordMotion = useEditorStore((s) => s.updateWordMotion);
  const applyStyleToAllWords = useEditorStore((s) => s.applyStyleToAllWords);
  const applyMotionToAllWords = useEditorStore((s) => s.applyMotionToAllWords);
  const updateGlobalStyle = useEditorStore((s) => s.updateGlobalStyle);
  const resetWordStyle = useEditorStore((s) => s.resetWordStyle);
  const resetWordMotion = useEditorStore((s) => s.resetWordMotion);
  const resetAllWordOverrides = useEditorStore((s) => s.resetAllWordOverrides);

  // Whether the Style/Motion controls below edit just the selected word or
  // every word in the transcript. Defaults to the single word so a stray
  // slider drag can never restyle the whole video; the toggle is the only way
  // to widen it, and it resets to "This word" on every selection change —
  // including returning to a selection that was previously widened to "all" —
  // so widening scope is always a fresh, deliberate choice.
  const [scope, setScope] = useState<"word" | "all">("word");
  const selectionKey = selectedWordIds.join(",");
  const [trackedSelectionKey, setTrackedSelectionKey] = useState(selectionKey);
  if (selectionKey !== trackedSelectionKey) {
    setTrackedSelectionKey(selectionKey);
    setScope("word");
  }
  const effectiveScope = scope;
  const setEffectiveScope = setScope;

  const selectedWord =
    selectedWordIds.length === 1 && transcription
      ? transcription.words.find((w) => w.id === selectedWordIds[0])
      : null;

  const selectedWords: Word[] =
    selectedWordIds.length > 1 && transcription
      ? selectedWordIds
          .map((id) => transcription.words.find((w) => w.id === id))
          .filter((w): w is Word => !!w)
      : [];

  const addManualCameraEvent = useEditorStore(
    (s) => s.addManualCameraEvent
  );
  const videoEffects = useEditorStore(
    (s) => s.project.globalStyle.videoEffects
  );

  const hasManualZoom = selectedWord
    ? videoEffects.cameraEvents.some(
        (e) => e.source === "manual" && selectedWord.start >= e.start && selectedWord.start <= e.end
      )
    : false;

  const sfxSettings = useEditorStore((s) => s.project.globalStyle.sfx);
  const sfxEvents = useEditorStore((s) => s.project.composition.sfxEvents);
  const sfxOverrides = useEditorStore((s) => s.project.composition.sfxOverrides);
  const setSfxOverride = useEditorStore((s) => s.setSfxOverride);

  // Match manual events by ownership (sourceWordIds), not timestamp proximity,
  // so selecting an adjacent word can't resolve the wrong manual event.
  const manualSfxAtWord: SfxEvent | undefined =
    selectedWord && sfxSettings.enabled
      ? sfxEvents.find(
          (e) =>
            e.source === "manual" && (e.sourceWordIds ?? []).includes(selectedWord.id)
        )
      : undefined;

  if (selectedWords.length > 1) {
    const first = selectedWords[0];
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">
            {selectedWords.length} words selected
          </h3>
          <button
            onClick={() => {
              if (effectiveScope === "all") {
                resetAllWordOverrides();
              } else {
                for (const w of selectedWords) {
                  resetWordStyle(w.id);
                  resetWordMotion(w.id);
                }
              }
            }}
            className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600"
          >
            {effectiveScope === "all" ? "Reset all" : "Reset selected"}
          </button>
        </div>

        <ScopeToggle
          scope={effectiveScope}
          onChange={setEffectiveScope}
          wordCount={transcription?.words.length ?? 0}
          selectionCount={selectedWords.length}
        />

        <h4 className="text-xs font-medium text-zinc-400 mb-2">
          {effectiveScope === "all"
            ? "Style — all words"
            : `Style Override (applies to all ${selectedWords.length})`}
        </h4>
        <StyleControls
          style={resolveWordStyle(first, speakerStyles, globalStyle)}
          onChange={(s) => {
            if (effectiveScope === "all") {
              applyStyleToAllWords(s);
              return;
            }
            for (const w of selectedWords) updateWordStyle(w.id, s);
          }}
        />

        <h4 className="text-xs font-medium text-zinc-400 mt-6 mb-2">
          {effectiveScope === "all"
            ? "Motion — all words"
            : "Motion Override (applies to all)"}
        </h4>
        <MotionControls
          motion={resolveWordMotion(first, speakerMotions, globalStyle)}
          onChange={(m) => {
            if (effectiveScope === "all") {
              applyMotionToAllWords(
                diffWordMotion(resolveWordMotion(first, speakerMotions, globalStyle), m)
              );
              return;
            }
            for (const w of selectedWords) updateWordMotion(w.id, m);
          }}
        />
      </div>
    );
  }

  if (!selectedWord) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-sm font-semibold text-white mb-4">Global Style</h3>
        <StyleControls
          style={globalStyle.style}
          onChange={(s) => updateGlobalStyle({ style: { ...globalStyle.style, ...s } })}
        />
        <h3 className="text-sm font-semibold text-white mt-6 mb-2">Position</h3>
        <PositionControls
          y={globalStyle.transform.y}
          onChange={(y) => updateGlobalStyle({ transform: { ...globalStyle.transform, y } })}
        />
        <h3 className="text-sm font-semibold text-white mt-6 mb-4">
          Global Motion
        </h3>
        <MotionControls
          motion={globalStyle.motion}
          onChange={(m) => updateGlobalStyle({ motion: { ...globalStyle.motion, ...m } })}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">
          &ldquo;{selectedWord.text}&rdquo;
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => {
              if (effectiveScope === "all") {
                resetAllWordOverrides();
              } else {
                resetWordStyle(selectedWord.id);
                resetWordMotion(selectedWord.id);
              }
            }}
            className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600"
          >
            {effectiveScope === "all" ? "Reset all" : "Reset"}
          </button>
        </div>
      </div>

      <p className="text-xs text-zinc-500 mb-3">
        {selectedWord.start.toFixed(2)}s — {selectedWord.end.toFixed(2)}s
      </p>

      <ScopeToggle
        scope={effectiveScope}
        onChange={setEffectiveScope}
        wordCount={transcription?.words.length ?? 0}
        selectionCount={1}
      />

      <h4 className="text-xs font-medium text-zinc-400 mb-2">
        {effectiveScope === "all" ? "Style — all words" : "Style Override"}
      </h4>
      <StyleControls
        style={resolveWordStyle(selectedWord, speakerStyles, globalStyle)}
        onChange={(s) =>
          effectiveScope === "all"
            ? applyStyleToAllWords(s)
            : updateWordStyle(selectedWord.id, s)
        }
      />

      <h4 className="text-xs font-medium text-zinc-400 mt-6 mb-2">
        {effectiveScope === "all" ? "Motion — all words" : "Motion Override"}
      </h4>
      <MotionControls
        motion={resolveWordMotion(selectedWord, speakerMotions, globalStyle)}
        onChange={(m) =>
          effectiveScope === "all"
            ? applyMotionToAllWords(
                diffWordMotion(resolveWordMotion(selectedWord, speakerMotions, globalStyle), m)
              )
            : updateWordMotion(selectedWord.id, m)
        }
      />

      <h4 className="text-xs font-medium text-zinc-400 mt-6 mb-2">
        Camera Punch
      </h4>
      <div className="flex gap-1">
        {[
          { label: "None", intensity: 0 },
          { label: "Subtle", intensity: 0.3 },
          { label: "Punch", intensity: 0.7 },
          { label: "Heavy", intensity: 1.0 },
        ].map((preset) => (
          <button
            key={preset.label}
            onClick={() => {
              if (preset.intensity === 0) {
                // Remove manual events for this word
                const ve = useEditorStore.getState().project.globalStyle.videoEffects;
                const merged = ve.cameraEvents.filter(
                  (e) => !(e.source === "manual" && selectedWord.start >= e.start && selectedWord.start <= e.end)
                );
                useEditorStore.getState().updateGlobalStyle({
                  videoEffects: { ...ve, cameraEvents: merged },
                });
              } else {
                addManualCameraEvent(selectedWord.id, preset.intensity);
              }
            }}
            className={`
              flex-1 px-2 py-1.5 text-[10px] rounded transition-colors
              ${
                preset.intensity === 0 && !hasManualZoom
                  ? "bg-zinc-600 text-white"
                  : hasManualZoom && preset.intensity > 0
                    ? "bg-[#00FF66]/20 text-[#00FF66]"
                    : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white"
              }
            `}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <h4 className="text-xs font-medium text-zinc-400 mt-6 mb-2">
        Sound FX
      </h4>
      {!sfxSettings.enabled ? (
        <p className="text-[10px] text-zinc-600">
          Enable Sound FX in the Presets panel to add sounds to words.
        </p>
      ) : (
        <div className="space-y-2">
          <label className="text-xs text-zinc-500 block mb-1">
            Sound for this word
          </label>
          <select
            value={
              (sfxOverrides && sfxOverrides[selectedWord.id]) || "inherit"
            }
            onChange={(e) => {
              const val = e.target.value;
              if (!selectedWord) return;
              setSfxOverride(
                selectedWord.id,
                val as "inherit" | "none" | SfxName
              );
            }}
            className="w-full bg-zinc-800 text-white text-xs rounded px-2 py-1.5 border border-zinc-800"
          >
            <option value="inherit">Inherit (auto)</option>
            <option value="none">None (silent)</option>
            {SFX_NAMES.map((n) => (
              <option key={n} value={n}>
                {n.replace(/-/g, " ")}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-zinc-600">
            Pack: {sfxSettings.pack} — {manualSfxAtWord
              ? `"${manualSfxAtWord.sound.replace(/-/g, " ")}"`
              : "playing pack role"}
          </p>
        </div>
      )}
    </div>
  );
}

const SFX_NAMES: SfxName[] = [
  "whoosh",
  "reverse-whoosh",
  "pop",
  "hit",
  "ding",
  "riser",
  "snap",
  "thump",
  "click",
  "soft-pop",
  "bass-hit",
  "record-scratch",
];

/**
 * Chooses how wide the Style / Motion controls below act: the words currently
 * selected, or every word in the transcript. Selecting a different set of words
 * drops back to the selection (the parent re-derives the scope from it), so
 * widening the blast radius is always a deliberate act for the block in view
 * rather than a setting that silently follows the user around the timeline.
 */
function ScopeToggle({
  scope,
  onChange,
  wordCount,
  selectionCount,
}: {
  scope: "word" | "all";
  onChange: (scope: "word" | "all") => void;
  wordCount: number;
  /** How many words are selected; 1 for the single-word panel. */
  selectionCount: number;
}) {
  const options: { id: "word" | "all"; label: string }[] = [
    {
      id: "word",
      label: selectionCount > 1 ? `${selectionCount} selected` : "This word",
    },
    { id: "all", label: `All ${wordCount} words` },
  ];

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-500">Apply changes to</span>
        {scope === "all" && (
          <span className="text-[10px] text-[#00FF66]">Whole transcript</span>
        )}
      </div>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            aria-pressed={scope === opt.id}
            onClick={() => onChange(opt.id)}
            className={`flex-1 h-7 rounded text-[10px] font-medium transition-colors ${
              scope === opt.id
                ? "bg-[#00FF66] text-black"
                : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// A caption shadow is a look, not a blur number: the softness only reads well
// when the offset and opacity move with it, which is why the four raw fields
// are authored together in core/shadow.ts. Picking a look writes all four, so
// every option looks deliberate — including "hard", whose blur 0 is only
// convincing at high opacity with a real offset. The fine-tune sliders are the
// escape hatch; hand-editing drops the label and the control reads "Custom"
// rather than pretending to still be a named look.
function ShadowControl({
  style,
  onChange,
}: {
  style: Partial<WordStyle>;
  onChange: (s: Partial<WordStyle>) => void;
}) {
  const [fineTuneOpen, setFineTuneOpen] = useState(false);
  const selection = shadowLookOf(style);
  const spec = resolveShadowSpec(style);
  const alpha = spec ? alphaOf(spec.color) : null;
  const custom = selection === "custom";
  const activeHint = shadowLookHint(selection);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-zinc-500">Shadow</label>
        <span className="text-xs text-zinc-600">{activeHint}</span>
      </div>
      <div className="flex gap-1">
        {SHADOW_LOOKS.map((look) => (
          <button
            key={look.id}
            onClick={() => onChange(shadowPatchForLook(look.id))}
            title={look.hint}
            className={`flex-1 h-7 rounded text-[10px] font-medium transition-colors ${
              selection === look.id
                ? "bg-[#00FF66] text-black"
                : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white"
            }`}
          >
            {look.label}
          </button>
        ))}
      </div>

      {spec ? (
        <>
          <button
            onClick={() => setFineTuneOpen((v) => !v)}
            className="mt-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {fineTuneOpen ? "▾" : "▸"} Fine-tune
          </button>
          {fineTuneOpen && (
            <div className="mt-1.5 space-y-3">
              <FieldGroup
                label="Blur"
                value={spec.blur}
                onChange={(v) => onChange(shadowFineTunePatch(style, { blur: v as number }))}
                min={0}
                max={20}
                unit="px"
              />
              {alpha !== null && (
                <FieldGroup
                  label="Opacity"
                  value={Math.round(alpha * 100)}
                  onChange={(v) =>
                    onChange(shadowFineTunePatch(style, { alpha: (v as number) / 100 }))
                  }
                  min={0}
                  max={100}
                  step={5}
                  unit="%"
                />
              )}
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Offset {spec.offsetX}, {spec.offsetY} ·{" "}
                {custom ? "hand-tuned" : "from the " + activeHint.toLowerCase() + " look"}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-[10px] text-zinc-600 leading-relaxed">
          No shadow on the text or the caption background box.
        </p>
      )}
    </div>
  );
}

function StyleControls({
  style,
  onChange,
}: {
  style: Partial<WordStyle>;
  onChange: (s: Partial<WordStyle>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-zinc-500 block mb-1">Font Family</label>
        <select
          value={style.fontFamily ?? ""}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
          className="w-full bg-zinc-800 text-white text-xs rounded px-2 py-1.5 border border-zinc-800"
        >
          {!FONT_FAMILY_OPTIONS.some((f) => f.value === style.fontFamily) && (
            <option value={style.fontFamily ?? ""}>
              {style.fontFamily?.split(",")[0] ?? "Custom"}
            </option>
          )}
          {FONT_FAMILY_OPTIONS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <FieldGroup label="Font Size" value={style.fontSize} onChange={(v) => onChange({ fontSize: v as number })} min={12} max={200} unit="px" />
      <FieldGroup label="Color" type="color" value={style.color || "#FFFFFF"} onChange={(v) => onChange({ color: v as string })} />
      <FieldGroup label="Stroke Color" type="color" value={style.strokeColor || "#000000"} onChange={(v) => onChange({ strokeColor: v as string })} />
      <FieldGroup label="Stroke Width" value={style.strokeWidth} onChange={(v) => onChange({ strokeWidth: v as number })} min={0} max={10} unit="px" />
      <FieldGroup label="Font Weight" value={style.fontWeight} onChange={(v) => onChange({ fontWeight: v as number })} min={100} max={900} step={100} />
      <FieldGroup label="Letter Spacing" value={style.letterSpacing} onChange={(v) => onChange({ letterSpacing: v as number })} min={0} max={20} unit="px" />
      <ShadowControl style={style} onChange={onChange} />
      <div className="pt-1 border-t border-zinc-800">
        {/* "Background" is also the name of the separate video-background tab
            (blur/color/image behind the footage) — labeling this "Caption
            Background Box" keeps the two from reading as the same setting. */}
        <p className="text-xs font-medium text-zinc-400 mt-2 mb-0.5">
          Caption Background Box
        </p>
        <p className="text-[10px] text-zinc-600 mb-2">
          A solid box behind the caption text. Not the video&apos;s Background tab.
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">Show background box</span>
          <button
            type="button"
            aria-pressed={!!style.backgroundColor && style.backgroundColor !== "transparent"}
            onClick={() =>
              onChange({
                backgroundColor:
                  style.backgroundColor && style.backgroundColor !== "transparent"
                    ? "transparent"
                    : "#000000",
              })
            }
            className={`
              relative w-10 h-5 rounded-full transition-colors
              ${style.backgroundColor && style.backgroundColor !== "transparent" ? "bg-[#00FF66]" : "bg-zinc-700"}
            `}
          >
            <span
              className={`
                absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                ${style.backgroundColor && style.backgroundColor !== "transparent" ? "translate-x-5" : "translate-x-0.5"}
              `}
            />
          </button>
        </div>
        {/* Only shown once the box is on: the color swatch used to sit above
            this toggle and stayed live even while disabled, so touching it to
            preview a color silently turned the box back on as a side effect. */}
        {style.backgroundColor && style.backgroundColor !== "transparent" && (
          <div className="mt-3 space-y-3">
            <FieldGroup
              label="Box Color"
              type="color"
              value={style.backgroundColor}
              onChange={(v) => onChange({ backgroundColor: v as string })}
            />
            <FieldGroup label="Box Padding" value={style.backgroundPadding} onChange={(v) => onChange({ backgroundPadding: v as number })} min={0} max={40} unit="px" />
            <FieldGroup label="Box Corner Radius" value={style.backgroundBorderRadius} onChange={(v) => onChange({ backgroundBorderRadius: v as number })} min={0} max={40} unit="px" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Full-width bar</span>
              <button
                type="button"
                aria-pressed={!!style.backgroundFullWidth}
                onClick={() => onChange({ backgroundFullWidth: !style.backgroundFullWidth })}
                className={`
                  relative w-10 h-5 rounded-full transition-colors
                  ${style.backgroundFullWidth ? "bg-[#00FF66]" : "bg-zinc-700"}
                `}
              >
                <span
                  className={`
                    absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                    ${style.backgroundFullWidth ? "translate-x-5" : "translate-x-0.5"}
                  `}
                />
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-zinc-500 block mb-1">Text Transform</label>
        <select
          value={style.textTransform || "none"}
          onChange={(e) => onChange({ textTransform: e.target.value as WordStyle["textTransform"] })}
          className="w-full bg-zinc-800 text-white text-xs rounded px-2 py-1.5 border border-zinc-800"
        >
          <option value="none">None</option>
          <option value="uppercase">UPPERCASE</option>
          <option value="lowercase">lowercase</option>
          <option value="capitalize">Capitalize</option>
        </select>
      </div>
    </div>
  );
}

function PositionControls({
  y,
  onChange,
}: {
  y: number;
  onChange: (y: number) => void;
}) {
  const presets = [
    { label: "Top", y: 18 },
    { label: "Middle", y: 45 },
    { label: "Bottom", y: 80 },
  ];
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.y)}
            className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
              Math.round(y) === p.y
                ? "bg-[#00ff66] text-black font-medium"
                : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="range"
        min={MIN_CAPTION_Y}
        max={MAX_CAPTION_Y}
        value={y}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={sliderFillStyle(y, MIN_CAPTION_Y, MAX_CAPTION_Y)}
      />
      <div className="text-[11px] text-zinc-500">
        Vertical position: {y}% (clamped to stay inside the video)
      </div>
    </div>
  );
}

const MOTION_PHASES = ["entrance", "active", "exit"] as const;
type MotionPhase = (typeof MOTION_PHASES)[number];

const PHASE_LABELS: Record<MotionPhase, string> = {
  entrance: "Entrance",
  active: "While Spoken",
  exit: "Exit",
};

const PHASE_TYPE_OPTIONS: Record<MotionPhase, AnimationRecipe["type"][]> = {
  entrance: ["none", "scale", "fade", "glow"],
  active: ["none", "scale", "glow"],
  exit: ["none", "fade", "scale"],
};

function MotionControls({
  motion,
  onChange,
}: {
  motion: Partial<WordMotion>;
  onChange: (m: Partial<WordMotion>) => void;
  isOverride?: boolean;
}) {
  const updateRecipe = (key: MotionPhase, recipe: Partial<AnimationRecipe>) => {
    onChange({ [key]: { ...motion[key], ...recipe } } as Partial<WordMotion>);
  };

  return (
    <div className="space-y-4">
      {MOTION_PHASES.map((key) => {
        const type = motion[key]?.type || "none";
        return (
          <div key={key} className="bg-zinc-800 rounded-lg p-3">
            <h5 className="text-xs font-medium text-zinc-300 mb-2">
              {PHASE_LABELS[key]}
            </h5>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Type</label>
                <select
                  value={type}
                  onChange={(e) =>
                    updateRecipe(key, {
                      type: e.target.value as AnimationRecipe["type"],
                    })
                  }
                  className="w-full bg-zinc-800 text-white text-xs rounded px-2 py-1.5 border border-zinc-800"
                >
                  {PHASE_TYPE_OPTIONS[key].map((t) => (
                    <option key={t} value={t}>
                      {t === "none" ? "None" : t[0].toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              {type === "scale" && (
                <>
                  {key === "entrance" && (
                    <FieldGroup
                      label="Scale From"
                      value={motion[key]?.scaleFrom}
                      onChange={(v) => updateRecipe(key, { scaleFrom: v as number })}
                      min={0}
                      max={300}
                      unit="%"
                    />
                  )}
                  <FieldGroup
                    label={key === "exit" ? "Shrink To" : "Scale To"}
                    value={motion[key]?.scaleTo}
                    onChange={(v) => updateRecipe(key, { scaleTo: v as number })}
                    min={0}
                    max={300}
                    unit="%"
                  />
                </>
              )}
              {type === "fade" && (
                <>
                  <FieldGroup
                    label="From"
                    value={motion[key]?.from}
                    onChange={(v) => updateRecipe(key, { from: v as number })}
                    min={0}
                    max={1}
                    step={0.05}
                  />
                  <FieldGroup
                    label="To"
                    value={motion[key]?.to}
                    onChange={(v) => updateRecipe(key, { to: v as number })}
                    min={0}
                    max={1}
                    step={0.05}
                  />
                </>
              )}
              {type === "glow" && (
                <>
                  <FieldGroup
                    label="Glow Radius"
                    value={motion[key]?.glowRadius}
                    onChange={(v) => updateRecipe(key, { glowRadius: v as number })}
                    min={0}
                    max={50}
                    unit="px"
                  />
                  <FieldGroup
                    label="Glow Color"
                    type="color"
                    value={motion[key]?.color || "#00FF88"}
                    onChange={(v) => updateRecipe(key, { color: v as string })}
                  />
                </>
              )}
              <FieldGroup
                label="Duration"
                value={motion[key]?.duration}
                onChange={(v) => updateRecipe(key, { duration: v as number })}
                min={0}
                max={2000}
                unit="ms"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FieldGroup({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = "",
  type = "number",
}: {
  label: string;
  value?: number | string;
  onChange: (v: number | string) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  type?: "number" | "color";
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-zinc-500">{label}</label>
        {value !== undefined && (
          <span className="text-xs text-zinc-600 font-mono">
            {value}
            {unit}
          </span>
        )}
      </div>
      {type === "color" ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={typeof value === "string" ? value : "#FFFFFF"}
            onChange={(e) => onChange(e.target.value as number | string)}
            className="w-8 h-8 rounded border border-zinc-800 cursor-pointer"
          />
          <input
            type="text"
            value={typeof value === "string" ? value : "#FFFFFF"}
            onChange={(e) => onChange(e.target.value as number | string)}
            className="flex-1 bg-zinc-800 text-white text-xs rounded px-2 py-1.5 border border-zinc-800 font-mono"
          />
        </div>
      ) : (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={typeof value === "number" ? value : (min ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
          style={sliderFillStyle(
            typeof value === "number" ? value : (min ?? 0),
            min ?? 0,
            max ?? 100
          )}
        />
      )}
    </div>
  );
}
