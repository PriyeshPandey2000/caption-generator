"use client";

import { useEditorStore } from "@/store/editor-store";
import { WordStyle, WordMotion, AnimationRecipe } from "@/core/types";

export default function Inspector() {
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const transcription = useEditorStore((s) => s.project.transcription);
  const globalStyle = useEditorStore((s) => s.project.globalStyle);
  const updateWordStyle = useEditorStore((s) => s.updateWordStyle);
  const updateWordMotion = useEditorStore((s) => s.updateWordMotion);
  const updateGlobalStyle = useEditorStore((s) => s.updateGlobalStyle);
  const resetWordStyle = useEditorStore((s) => s.resetWordStyle);
  const resetWordMotion = useEditorStore((s) => s.resetWordMotion);

  const selectedWord =
    selectedWordIds.length === 1 && transcription
      ? transcription.words.find((w) => w.id === selectedWordIds[0])
      : null;

  if (!selectedWord) {
    return (
      <div className="w-72 bg-zinc-900 border-l border-zinc-800 p-4 overflow-y-auto">
        <h3 className="text-sm font-semibold text-white mb-4">Global Style</h3>
        <StyleControls
          style={globalStyle.style}
          onChange={(s) => updateGlobalStyle({ style: { ...globalStyle.style, ...s } })}
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
    <div className="w-72 bg-zinc-900 border-l border-zinc-800 p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">
          &ldquo;{selectedWord.text}&rdquo;
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => {
              resetWordStyle(selectedWord.id);
              resetWordMotion(selectedWord.id);
            }}
            className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
          >
            Reset
          </button>
        </div>
      </div>

      <p className="text-xs text-zinc-500 mb-4">
        {selectedWord.start.toFixed(2)}s — {selectedWord.end.toFixed(2)}s
      </p>

      <h4 className="text-xs font-medium text-zinc-400 mb-2">Style Override</h4>
      <StyleControls
        style={selectedWord.style || {}}
        onChange={(s) => updateWordStyle(selectedWord.id, s)}
      />

      <h4 className="text-xs font-medium text-zinc-400 mt-6 mb-2">
        Motion Override
      </h4>
      <MotionControls
        motion={selectedWord.animation || {}}
        onChange={(m) => updateWordMotion(selectedWord.id, m)}
      />
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
      <FieldGroup label="Font Size" value={style.fontSize} onChange={(v) => onChange({ fontSize: v as number })} min={12} max={200} unit="px" />
      <FieldGroup label="Color" type="color" value={style.color || "#FFFFFF"} onChange={(v) => onChange({ color: v as string })} />
      <FieldGroup label="Stroke Color" type="color" value={style.strokeColor || "#000000"} onChange={(v) => onChange({ strokeColor: v as string })} />
      <FieldGroup label="Stroke Width" value={style.strokeWidth} onChange={(v) => onChange({ strokeWidth: v as number })} min={0} max={10} unit="px" />
      <FieldGroup label="Font Weight" value={style.fontWeight} onChange={(v) => onChange({ fontWeight: v as number })} min={100} max={900} step={100} />
      <FieldGroup label="Letter Spacing" value={style.letterSpacing} onChange={(v) => onChange({ letterSpacing: v as number })} min={0} max={20} unit="px" />
      <FieldGroup label="Shadow Blur" value={style.shadowBlur} onChange={(v) => onChange({ shadowBlur: v as number })} min={0} max={20} unit="px" />

      <div>
        <label className="text-xs text-zinc-500 block mb-1">Text Transform</label>
        <select
          value={style.textTransform || "none"}
          onChange={(e) => onChange({ textTransform: e.target.value as WordStyle["textTransform"] })}
          className="w-full bg-zinc-800 text-white text-xs rounded px-2 py-1.5 border border-zinc-700"
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

function MotionControls({
  motion,
  onChange,
}: {
  motion: Partial<WordMotion>;
  onChange: (m: Partial<WordMotion>) => void;
  isOverride?: boolean;
}) {
  const updateRecipe = (
    key: "entrance" | "active" | "exit" | "emphasis",
    recipe: Partial<AnimationRecipe>
  ) => {
    onChange({ [key]: { ...motion[key], ...recipe } } as Partial<WordMotion>);
  };

  return (
    <div className="space-y-4">
      {(["entrance", "active", "exit", "emphasis"] as const).map((key) => (
        <div key={key} className="bg-zinc-800/50 rounded-lg p-3">
          <h5 className="text-xs font-medium text-zinc-300 mb-2 capitalize">
            {key}
          </h5>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Type</label>
              <select
                value={motion[key]?.type || "none"}
                onChange={(e) =>
                  updateRecipe(key, {
                    type: e.target.value as AnimationRecipe["type"],
                  })
                }
                className="w-full bg-zinc-800 text-white text-xs rounded px-2 py-1.5 border border-zinc-700"
              >
                <option value="none">None</option>
                <option value="scale">Scale</option>
                <option value="fade">Fade</option>
                <option value="slide">Slide</option>
                <option value="glow">Glow</option>
                <option value="pop">Pop</option>
                <option value="bounce">Bounce</option>
              </select>
            </div>
            {motion[key]?.type === "scale" && (
              <>
                <FieldGroup
                  label="Scale From"
                  value={motion[key]?.scaleFrom}
                  onChange={(v) => updateRecipe(key, { scaleFrom: v as number })}
                  min={0}
                  max={300}
                  unit="%"
                />
                <FieldGroup
                  label="Scale To"
                  value={motion[key]?.scaleTo}
                  onChange={(v) => updateRecipe(key, { scaleTo: v as number })}
                  min={0}
                  max={300}
                  unit="%"
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
            {motion[key]?.type === "glow" && (
              <FieldGroup
                label="Glow Radius"
                value={motion[key]?.glowRadius}
                onChange={(v) => updateRecipe(key, { glowRadius: v as number })}
                min={0}
                max={50}
                unit="px"
              />
            )}
          </div>
        </div>
      ))}
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
            className="w-8 h-8 rounded border border-zinc-700 cursor-pointer"
          />
          <input
            type="text"
            value={typeof value === "string" ? value : "#FFFFFF"}
            onChange={(e) => onChange(e.target.value as number | string)}
            className="flex-1 bg-zinc-800 text-white text-xs rounded px-2 py-1.5 border border-zinc-700 font-mono"
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
          style={
            {
              "--slider-fill": `${(((typeof value === "number" ? value : (min ?? 0)) - (min ?? 0)) / ((max ?? 100) - (min ?? 0))) * 100}%`,
            } as React.CSSProperties
          }
          className="w-full"
        />
      )}
    </div>
  );
}
