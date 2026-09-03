"use client";

import { useState } from "react";

interface ApiKeyInputProps {
  onKeySet: (key: string) => void;
}

export default function ApiKeyInput({ onKeySet }: ApiKeyInputProps) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    if (key.trim()) {
      localStorage.setItem("groq_api_key", key.trim());
      onKeySet(key.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Groq API key"
        className="px-3 py-1.5 text-xs bg-transparent text-white rounded-lg border border-white/15 focus:border-[#00FF66] focus:outline-none w-48 placeholder-zinc-500"
      />
      <button
        onClick={handleSave}
        className="px-3 py-1.5 text-xs text-white bg-transparent border border-white/15 rounded-lg hover:bg-white/10 transition-colors"
      >
        {saved ? "Saved!" : "Save"}
      </button>
    </div>
  );
}
