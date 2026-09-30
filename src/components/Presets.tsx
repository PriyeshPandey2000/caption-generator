"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useEditorStore } from "@/store/editor-store";
import { GlobalStyle, WordStyle, SfxDensity, SfxVolume, SfxPackId } from "@/core/types";
import { resolveChoreography } from "@/core/choreography";
import { cssShadow, resolveShadowSpec, shadowPatchForLook } from "@/core/shadow";
import { sliderFillStyle } from "./rangeFill";
import { Toggle } from "./Toggle";

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
        ...shadowPatchForLook("tight"),
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
    name: "MrBeast",
    style: {
      style: {
        fontFamily: "Impact, sans-serif",
        fontSize: 76,
        color: "#FFD700",
        strokeColor: "#000000",
        strokeWidth: 3,
        ...shadowPatchForLook("hard"),
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
        ...shadowPatchForLook("soft"),
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
    name: "Punchy",
    style: {
      style: {
        fontFamily: "Arial Black, sans-serif",
        fontSize: 56,
        color: "#FFFFFF",
        strokeColor: "#FF0000",
        strokeWidth: 2,
        ...shadowPatchForLook("hard"),
        fontWeight: 900,
        textTransform: "uppercase",
        letterSpacing: 1,
      },
      motion: {
        entrance: { type: "scale", scaleFrom: 40, scaleTo: 120, duration: 250, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
        // Flash to yellow on the active word — previously just a size bump
        // with no color change at all, which made "Punchy" indistinguishable
        // from a plain scale-pop and a near-exact duplicate of the AI-only
        // "high_energy" bundle. Impact-edit flashes are the genre convention
        // this name is supposed to deliver on.
        active: { type: "scale", scaleTo: 115, duration: 100, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", color: "#FFFF00" },
        exit: { type: "scale", scaleFrom: 100, scaleTo: 0, duration: 150 },
      },
    },
  },
  {
    name: "Classic",
    style: {
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 40,
        color: "#FFFFFF",
        strokeWidth: 0,
        fontWeight: 500,
        textTransform: "none",
        letterSpacing: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        backgroundPadding: 10,
        backgroundBorderRadius: 0,
        backgroundFullWidth: true,
      },
      motion: {
        entrance: { type: "fade", from: 0, to: 1, duration: 120 },
        active: { type: "none" },
        exit: { type: "fade", from: 1, to: 0, duration: 120 },
      },
    },
  },
  {
    name: "Outline",
    style: {
      style: {
        fontFamily: "Arial Black, sans-serif",
        fontSize: 60,
        color: "transparent",
        strokeColor: "#FFFFFF",
        strokeWidth: 3,
        fontWeight: 900,
        textTransform: "uppercase",
        letterSpacing: 1,
        // Hollow text had zero shadow, so on a light or busy background the
        // outline itself could nearly vanish — grounds it without filling
        // the letterforms in.
        ...shadowPatchForLook("soft"),
      },
      motion: {
        entrance: { type: "fade", from: 0, to: 1, duration: 150 },
        // The active word fills solid white while it's spoken, then goes
        // hollow again — an outline-to-solid morph nothing else in the set
        // does. `color` already exists as an active-phase field (it sets
        // text fill), just unused here before.
        active: { type: "scale", scaleFrom: 100, scaleTo: 106, duration: 100, color: "#FFFFFF" },
        exit: { type: "fade", from: 1, to: 0, duration: 150 },
      },
    },
  },
  {
    name: "Boxed",
    style: {
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 48,
        color: "#FFFFFF",
        strokeWidth: 0,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: 1,
        backgroundColor: "#000000",
        backgroundPadding: 8,
        backgroundBorderRadius: 6,
      },
      motion: {
        entrance: { type: "fade", from: 0, to: 1, duration: 150 },
        active: { type: "scale", scaleFrom: 100, scaleTo: 100, duration: 100, color: "#00FF66" },
        exit: { type: "fade", from: 1, to: 0, duration: 150 },
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
        ...shadowPatchForLook("none"),
      },
      motion: {
        entrance: { type: "fade", from: 0, to: 1, duration: 200 },
        active: { type: "scale", scaleFrom: 100, scaleTo: 108, duration: 100 },
        exit: { type: "fade", from: 1, to: 0, duration: 150 },
      },
    },
  },
  {
    name: "Karaoke",
    style: {
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 48,
        color: "#FFFFFF",
        strokeWidth: 0,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: 0,
        backgroundPadding: 6,
        backgroundBorderRadius: 10,
        ...shadowPatchForLook("tight"),
      },
      motion: {
        entrance: { type: "fade", from: 0, to: 1, duration: 150 },
        // The pill (backgroundColor) only paints while a word is spoken — it's
        // an AnimationRecipe field, not a WordStyle one, so unlike Classic/Boxed
        // there is no group-level box: only the current word gets a highlight,
        // and it moves as playback does.
        active: {
          type: "scale",
          scaleFrom: 100,
          scaleTo: 103,
          duration: 100,
          color: "#000000",
          backgroundColor: "#00FF66",
        },
        exit: { type: "fade", from: 1, to: 0, duration: 150 },
      },
    },
  },
];

// Names that also exist as a full choreography bundle (style + motion +
// camera zoom + auto-SFX + emphasis words) — clicking these applies the
// richer bundle instead of just style+motion, so there's one list, not two.
const CHOREOGRAPHED_PRESETS = new Set(["Hormozi", "MrBeast", "Neon"]);

/** The patch a card actually applies — for the choreographed names that is the
 * choreography bundle's `global`, not the card's own style entry, so the "is
 * this active" test and the click can't disagree about what was applied. */
function presetPatch(
  name: string,
  style: Partial<GlobalStyle>
): Partial<GlobalStyle> {
  return CHOREOGRAPHED_PRESETS.has(name)
    ? resolveChoreography(name).global
    : style;
}

/** Every field of `expected` is present with the same value in `actual`. Used
 * one level deep because that's how a preset is applied: `mergeGlobalStyle`
 * merges `style`/`transform` key by key and replaces `motion` wholesale, so
 * "active" means "nothing this preset set has since been changed by hand" —
 * which is why clicking a card lights it up and editing the font in the
 * Inspector puts it back out. */
function isSubsetOf(expected: object, actual: unknown): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  const wanted = expected as Record<string, unknown>;
  const current = actual as Record<string, unknown>;
  for (const key of Object.keys(wanted)) {
    const want = wanted[key];
    if (want === undefined) continue;
    if (current[key] !== want) return false;
  }
  return true;
}

function isPresetActive(
  globalStyle: GlobalStyle,
  patch: Partial<GlobalStyle>
): boolean {
  if (patch.style && !isSubsetOf(patch.style, globalStyle.style)) return false;
  if (patch.transform && !isSubsetOf(patch.transform, globalStyle.transform))
    return false;
  if (patch.motion) {
    const motion = globalStyle.motion as Record<string, unknown>;
    for (const [phase, recipe] of Object.entries(patch.motion)) {
      if (!isSubsetOf(recipe as Record<string, unknown>, motion[phase]))
        return false;
    }
  }
  return true;
}

/** How many fields a patch pins down — used to break ties so the most specific
 * match wins (a custom preset saved off a built-in one would otherwise light
 * up alongside it). */
function patchFieldCount(patch: Partial<GlobalStyle>): number {
  let n = Object.keys(patch.style ?? {}).length;
  for (const recipe of Object.values(patch.motion ?? {})) {
    n += Object.keys(recipe ?? {}).length;
  }
  return n + Object.keys(patch.transform ?? {}).length;
}

function pickActivePresetName(
  globalStyle: GlobalStyle,
  candidates: { name: string; patch: Partial<GlobalStyle> }[]
): string | null {
  let active: string | null = null;
  let best = -1;
  for (const { name, patch } of candidates) {
    if (!isPresetActive(globalStyle, patch)) continue;
    const n = patchFieldCount(patch);
    if (n > best) {
      active = name;
      best = n;
    }
  }
  return active;
}

export default function Presets() {
  const applyPreset = useEditorStore((s) => s.applyPreset);
  const applyChoreography = useEditorStore((s) => s.applyChoreography);
  const globalStyle = useEditorStore((s) => s.project.globalStyle);
  const [customPresets, setCustomPresets] = useState(loadCustomPresets);
  const [presetName, setPresetName] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const activePresetName = useMemo(
    () =>
      pickActivePresetName(globalStyle, [
        ...presets.map((p) => ({
          name: p.name,
          patch: presetPatch(p.name, p.style),
        })),
        ...customPresets.map((p) => ({ name: p.name, patch: p.style })),
      ]),
    [globalStyle, customPresets]
  );

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
        {presets.map((preset) => {
          const active = activePresetName === preset.name;
          // The choreographed names (Hormozi/MrBeast/Neon) apply
          // resolveChoreography()'s bundle on click, not this card's own
          // `style` entry — previewing from the card's entry let the two
          // drift apart (MrBeast's card said black stroke, its bundle said
          // gold), so the thumbnail promised a look the click didn't give.
          // Resolving through the same patch the click uses keeps them honest.
          const resolvedStyle = presetPatch(preset.name, preset.style).style;
          return (
            <button
              key={preset.name}
              onClick={() =>
                CHOREOGRAPHED_PRESETS.has(preset.name)
                  ? applyChoreography(resolveChoreography(preset.name))
                  : applyPreset(preset.style)
              }
              aria-pressed={active}
              className={presetCardClasses(active)}
            >
              <span className="flex items-center justify-between gap-2">
                <span
                  className={`text-sm transition-colors ${
                    active
                      ? "text-[#00FF66]"
                      : "text-white group-hover:text-[#00FF66]"
                  }`}
                >
                  {preset.name}
                </span>
                {active && <ActiveBadge />}
              </span>
              <PresetPreview style={resolvedStyle} />
              <p className="text-[10px] text-zinc-500 mt-1 truncate">
                {resolvedStyle?.fontFamily?.split(",")[0]} ·{" "}
                {resolvedStyle?.fontSize}px
              </p>
            </button>
          );
        })}
      </div>

      {customPresets.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-[#00FF66] mt-6 mb-3">
            Your Presets
          </h3>
          <div className="space-y-2">
            {customPresets.map((preset) => {
              const active = activePresetName === preset.name;
              return (
                <div
                  key={preset.name}
                  className="relative group rounded-lg"
                >
                  <button
                    onClick={() => applyPreset(preset.style)}
                    aria-pressed={active}
                    className={presetCardClasses(active, "pr-8")}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm transition-colors ${
                          active
                            ? "text-[#00FF66]"
                            : "text-white group-hover:text-[#00FF66]"
                        }`}
                      >
                        {preset.name}
                      </span>
                      {active && <ActiveBadge />}
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
              );
            })}
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

      <h3 className="text-sm font-semibold text-white mt-6 mb-3">
        Background Music
      </h3>
      <MusicControl />
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
        <Toggle
          checked={enabled}
          label="Camera zoom on emphasis"
          onChange={() => toggleCameraMovement(!enabled)}
        />
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
        <Toggle
          checked={sfx.enabled}
          label="Toggle sound effects on emphasis"
          onChange={() => setSfxEnabled(!sfx.enabled)}
        />
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

function presetCardClasses(active: boolean, extra = ""): string {
  return `
    w-full text-left px-3 py-2.5 rounded-lg transition-colors group ${extra}
    ${
      active
        ? "bg-[#00FF66]/10 border border-[#00FF66]/60"
        : "bg-zinc-700 border border-transparent hover:bg-zinc-600"
    }
  `;
}

function ActiveBadge() {
  return (
    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[#00FF66] bg-[#00FF66]/15 rounded px-1.5 py-0.5">
      Active
    </span>
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
    // Rendered from the same resolver the preview and export use, so the
    // thumbnail can't advertise a shadow the applied preset doesn't have (it
    // used to invent a 2px offset that no preset actually carried).
    textShadow: cssShadow(resolveShadowSpec(style ?? {}), scale),
    color: style?.color,
    fontSize: `${previewFontSize}px`,
    lineHeight: 1.1,
    backgroundColor:
      style?.backgroundColor && style.backgroundColor !== "transparent"
        ? style.backgroundColor
        : undefined,
    padding:
      style?.backgroundColor && style.backgroundColor !== "transparent"
        ? `${((style.backgroundPadding ?? 6) * scale).toFixed(1)}px ${((style.backgroundPadding ?? 6) * 2 * scale).toFixed(1)}px`
        : undefined,
    borderRadius:
      style?.backgroundColor && style.backgroundColor !== "transparent"
        ? `${((style.backgroundBorderRadius ?? 8) * scale).toFixed(1)}px`
        : undefined,
    ...(style?.backgroundFullWidth ? { width: "100%", textAlign: "center" } : {}),
  };

  return (
    <div className="mt-2 h-8 rounded-md bg-zinc-800 border border-zinc-700/50 flex items-center justify-center px-2 overflow-hidden">
      <span style={previewStyle} className="whitespace-nowrap">
        Big Caption
      </span>
    </div>
  );
}

function MusicControl() {
  const music = useEditorStore((s) => s.project.globalStyle.music);
  const setMusicFile = useEditorStore((s) => s.setMusicFile);
  const setMusicVolume = useEditorStore((s) => s.setMusicVolume);
  const setMusicDuck = useEditorStore((s) => s.setMusicDuck);
  const clearMusic = useEditorStore((s) => s.clearMusic);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) setMusicFile(file);
          e.target.value = "";
        }}
      />

      {!music.url ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full h-9 rounded-lg border border-dashed border-zinc-600 text-zinc-400 text-xs hover:border-[#00FF66]/40 hover:text-white transition-colors"
        >
          ＋ Add music track
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-xs text-zinc-300 truncate"
              title={music.name ?? undefined}
            >
              ♪ {music.name ?? "Music track"}
            </span>
            <button
              type="button"
              onClick={() => clearMusic()}
              className="px-2 py-1 text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
            >
              Remove
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-500">Volume</span>
              <span className="text-xs text-zinc-600">{Math.round(music.volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(music.volume * 100)}
              onChange={(e) => setMusicVolume(Number(e.target.value) / 100)}
              className="w-full"
              style={sliderFillStyle(Math.round(music.volume * 100), 0, 100)}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Lower under speech</span>
            <Toggle
              checked={music.duckEnabled}
              label="Lower under speech"
              onChange={() => setMusicDuck(!music.duckEnabled)}
            />
          </div>
        </>
      )}
    </div>
  );
}
