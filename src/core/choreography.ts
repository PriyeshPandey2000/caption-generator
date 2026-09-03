import { GlobalStyle, SfxSettings } from "./types";

export interface ChoreographyBundle {
  global: Partial<GlobalStyle>;
  emphasisWords?: string[];
  description: string;
  cameraMovement?: {
    enabled: boolean;
    intensity: number;
  };
  sfx?: Partial<SfxSettings>;
}

const styleBundles: Record<string, ChoreographyBundle> = {
  mrbeast: {
    description: "High-energy MrBeast style — punchy, loud, yellow-accented",
    emphasisWords: ["pop", "anything", "big", "energy", "fastest", "never"],
    cameraMovement: { enabled: true, intensity: 0.7 },
    sfx: { enabled: true, pack: "creator", density: "energetic" },
    global: {
      style: {
        fontFamily: "Impact, 'Arial Black', sans-serif",
        fontSize: 64,
        color: "#FFFFFF",
        strokeColor: "#FFD700",
        strokeWidth: 4,
        shadowColor: "rgba(0,0,0,0.6)",
        shadowBlur: 6,
        fontWeight: 900,
        textTransform: "uppercase",
        letterSpacing: 4,
      },
      motion: {
        entrance: {
          type: "scale",
          scaleFrom: 60,
          scaleTo: 110,
          duration: 200,
          easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        },
        active: {
          type: "scale",
          scaleFrom: 100,
          scaleTo: 135,
          duration: 150,
          color: "#FFD700",
          glowRadius: 25,
        },
        exit: { type: "fade", from: 1, to: 0, duration: 100 },
      },
      transform: { x: 0, y: 45, scale: 1 },
    },
  },
  high_energy: {
    description: "Fast, punchy, high-energy",
    emphasisWords: ["pop", "big", "fastest", "energy", "never"],
    cameraMovement: { enabled: true, intensity: 0.5 },
    sfx: { enabled: true, pack: "creator", density: "balanced" },
    global: {
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
        entrance: {
          type: "pop",
          scaleFrom: 0,
          scaleTo: 120,
          duration: 250,
          easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        },
        active: { type: "bounce", scaleFrom: 100, scaleTo: 115, duration: 100 },
        exit: { type: "scale", scaleFrom: 100, scaleTo: 0, duration: 150 },
      },
    },
  },
  clean: {
    description: "Minimal, clean, editorial",
    emphasisWords: [],
    cameraMovement: { enabled: false, intensity: 0 },
    sfx: { enabled: false, pack: "clean", density: "subtle" },
    global: {
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 42,
        color: "#FFFFFF",
        strokeWidth: 2,
        fontWeight: 700,
        textTransform: "none",
        letterSpacing: 0,
      },
      motion: {
        entrance: { type: "fade", from: 0, to: 1, duration: 250 },
        active: { type: "scale", scaleFrom: 100, scaleTo: 106, duration: 100 },
        exit: { type: "fade", from: 1, to: 0, duration: 200 },
      },
    },
  },
  cinematic: {
    description: "Cinematic, subtle, film-like",
    emphasisWords: [],
    cameraMovement: { enabled: false, intensity: 0 },
    sfx: { enabled: true, pack: "cinematic", density: "subtle" },
    global: {
      style: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: 46,
        color: "#F5F5F0",
        strokeColor: "rgba(0,0,0,0.8)",
        strokeWidth: 1,
        fontWeight: 400,
        textTransform: "none",
        letterSpacing: 1,
      },
      motion: {
        entrance: { type: "fade", from: 0, to: 1, duration: 400 },
        active: { type: "scale", scaleFrom: 100, scaleTo: 104, duration: 120 },
        exit: { type: "fade", from: 1, to: 0, duration: 300 },
      },
    },
  },
  comedy: {
    description: "Fun, playful, for punchlines and jokes",
    emphasisWords: ["anything", "never"],
    cameraMovement: { enabled: true, intensity: 0.3 },
    sfx: { enabled: true, pack: "meme", density: "balanced" },
    global: {
      style: {
        fontFamily: "'Comic Sans MS', 'Chalkboard SE', sans-serif",
        fontSize: 54,
        color: "#FFFFFF",
        strokeColor: "#FF8C00",
        strokeWidth: 3,
        fontWeight: 700,
        textTransform: "none",
        letterSpacing: 1,
      },
      motion: {
        entrance: {
          type: "bounce",
          scaleFrom: 0,
          scaleTo: 120,
          duration: 300,
        },
        active: {
          type: "bounce",
          scaleFrom: 100,
          scaleTo: 122,
          duration: 120,
          color: "#FFD700",
        },
        exit: { type: "fade", from: 1, to: 0, duration: 150 },
      },
    },
  },
  neon: {
    description: "Neon glow, cyberpunk",
    emphasisWords: [],
    cameraMovement: { enabled: false, intensity: 0 },
    sfx: { enabled: false, pack: "cinematic", density: "subtle" },
    global: {
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
  calm: {
    description: "Calm, soft, minimal motion",
    emphasisWords: [],
    cameraMovement: { enabled: false, intensity: 0 },
    sfx: { enabled: false, pack: "clean", density: "subtle" },
    global: {
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 40,
        color: "#FFFFFF",
        strokeWidth: 1,
        fontWeight: 500,
        textTransform: "none",
        letterSpacing: 0,
      },
      motion: {
        entrance: { type: "fade", from: 0, to: 1, duration: 500 },
        active: { type: "scale", scaleFrom: 100, scaleTo: 103, duration: 150 },
        exit: { type: "none" },
      },
    },
  },
};

const ALIASES: Record<string, string> = {
  mrbeast: "mrbeast",
  "mr beast": "mrbeast",
  beast: "mrbeast",
  "high energy": "high_energy",
  energetic: "high_energy",
  hype: "high_energy",
  punchy: "high_energy",
  loud: "high_energy",
  clean: "clean",
  minimal: "clean",
  simple: "clean",
  editorial: "clean",
  cinematic: "cinematic",
  film: "cinematic",
  classy: "cinematic",
  comedy: "comedy",
  funny: "comedy",
  playful: "comedy",
  neon: "neon",
  cyberpunk: "neon",
  glow: "neon",
  calm: "calm",
  soft: "calm",
  chill: "calm",
  relaxing: "calm",
};

export const CHOREOGRAPHY_KEYS = Object.keys(styleBundles);

export function resolveChoreography(
  prompt: string
): ChoreographyBundle {
  const normalized = prompt.toLowerCase();
  for (const [alias, key] of Object.entries(ALIASES)) {
    if (normalized.includes(alias)) {
      return styleBundles[key];
    }
  }
  return styleBundles.clean;
}

export function highlightEmphasisWords(
  words: { id: string; text: string }[],
  emphasisWords: string[]
): string[] {
  if (!emphasisWords.length) return [];
  const set = new Set(emphasisWords.map((w) => w.toLowerCase().replace(/[^a-z]/g, "")));
  return words
    .filter((w) => set.has(w.text.toLowerCase().replace(/[^a-z]/g, "")))
    .map((w) => w.id);
}
