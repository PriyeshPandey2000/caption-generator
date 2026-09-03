# PRD — "Turn speech into animated typography"

**Working title:** `CaptionLab`
**Competition:** Build Games — Best Replacement / Most Creative / Most Polished
**Submission surface:** a **public web app URL** + public repo. The URL is what judges open — **the web app IS the deliverable.** (Code stays portable so a Tauri desktop wrap is a later, cheap option — not a demo requirement.)

---

## 1. One-line pitch

> The programmable caption + auto-zoom editor for short-form video: **every aspect customisable, but you never have to customise anything.**

## 2. Why a user cancels a subscription

One upload → styled, animated, corrected, zoomed, **exported short** in ≤2 minutes — the job Submagic / CapCut / SubtitleEdit charge for piecemeal, done in one place, **entirely in the browser (footage never leaves the machine — privacy as a feature).**

## 3. Elevator demo (the 2-minute judge test)

1. Drop a clip → **styled captions appear in seconds** (word-aligned, tasteful default). *instant wow*
2. **Drag a caption, scale it → "big type"**, scrub the timeline. *a real editor, not a form*
3. One click: "Make it MrBeast-style" → punchlines pop, auto-zoom, SFX sync. *agentic*
4. One click: **Export MP4 + SRT.** *complete replacement loop*

---

## 4. Principles (rules everything follows)

- **Speed-to-beautiful first** — first result gorgeous and instant; depth discovered progressively.
- **Word is the atomic unit** — captions are *views over words*. All power flows from this.
- **Inheritance over chaos** — Global → Speaker → Phrase → Word; every control optional; every override resettable.
- **Editor is the product, export is the closing** — don't gold-plate export; gold-plate interaction.
- **Browser-first, portable core** — engine in plain TS, no DOM coupling.
- **Advanced = optional** — a judge gets a great result without touching settings.

---

## 5. Locked foundation (confirmed)

- **Transcription:** Groq `whisper-large-v3-turbo` → `response_format: "verbose_json"`, `timestamp_granularities: ["word","segment"]`. Gives `{word, start, end}` per word + segment metadata. Free-tier friendly, fast.
- **Word timestamps: ✅ confirmed. Speaker labels: ✅ CONFIRMED BLOCKED** — Groq's Whisper API (`whisper-large-v3-turbo` / `whisper-large-v3`) does **not** emit speaker/diarization data in any response format (`json`, `verbose_json`, `text`). Verified against Groq docs (2026-09-03): only segment metadata (`avg_logprob`, `compression_ratio`, `no_speech_prob`) plus word/segment timestamps are returned. Any per-speaker work requires either (a) manual speaker assignment in the UI, or (b) a **third-party diarization service** (AssemblyAI / pyannote) with its own API key + billing + backend route. The `Web Audio API`-level heuristics (pause gaps → speaker change) are unreliable and were rejected (a 500ms pause does not imply a speaker change). **Status: BLOCKED** — features #9 & audio-event tagging (#8) are on hold; the styling *infrastructure* (`Word.speaker`, `speakerStyles`, `speakerMotions`, `resolveWordStyle`) is already built and waits only for real speaker data to light up.
- **Burn-in:** `ffmpeg.wasm` in-browser, short-form 1080p. No backend needed for the demo. Export seam allows a server-side FFmpeg / Tauri drop-in later.
- **Stack:** Next.js (UI) + thin Node routes (proxy Groq key) + ffmpeg.wasm.

---

# PHASE 1 — CORE (the demo lives/dies here; ship polished, not broad)

### 1.1 Upload → instant styled result

- Drag/drop, paste, or pick file.
- Auto-detect language + speaker boundaries.
- **One upload → styled captions in seconds**; no blank screen, no required settings.
- Runs on Groq word+segment timestamps.

### 1.2 Word-level model + hierarchy

- `Word` = `{ id, text, start, end, speaker?, style?, transform?, animation? }`.
- `CaptionGroup` = a view over a run of words (grouping, not a separate store).
- Resolution: **Global → Speaker → Phrase → Word** (lowest wins).
- Inspector shows "inherited from" chain + **Reset to Global**.
- All in a plain-TS, unit-testable, framework-agnostic core module.

### 1.3 Direct manipulation on preview

- **Click → drag** to reposition (respect safe areas).
- **Corners/edges → scale** ("make it big type").
- **Timeline:** click to seek; **drag edges to retime**; click transcript word → playhead moves there.
- Live preview, real-time (no render-to-see).

### 1.4 Animation recipes, Style vs Motion split

- **Style:** font, size, color, stroke, shadow, background, case, position, max-width/wrap, safe-area.
- **Motion:** entrance, active-word, exit, emphasis, transitions, timing, easing.
- **Recipes** = one-click presets, fully parameter-editable:
  - entrance `scale 80→110→100 / 180ms / easeOutBack`
  - active-word `scale 100→125, yellow, glow 20%`
  - exit `opacity 100→0 / 120ms`
- **Recipe-level size/zoom keyframes** for the "120→180→120 while spoken" punchline case (no full keyframe editor yet).

### 1.5 AI choreography (the agentic differentiator)

- AI reads transcript → **visual script**: emphasis words, punchlines, jokes, questions, speaker changes → proposed styling.
- User can **edit the AI's decisions**.
- Thin **natural-language layer**: "make it high-energy MrBeast short" → curated parameter bundle.

### 1.6 Presets, templates, brand kit

- **Templates** = Style + Animation + Layout mix, one-click.
- **Brand kit:** 2–3 colors + default font, applied everywhere.
- Saved locally (localStorage).

### 1.7 Export (the closing action)

- **Burn-in MP4** via ffmpeg.wasm; **SRT/VTT**; **project save/load**.
- Resolution/bitrate/duration **caps** to prevent browser freeze.
- Clean seam for server-side FFmpeg / Tauri later.

---

# PHASE 2 — VIRAL VIDEO MANIPULATION (differentiators; scoped, demo-able)

### 2.1 Camera Layer — AI-Directed Camera Choreography ✅ Implemented

Separate video effects (zoom, pan, shake) from caption transforms. A dedicated **camera event timeline** drives the `<video>` wrapper via frame-driven RAF interpolation (no CSS transitions). Events are generated from emphasis/punchline detection, merged when overlapping, and sampled at `currentTime` each frame.

**Architecture:**
- `CameraEvent`: `{ id, start, peak, end, type, intensity, source }` — the atomic unit. `intensity` (0–1) is a per-event multiplier on the global `maxScale`.
- `VideoEffects`: `{ cameraEvents, maxScale, inDuration, outDuration }` — stored on `GlobalStyle`.
- Engine (`src/core/zoom.ts`): `buildCameraTimeline` → `mergeOverlapping` → `sampleZoom(currentTime)`.
- `sampleZoom` computes `effectiveMax = 1 + (globalMax - 1) * event.intensity`, so per-word Camera Punch (Subtle/Punch/Heavy) produces visually distinct zoom amounts.
- Preview renders via RAF on the `<video>` wrapper. Same timeline feeds eventual export.

**Zoom envelope** per event (three phases):
1. **Anticipate** (100ms before word start) → ramp from 1.0 toward peak.
2. **Zoom-in** (150ms) → reach `effectiveMax` at `word.start + inDuration*0.3`.
3. **Hold** at `effectiveMax` through the word's spoken duration.
4. **Release** (300ms after word end) → ease back to 1.0.
Most words produce **zero zoom** — only emphasis/punchline events trigger motion.

**UI:**
- Presets panel: Camera Movement toggle + intensity slider (1–5, maps to `maxScale`).
- Inspector: "Camera Punch" presets per selected word (None / Subtle / Punch / Heavy) — sets per-event `intensity` (0–1 fractional). Global slider and per-word intensity are on separate fields and compose correctly.
- Choreography bundles expose `cameraMovement: { enabled, intensity }`. MrBeast auto-enables (intensity 0.7); High-Energy (0.5); Comedy (0.3); Clean/Calm/Neon/Cinematic auto-disable.
- `toggleCameraMovement` always rebuilds from current emphasis words on enable (no stale-events).

**Known limitations:**
- Camera events are not auto-rebuilt on transcript edits — user toggles off/on to refresh.
- Manual Camera Punch events are cleared on toggle off/on (rebuild replaces them).
- Export (ffmpeg burn-in) does not render camera zoom — preview only for now.

**Beat Mode (future):** "Sync camera movement to speech" — pause → zoom-out, sentence boundary → reset, speaker change → micro-pan. Architecture supports this via the same event timeline.

### 2.2 Other Phase 2 items

- **Auto-SFX:** subtle whoosh/pop synced to emphasis/emoji (prebaked cue library).
- **Audio-event tagging:** detect/stylize `[laughter]`, `[applause]`. **Status: BLOCKED** — same diarization-layer limitation as speakers; Groq's STT returns no audio-event labels. Not competition MVP; architect for later via the same `SemanticEvent`/`EffectEvent` timeline.
- **Speaker-aware styling:** colorful per-speaker split. **Status: BLOCKED** — see §5; requires manual assignment UI or a third-party diarization service with its own API key. The styling infrastructure (`Word.speaker`, `speakerStyles`, `speakerMotions`, `resolveWordStyle`) is already built and dormant.

---

# PHASE 3 — SCALE-UP (only if time allows; nothing blocks the win)

- **Server-side FFmpeg** burn-in (Fly/Railway) — 4K/long, web-scale.
- **Tauri desktop wrap** — native speed + HW accel + offline + file access (post-competition).
- **Contextual B-roll injection** — high-value nouns → 1.5s overlays (stock API + licensing; **riskiest**, opt-in).
- **True ripple / dead-air edit** of source (risky for lip-sync; **text-only filler strip** is safe default).
- **Style remix / "Surprise Me"** randomizer (garnish).
- **Auto-layout typography** engine (optical centering, line balancing).
