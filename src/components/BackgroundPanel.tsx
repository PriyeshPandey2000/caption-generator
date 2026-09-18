"use client";

import { useCallback } from "react";
import { useEditorStore } from "@/store/editor-store";
import { BackgroundMode } from "@/core/types";

const MODES: { id: BackgroundMode; label: string }[] = [
  { id: "none", label: "None" },
  { id: "blur", label: "Blur" },
  { id: "color", label: "Color" },
  { id: "image", label: "Image" },
];

export default function BackgroundPanel() {
  const background = useEditorStore((s) => s.project.globalStyle.background);
  const setBackgroundMode = useEditorStore((s) => s.setBackgroundMode);
  const setBackgroundColor = useEditorStore((s) => s.setBackgroundColor);
  const setBackgroundImageFile = useEditorStore((s) => s.setBackgroundImageFile);
  const setBackgroundBlurAmount = useEditorStore((s) => s.setBackgroundBlurAmount);

  const handleImageFile = useCallback(
    (file: File) => setBackgroundImageFile(file),
    [setBackgroundImageFile]
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white mb-1">Background</h3>
        <p className="text-[10px] text-zinc-500">
          Cuts out the subject and replaces what&apos;s behind them. Included in your exported
          video — resegmenting frame-by-frame adds noticeably to export time.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setBackgroundMode(m.id)}
            className={`px-2 py-2 text-xs rounded-lg transition-colors ${
              background.mode === m.id
                ? "bg-[#00FF66] text-black font-semibold"
                : "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {background.mode === "blur" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Blur amount</span>
            <span>{background.blurAmount}px</span>
          </div>
          <input
            type="range"
            min={2}
            max={30}
            value={background.blurAmount}
            onChange={(e) => setBackgroundBlurAmount(Number(e.target.value))}
            className="w-full accent-[#00FF66]"
          />
        </div>
      )}

      {background.mode === "color" && (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={background.color}
            onChange={(e) => setBackgroundColor(e.target.value)}
            className="w-8 h-8 rounded border border-zinc-800 cursor-pointer"
          />
          <input
            type="text"
            value={background.color}
            onChange={(e) => setBackgroundColor(e.target.value)}
            className="flex-1 bg-zinc-800 text-xs text-white rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-[#00FF66]/50"
          />
        </div>
      )}

      {background.mode === "image" && (
        <div className="space-y-2">
          <label className="block w-full text-center px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-xs rounded-lg cursor-pointer transition-colors">
            {background.imageUrl ? "Change image" : "Upload image"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageFile(file);
              }}
            />
          </label>
          {background.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={background.imageUrl}
              alt="Background preview"
              className="w-full h-24 object-cover rounded-lg border border-zinc-800"
            />
          )}
        </div>
      )}
    </div>
  );
}
