"use client";

import { useCallback, useState, useRef } from "react";

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  onDemo?: () => void;
}

export default function UploadZone({ onFileSelect, onDemo }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("video/")) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect]
  );

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`
          flex flex-col items-center justify-center
          w-full h-full min-h-[220px] py-8
          border-2 border-dashed rounded-2xl cursor-pointer
          transition-all duration-200
          ${
            isDragging
              ? "border-[#00ff66] bg-[#00ff66]/10 scale-[1.02] shadow-[0_0_40px_rgba(0,255,102,0.15)]"
              : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-500 hover:bg-zinc-800/50 hover:shadow-[0_0_30px_rgba(0,255,102,0.06)]"
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          onChange={handleChange}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className={`float-icon w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isDragging ? "bg-[#00ff66]/15" : "bg-zinc-800"
            }`}
            style={{
              boxShadow: isDragging
                ? "0 0 0 1px rgba(0,255,102,0.4) inset"
                : undefined,
            }}
          >
            <svg
              className={`w-6 h-6 transition-colors ${isDragging ? "text-[#00ff66]" : "text-zinc-400"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold text-white">
              Drop your video here
            </p>
            <p className="text-sm text-zinc-400 mt-1">
              or click to browse — MP4, MOV, WebM
            </p>
          </div>
          <p className="text-xs text-zinc-500">
            Video never leaves your browser until you export
          </p>
        </div>
      </div>

      {onDemo && (
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="bg-zinc-800 px-3 py-1.5 rounded-full">or</span>
          <button
            onClick={onDemo}
            className="px-4 py-2 rounded-lg font-medium text-black transition-transform hover:scale-[1.03]"
            style={{
              backgroundImage: "linear-gradient(120deg,#00ff66,#22c55e)",
            }}
          >
            Try it with sample captions →
          </button>
        </div>
      )}
    </div>
  );
}
