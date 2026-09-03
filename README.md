# CaptionLab

The programmable caption + auto-zoom editor for short-form video. **Every aspect customisable — but you never have to customise anything.**

Turn speech into styled, animated, corrected, zoomed, **exported** shorts, entirely in the browser. Footage never leaves your machine — privacy as a feature.

## Try it instantly

No API key needed to see it work — hit **"Try it with sample captions →"** on the landing screen and the captions animate immediately.

To transcribe your own clip, add a free [Groq](https://console.groq.com) API key in the header, then drag/drop a video.

## Features

- **Word-accurate captions in seconds** — Groq `whisper-large-v3-turbo` with word+segment timestamps.
- **Word is the atomic unit** — every word is individually styled, animated, and movable.
- **Direct manipulation** — drag any caption to reposition, drag the corner handle to scale it into "big type."
- **Animation recipes** — entrance, active-word, exit, and emphasis (punchline) motion, all editable.
- **Inheritance model** — Global → Speaker → Phrase → Word; every override resettable.
- **AI choreography** — type "make it MrBeast" or tap a suggestion chip; style, motion, and emphasis words apply instantly.
- **Presets & templates** — Clean, MrBeast, Neon, Editorial, Punchy, Minimal.
- **Export** — burn-in MP4 (ffmpeg.wasm), plus SRT/VTT subtitles.

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · Zustand · Groq Whisper · ffmpeg.wasm.

- Plain-TS core engine in `src/core/` (framework-agnostic, portable to a Tauri wrap).
- See `PRD.md` for the product specification and `DEVELOG.md` for build/decision history.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm start` | Serve production build |
| `npm run lint` | ESLint |
