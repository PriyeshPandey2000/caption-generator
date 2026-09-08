"use client";

import { useState, useCallback } from "react";
import { useEditorStore } from "@/store/editor-store";
import { GlobalStyle, WordStyle, SfxDensity, SfxVolume, SfxPackId } from "@/core/types";
import { resolveChoreography } from "@/core/choreography";

const CUSTOM_PRESETS_KEY = "captionlab_custom_presets";

function loadCustomPresets(): { name: string; style: Partial<GlobalStyle> }[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const presets: { name: string; style: Partial<GlobalStyle> }[] = [
  {
    name: "Hormozi",
    style: {
      style: {
        fontFamily: "var(--font-anton), Impact, 'Arial Black', sans-serif",
        fontSize: 52,
        color: "#FFFFFF",
        strokeColor: "#000000",
        strokeWidth: 1,
        fontWeight: 900,
        textTransform: "uppercase",
        letterSpacing: 0,
      },
      motion: {
        entrance: { type: "scale", scaleFrom: 80, scaleTo: 100, duration: 180, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
        active: { type: "scale", scaleFrom: 100, scaleTo: 100, duration: 100, color: "#FFD700" },
        exit: { type: "fade", from: 1, to: 0, duration: 120 },
      },
      transform: { x: 0, y: 80, scale: 1 },
    },
  },
  {
    name: "Clean",
    style: {
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 48,
        color: "#FFFFFF",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 2,
      },
    },
  },
  {
    name: "MrBeast",
    style: {
      style: {
        fontFamily: "Impact, sans-serif",
        fontSize: 64,
        color: "#FFD700",
        strokeColor: "#000000",
        strokeWidth: 3,
        fontWeight: 900,
        textTransform: "uppercase",
        letterSpacing: 3,
      },
      motion: {
        entrance: { type: "scale", scaleFrom: 60, scaleTo: 110, duration: 200, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
        active: { type: "scale", scaleFrom: 100, scaleTo: 130, duration: 150, color: "#FF4444" },
        exit: { type: "fade", from: 1, to: 0, duration: 100 },
      },
    },
  },
  {
    name: "Neon",
    style: {
      style: {
        fontFamily: "monospace",
        fontSize: 52,
        color: "#00FF88",
        strokeColor: "#00FF88",
        strokeWidth: 1,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 4,
      },
      motion: {
        entrance: { type: "glow", duration: 300, glowRadius: 20, color: "#00FF88" },
        active: { type: "glow", glowRadius: 30, color: "#00FF88", duration: 200 },
        exit: { type: "fade", from: 1, to: 0, duration: 200 },
      },
    },
  },
  {
    name: "Editorial",
    style: {
      style: {
        fontFamily: "Georgia, serif",
        fontSize: 40,
        color: "#FFFFFF",
        fontWeight: 400,
        textTransform: "none",
        letterSpacing: 0,
      },
      motion: {
        entrance: { type: "fade", from: 0, to: 1, duration: 300 },
        active: { type: "scale", scaleFrom: 100, scaleTo: 105, duration: 100 },
        exit: { type: "fade", from: 1, to: 0, duration: 200 },
      },
    },
  },
  {
    name: "Punchy",
    style: {
      style: {
        fontFamily: "Arial Black, sans-serif",
        fontSize: 56,
        color: "#FFFFFF",
        strokeColor: "#FF0000",
        strokeWidth: 2,
        fontWeight: 900,
        textTransform: "uppercase",
        letterSpacing: 1,
      },
      motion: {
        entrance: { type: "pop", scaleFrom: 0, scaleTo: 120, duration: 250, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
        active: { type: "bounce", scaleFrom: 100, scaleTo: 115, duration: 100 },
        exit: { type: "scale", scaleFrom: 100, scaleTo: 0, duration: 150 },
      },
    },
  },
  {
    name: "Minimal",
    style: {
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 36,
        color: "#FFFFFF",
        fontWeight: 500,
        textTransform: "none",
        letterSpacing: 0,
        strokeWidth: 0,
      },
      motion: {
        entrance: { type: "fade", from: 0, to: 1, duration: 200 },
        active: { type: "scale", scaleFrom: 100, scaleTo: 108, duration: 100 },
        exit: { type: "fade", from: 1, to: 0, duration: 150 },
      },
    },
  },
];

// Names that also exist as a full choreography bundle (style + motion +
// camera zoom + auto-SFX + emphasis words) — clicking these applies the
// richer bundle instead of just style+motion, so there's one list, not two.
const CHOREOGRAPHED_PRESETS = new Set(["Hormozi", "MrBeast", "Clean", "Neon"]);

export default function Presets() {
  const applyPreset = useEditorStore((s) => s.applyPreset);
  const applyChoreography = useEditorStore((s) => s.applyChoreography);
  const globalStyle = useEditorStore((s) => s.project.globalStyle);
  const [customPresets, setCustomPresets] = useState(loadCustomPresets);
  const [presetName, setPresetName] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const savePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    const snapshot: Partial<GlobalStyle> = {
      style: globalStyle.style,
      motion: globalStyle.motion,
      transform: globalStyle.transform,
    };
    const next = [...customPresets.filter((p) => p.name !== name), { name, style: snapshot }];
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next));
    setCustomPresets(next);
    setPresetName("");
    setSavedMsg(`Saved "${name}"`);
    setTimeout(() => setSavedMsg(""), 2000);
  }, [presetName, customPresets, globalStyle]);

  const deletePreset = useCallback((name: string) => {
    const next = loadCustomPresets().filter((p) => p.name !== name);
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next));
    setCustomPresets(next);
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h3 className="text-sm font-semibold text-white mb-3">Presets</h3>
      <div className="space-y-2">
        {presets.map((preset) => (
          <button
            key={preset.name}
            onClick={() =>
              CHOREOGRAPHED_PRESETS.has(preset.name)
                ? applyChoreography(resolveChoreography(preset.name))
                : applyPreset(preset.style)
            }
            className="w-full text-left px-3 py-2.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors group"
          >
            <span className="text-sm text-white group-hover:text-[#00FF66] transition-colors">
              {preset.name}
            </span>
            <PresetPreview style={preset.style.style} />
            <p className="text-[10px] text-zinc-500 mt-1 truncate">
              {preset.style.style?.fontFamily?.split(",")[0]} ·{" "}
              {preset.style.style?.fontSize}px
            </p>
          </button>
        ))}
      </div>

      {customPresets.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-[#00FF66] mt-6 mb-3">
            Your Presets
          </h3>
          <div className="space-y-2">
            {customPresets.map((preset) => (
              <div
                key={preset.name}
                className="relative group rounded-lg"
              >
                <button
                  onClick={() => applyPreset(preset.style)}
                  className="w-full text-left px-3 py-2.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors"
                >
                  <span className="text-sm text-white group-hover:text-[#00FF66] transition-colors">
                    {preset.name}
                  </span>
                  <PresetPreview style={preset.style.style} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePreset(preset.name);
                  }}
                  title={`Delete "${preset.name}"`}
                  className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-6 px-3 py-3 bg-zinc-700/40 rounded-lg border border-zinc-600/40">
        <h3 className="text-xs font-semibold text-white mb-2">
          Save current style as preset
        </h3>
        <div className="flex gap-1.5">
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") savePreset();
            }}
            placeholder="Preset name"
            className="flex-1 min-w-0 bg-zinc-700 text-white text-xs rounded px-2 py-1.5 border border-zinc-600 focus:border-[#00FF66]/60 focus:outline-none"
          />
          <button
            onClick={savePreset}
            disabled={!presetName.trim()}
            className="px-2.5 py-1.5 text-[10px] bg-[#00FF66] text-black font-semibold rounded-lg hover:bg-[#22C55E] disabled:opacity-35 disabled:hover:bg-[#00FF66] transition-colors"
          >
            Save
          </button>
        </div>
        {savedMsg && (
          <p className="mt-1.5 text-[10px] text-[#00FF66]">{savedMsg}</p>
        )}
        <p className="text-[10px] text-zinc-600 mt-1.5">
          Saved locally — carries across projects.
        </p>
      </div>

      <h3 className="text-sm font-semibold text-white mt-6 mb-3">
        Words per Line
      </h3>
      <WordsPerLineControl />

      <h3 className="text-sm font-semibold text-white mt-6 mb-3">
        Camera Movement
      </h3>
      <CameraMovementControl />

      <h3 className="text-sm font-semibold text-white mt-6 mb-3">
        Sound Effects
      </h3>
      <SfxControl />
    </div>
  );
}

function WordsPerLineControl() {
  const maxWordsPerGroup = useEditorStore(
    (s) => s.project.globalStyle.maxWordsPerGroup
  );
  const setMaxWordsPerGroup = useEditorStore((s) => s.setMaxWordsPerGroup);

  return (
    <div className="flex items-center gap-2">
      {[2, 3, 4, 5, 6].map((n) => (
        <button
          key={n}
          onClick={() => setMaxWordsPerGroup(n)}
          className={`
            w-9 h-9 rounded-lg text-sm font-medium transition-colors
            ${
              maxWordsPerGroup === n
                ? "bg-[#00FF66] text-black"
                : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white"
            }
          `}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function CameraMovementControl() {
  const videoEffects = useEditorStore(
    (s) => s.project.globalStyle.videoEffects
  );
  const toggleCameraMovement = useEditorStore(
    (s) => s.toggleCameraMovement
  );
  const setCameraIntensity = useEditorStore(
    (s) => s.setCameraIntensity
  );

  const enabled = videoEffects.cameraEvents.length > 0;
  const intensity = Math.round((videoEffects.maxScale - 1.0) / 0.12);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-300">Camera zoom on emphasis</span>
        <button
          onClick={() => toggleCameraMovement(!enabled)}
          className={`
            relative w-10 h-5 rounded-full transition-colors
            ${enabled ? "bg-[#00FF66]" : "bg-zinc-700"}
          `}
        >
          <span
            className={`
              absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
              ${enabled ? "translate-x-5" : "translate-x-0.5"}
            `}
          />
        </button>
      </div>

      {enabled && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500">Intensity</span>
            <span className="text-xs text-zinc-600 font-mono">{intensity}</span>
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setCameraIntensity(n)}
                className={`
                  flex-1 h-7 rounded text-xs font-medium transition-colors
                  ${
                    intensity === n
                      ? "bg-[#00FF66] text-black"
                      : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white"
                  }
                `}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600 mt-1">
            {videoEffects.cameraEvents.length} camera event
            {videoEffects.cameraEvents.length !== 1 ? "s" : ""} ·{" "}
            {videoEffects.maxScale.toFixed(2)}× max
          </p>
        </div>
      )}
    </div>
  );
}

function SfxControl() {
  const sfx = useEditorStore((s) => s.project.globalStyle.sfx);
  const sfxEventCount = useEditorStore(
    (s) => s.project.composition.sfxEvents.length
  );
  const setSfxEnabled = useEditorStore((s) => s.setSfxEnabled);
  const setSfxDensity = useEditorStore((s) => s.setSfxDensity);
  const setSfxVolume = useEditorStore((s) => s.setSfxVolume);
  const setSfxPack = useEditorStore((s) => s.setSfxPack);
  const regenerateSfx = useEditorStore((s) => s.regenerateSfx);

  const densities: SfxDensity[] = [
    "off",
    "subtle",
    "balanced",
    "energetic",
    "chaotic",
  ];
  const volumes: SfxVolume[] = ["quiet", "balanced", "aggressive"];
  const packs: SfxPackId[] = ["creator", "cinematic", "clean", "meme"];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-300">Sound on emphasis</span>
        <button
          type="button"
          aria-label="Toggle sound effects on emphasis"
          aria-pressed={sfx.enabled}
          onClick={() => setSfxEnabled(!sfx.enabled)}
          className={`
            relative w-10 h-5 rounded-full transition-colors
            ${sfx.enabled ? "bg-[#00FF66]" : "bg-zinc-700"}
          `}
        >
          <span
            className={`
              absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
              ${sfx.enabled ? "translate-x-5" : "translate-x-0.5"}
            `}
          />
        </button>
      </div>

      {sfx.enabled && (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-500">Density</span>
              <span className="text-xs text-zinc-600 capitalize">
                {sfx.density}
              </span>
            </div>
            <div className="flex gap-1">
              {densities.map((d) => (
                <button
                  key={d}
                  onClick={() => setSfxDensity(d)}
                  className={`flex-1 h-7 rounded text-[10px] font-medium transition-colors capitalize ${
                    sfx.density === d
                      ? "bg-[#00FF66] text-black"
                      : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-500">Volume</span>
            </div>
            <div className="flex gap-1">
              {volumes.map((v) => (
                <button
                  key={v}
                  onClick={() => setSfxVolume(v)}
                  className={`flex-1 h-7 rounded text-[10px] font-medium transition-colors capitalize ${
                    sfx.volume === v
                      ? "bg-[#00FF66] text-black"
                      : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Pack</label>
            <select
              value={sfx.pack}
              onChange={(e) => setSfxPack(e.target.value as SfxPackId)}
              className="w-full bg-zinc-700 text-white text-xs rounded px-2 py-1.5 border border-zinc-600 capitalize"
            >
              {packs.map((p) => (
                <option key={p} value={p} className="capitalize">
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">
              {sfxEventCount} sound event{sfxEventCount !== 1 ? "s" : ""}
            </span>
            <button
              onClick={() => regenerateSfx()}
              className="px-2.5 py-1 text-[10px] bg-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-600 hover:text-white transition-colors"
            >
              ↻ Regenerate
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PresetPreview({ style }: { style?: Partial<WordStyle> }) {
  const styleFontSize = style?.fontSize || 48;
  const previewFontSize = 20;
  const scale = previewFontSize / styleFontSize;

  const previewStyle: React.CSSProperties = {
    fontFamily: style?.fontFamily,
    fontWeight: style?.fontWeight,
    letterSpacing:
      style?.letterSpacing != null
        ? `${(style.letterSpacing * scale).toFixed(1)}px`
        : undefined,
    textTransform: style?.textTransform,
    WebkitTextStroke: style?.strokeWidth
      ? `${(style.strokeWidth * scale).toFixed(1)}px ${style.strokeColor || "#000"}`
      : undefined,
    textShadow: style?.shadowColor
      ? `${(style.shadowOffsetX || 0) * scale}px ${
          (style.shadowOffsetY || 2) * scale
        }px ${(style.shadowBlur || 4) * scale}px ${style.shadowColor}`
      : undefined,
    color: style?.color,
    fontSize: `${previewFontSize}px`,
    lineHeight: 1.1,
  };

  return (
    <div className="mt-2 h-8 rounded-md bg-zinc-800 border border-zinc-700/50 flex items-center justify-center px-2 overflow-hidden">
      <span style={previewStyle} className="whitespace-nowrap">
        Big Caption
      </span>
    </div>
  );
}
