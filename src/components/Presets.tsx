"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import { GlobalStyle } from "@/core/types";
import { resolveChoreography } from "@/core/choreography";

const presets: { name: string; style: Partial<GlobalStyle> }[] = [
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

export default function Presets() {
  const applyPreset = useEditorStore((s) => s.applyPreset);
  const applyChoreography = useEditorStore((s) => s.applyChoreography);
  const [prompt, setPrompt] = useState("");

  const handleApply = () => {
    if (!prompt.trim()) return;
    const bundle = resolveChoreography(prompt);
    applyChoreography(bundle);
  };

  return (
    <div className="w-72 bg-zinc-900 border-l border-zinc-800 p-4 overflow-y-auto">
      <h3 className="text-sm font-semibold text-white mb-3">AI Choreography</h3>
      <p className="text-xs text-zinc-500 mb-2">
        Describe the vibe — the AI picks styles, motion &amp; emphasis words.
      </p>
      <div className="flex gap-2 mb-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleApply()}
          placeholder='e.g. "MrBeast high-energy"'
          className="flex-1 px-2.5 py-1.5 text-xs bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={handleApply}
          disabled={!prompt.trim()}
          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-40 transition-colors"
        >
          Apply
        </button>
      </div>
      <div className="flex flex-wrap gap-1 mb-4">
        {["MrBeast", "Clean", "Cinematic", "Comedy", "Neon", "Calm"].map(
          (sug) => (
            <button
              key={sug}
              onClick={() => {
                setPrompt(sug.toLowerCase());
                const bundle = resolveChoreography(sug.toLowerCase());
                applyChoreography(bundle);
              }}
              className="text-[10px] px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded-full hover:bg-zinc-700 hover:text-white transition-colors"
            >
              {sug}
            </button>
          )
        )}
      </div>

      <h3 className="text-sm font-semibold text-white mb-4">Presets</h3>
      <div className="space-y-2">
        {presets.map((preset) => (
          <button
            key={preset.name}
            onClick={() => applyPreset(preset.style)}
            className="w-full text-left px-3 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors group"
          >
            <span className="text-sm text-white group-hover:text-blue-400 transition-colors">
              {preset.name}
            </span>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">
              {preset.style.style?.fontFamily?.split(",")[0]} ·{" "}
              {preset.style.style?.fontSize}px
            </p>
          </button>
        ))}
      </div>

      <h3 className="text-sm font-semibold text-white mt-6 mb-3">
        Words per Line
      </h3>
      <WordsPerLineControl />
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
                ? "bg-blue-500 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
            }
          `}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
