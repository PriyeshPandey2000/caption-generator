# Development Log — CaptionLab

Chronological record of what has been built and every decision taken, so progress and rationale are never lost.

---

## 2026-09-03 — Bootstrapping & Phase 1 Core

### Session goal
Get from empty repo to a working, polished Phase 1 editor that a judge can demo without needing a Groq API key.

### Repo setup
- Initialized git repo, set the upstream remote to `https://github.com/PriyeshPandey2000/caption-generator.git`.
- Scafolded a fresh Next.js 16 app (`create-next-app`): TypeScript + Tailwind v4 + App Router, `src/` directory.
- Installed: `zustand` (state), `uuid`, `@ffmpeg/ffmpeg` + `@ffmpeg/util` (burn-in).

### Locked architecture decisions
- **Next.js 16 with Turbopack** is the build default. The initial `webpack` config in `next.config.ts` broke the build — replaced with an empty `turbopack: {}` config. (Heed Next.js 16's "this is not the Next.js you know" rules — API/filename conventions differ from older training data.)
- **Plain-TS engine module** (`src/core/`) is framework-agnostic and unit-testable, per the PRD's "Browser-first, portable core" principle. UI lives in `src/components/`, state in a single `zustand` store (`src/store/editor-store.ts`).

### Core data model (Phase 1.2)
- `Word = { id, text, start, end, speaker?, style?, transform?, animation? }` — the atomic unit.
- `CaptionGroup` = a view over a run of words (a "line"), **not** a separate store. Groups are derived by `groupWordsIntoCaptions` (configurable words-per-line, default 4).
- Resolution order **Global → Speaker → Phrase → Word** implemented in `src/core/styles.ts` via `resolveWordStyle` / `resolveWordMotion` / `resolveWordTransform`. Word (lowest level) wins.
- Store exposes full override API: `updateWordStyle/Motion/Transform`, `resetWordStyle/Motion`, speaker + global updaters, `retimeWord`, `regroupCaptions`, `setMaxWordsPerGroup`, `applyPreset`.

### Transcription (Phase 1.1)
- `/api/transcribe` route POSTs the user's file + their Groq key to `whisper-large-v3-turbo` with `response_format: verbose_json` and `timestamp_granularities: [word, segment]`.
- Key is proxied through a thin server route so it never needs to be exposed client-side to third parties (still held locally in `localStorage`).
- Groq emits per-word `{word, start, end}` — parsed into `Word[]`; segments preserved. Words fall back to even-divided segment timing if per-word data is missing.

### Demo mode (key demo decision)
- **Decision:** The app must demo without an API key. Added `createDemoTranscription()` (`src/core/demo.ts`) — a sample 38-word captionated script used by the **"Try it with sample captions →"** button. In demo mode a black canvas stands in for the video and a `useDemoPlayback` RAF loop advances `currentTime` when "Play" is hit.
- This turns the 2-minute judge test into a zero-config path: open URL → click demo → captions animate instantly.

### Caption preview + recipes (Phases 1.3/1.4)
- `CaptionOverlay` renders the active caption group (words for the current time range) as styled words over the video.
- **Style vs Motion split** honored: style drives font/size/color/stroke/shadow/case; motion drives entrance / active-word / exit / emphasis animations.
- Recipes implemented: entrance `scale 80→100`, active-word `scale→125` + gold + optional glow, exit `fade`, emphasis `scale→140` + gold + glow (used for punchlines).
- Defaults chosen to be tasteful on first load (white, uppercase, black stroke, bottom-aligned via transform-y safe-area).

### Direct manipulation (Phase 1.3)
- **Click a caption group → drag** repositions it (per-group offset stored in `groupLayouts`, applied as a transform on the group wrapper).
- **Scale handle** (bottom-right) grows the group — "make it big type."
- Word click selects that word; Cmd/Ctrl-click multi-selects. Selected words show a blue ring.

### Inspector + inheritance (Phase 1.2/1.3)
- Right panel (`Inspector`) shows Global Style + Global Motion sliders/color/selects when nothing is selected, and per-word overrides when a word is selected, with a **Reset** button that clears word-level overrides back to Global.
- "Words per line" control (2–6) re-groups captions live.

### Presets & templates (Phase 1.6)
- `Presets` panel: Clean, MrBeast, Neon, Editorial, Punchy, Minimal — each a Style + Motion bundle applied in one click.
- Global style/motion are editable live from the Inspector.

### AI choreography (Phase 1.5 — agentic differentiator)
- `src/core/choreography.ts` maps natural language ("MrBeast", "high-energy/hype", "clean/minimal", "cinematic/film", "comedy/funny", "neon/cyberpunk", "calm/chill") → curated parameter bundles (global style + motion) **and** an emphasis-words list.
- `applyChoreography` in the store applies the bundle and tags matching transcript words with an `emphasis` recipe (bigger, gold, glow) so punchlines pop when spoken.
- UI: a text input + one-click suggestion chips ("MrBeast", "Clean", "Cinematic", "Comedy", "Neon", "Calm").

### Export (Phase 1.7)
- **SRT / VTT** one-click downloads built from word timing (`wordsToSRT`).
- **MP4 burn-in** via `@ffmpeg/ffmpeg`: loads wasm in-browser, writes the video + generated `.srt`, runs `subtitles=` filter, downloads the result. Served from a CDN bundle loader / dynamic import to keep the initial route light.

### Verified in the live browser
- Upload screen renders; API key saved to localStorage.
- Demo mode loads; captions animate and the **active spoken word turns gold and scales up** while upcoming words start at entrance scale.
- MrBeast AI choreography applied live: font → Impact/Arial Black, size → 64px, active word 1.35× gold, 4px gold stroke.
- Capture fixed a bug where `WordSpan` self-closed without rendering `{word.text}` (captions were styled but invisible).

### Project save/load (Phase 1.7) — completed
- **Decision:** autosave the project to localStorage, debounced 300ms, triggered on any change to `project` or `groupLayouts`. No manual "Save" button needed (simplest, best UX).
- New `src/core/persistence.ts`: framework-agnostic `saveProjectToStorage` / `loadProjectFromStorage` / `clearProjectFromStorage` under key `captionlab_project_v1`.
- Persisted: `transcription`, `globalStyle`, `speakerStyles`, `speakerMotions`, `groupLayouts` (+ `savedAt`).
- **Deliberately NOT persisted:** the source video blob/URL and `videoFile`. `videoUrl` is an ephemeral `blob:` URL and the `File` is binary — too large / not meaningful across reloads. On restore, a project renders on the black demo canvas (captions + styling intact), which is the correct behavior for a caption editor.
- Store gained `restorePersisted` (applies persisted data + resets playhead/selection) and `newProject` (fresh project + clears storage).
- `Editor` auto-restores a saved project on mount when one exists, and the header gained a **"New Project"** button that clears storage and resets.
- Wired `useEditorStore.subscribe` for autosave (browser-only, guarded).
- Verified in browser: applying MrBeast persisted Impact font + 38 words; page reload auto-restored the project (counter + black canvas back); New Project cleared storage + returned to upload screen. Lint + build pass.

### Polish pass (first-pass) — completed
- **Fixed emphasis animation bug** in `CaptionOverlay`: an emphasized/punchline word set `transform: scale(140%) scale(125%)` — multiplying two scales (≈175%) and skipping the entrance animation. Now it's a single clean `scale(140%)` + gold + glow.
- **Keyboard shortcuts:** press `Space` to play/pause (demo mode only, ignored while typing in inputs), and `Delete`/`Backspace` to reset the selected word's style/motion overrides back to Global.
- **Landing empty-state polish:** added a hero ("Turn speech into animated typography") + a 4-point feature list + the upload zone + demo button, so a judge immediately understands the value proposition before doing anything.
- **Discovery hint:** demo view shows "Space = play · drag a caption to move · drag the corner to scale · Del = reset style".
- Verified live: landing hero + bullets render after "New Project"; `Space` toggles the play button between "Play"/"Pause" (simulated keydown since the browser-press tool errored in this session); hint line renders.

### MP4 export caps — verified (uncommitted work kept)
- The working tree contains export-caps changes to `ExportPanel.tsx` (not yet committed): `MAX_EXPORT_DURATION_SEC = 90`, `MAX_EXPORT_WIDTH = 1280`, a `getVideoMetadata()` helper that reads real duration/dimensions from the source video, an early reject for videos over 90s, an aspect-preserving `scale` filter when width exceeds 1280, and bounded encode settings (`-preset ultrafast`, `-b:v 2500k`, `-maxrate 3000k`, `-bufsize 6000k`, `-c:a aac 128k`).
- **Verified end-to-end in the browser:** generated a real 1280×720 6s clip with audio (via homebrew ffmpeg), injected it into the store alongside the demo transcription, and clicked **Export MP4**. The full pipeline ran clean to **DONE**: ffmpeg.wasm initialised, video + SRT written, `subtitles=` burn-in executed with the caps, `output.mp4` produced, and the download fired.
- Note: a redundant always-present `-t 90` is passed even for short clips — harmless because >90s clips are rejected earlier (no trimming needed). Left intact as a safety net.
- Temporary test seams (`window.__captionlab`, `window.__exportStatus`, a `public/testclip.mp4`) were added to drive the in-browser upload/export and **fully removed** afterward. Working tree now differs from HEAD only by the intended export-caps change.

### Caption text editing — completed (Phase 1 gap: PRD "corrected")
- **Feature:** you can now edit the actual text of any transcribed word, which was the missing piece behind the PRD's "styled, animated, **corrected**, zoomed" value-prop line.
- Store: added `updateWordText(wordId, text)` — trims input and guards against emptying a word (falls back to the original text), updates `Word.text` in the transcription.
- New reusable component `src/components/EditableWord.tsx`: renders the word as a span styled by the resolved style; **double-click** swaps it to a transparent input (autofocus + select-all); **Enter** or **blur** commits via `onCommit`, **Escape** cancels. In edit mode it stops propagation so it never triggers group drag.
- Wired into **CaptionOverlay** (words over the video, matched to their resolved font/size/color/stroke so the edit field looks seamless) and **Timeline** (transcript word chips near the current time).
- Because export (SRT/VTT/MP4 burn) reads `Word.text`, edits propagate automatically; grouping is by word id so caption groups stay intact. Autosave persists edited text.
- **Verified:** lint clean, `next build` green (TypeScript compiles across all three wiring sites). Not yet browser-interacted but fully compiled and wired.

### Known issue / in progress
- **Demo playback speed** appeared ~8× too fast during a long dev session, caused by overlapping RAF loops accumulating across HMR reloads of the same page. A single-loop guard (module-scoped ownership in `useDemoPlayback.ts`) has been added — on a **fresh load** the loop count is exactly 1; the guard self-cancels any duplicate loop a re-mount/StrictMode might create. Final browser timing verification still to run.

### Remaining (next sessions)
- Finish/verify the in-flight neon-green visual redesign (UploadZone + hero font still pending) and confirm playback timing post-guard.
- Browser-verify camera zoom with a real uploaded video (demo mode has no video element).
- Auto-SFX (Phase 2.2), audio-event tagging, speaker-aware styling.
- Further polish (mobile layout audit, more presets, undo/redo).

---

## 2026-09-03 — Phase 2: Camera Layer (Auto-Zoom)

### Session goal
Implement AI-directed camera choreography: video-level zoom on emphasis words, driven by a camera event timeline and rendered via RAF on the `<video>` wrapper.

### What was built
- **Types** (`src/core/types.ts`): `CameraEvent` (`{ id, start, peak, end, type, intensity, source }`), `VideoEffects` (`{ cameraEvents, maxScale, inDuration, outDuration }`), added `videoEffects` to `GlobalStyle`.
- **Zoom engine** (`src/core/zoom.ts` — new file):
  - `buildCameraTimeline`: generates `CameraEvent[]` from emphasis words, using a three-phase envelope: anticipate (100ms before word) → zoom-in (150ms) → hold (through word duration) → release (300ms after word end).
  - `mergeOverlapping`: merges overlapping events so close emphasis words don't fight.
  - `sampleZoom`: frame-accurate sampling. Computes `effectiveMax = 1 + (globalMax - 1) * event.intensity`, so per-word Camera Punch (Subtle/Punch/Heavy) produces visually distinct zoom. Uses `easeOutBack` for the zoom-in "punch" feel and `easeOutCubic` for the release.
- **VideoPreview** (`src/components/VideoPreview.tsx`): RAF-driven zoom on a `<div>` wrapper around `<video>`. No CSS transitions — pure frame-driven interpolation. Snap to 1.0 when paused/scrubbing. Only active when `cameraEvents.length > 0`.
- **Presets panel** (`src/components/Presets.tsx`): Camera Movement toggle (on/off) + intensity slider (1–5, maps to `maxScale`). Shows event count + max scale.
- **Inspector** (`src/components/Inspector.tsx`): "Camera Punch" per selected word — None / Subtle / Punch / Heavy buttons. Sets per-event `intensity` (0–1 fractional). Manual events merge into the timeline via `mergeOverlapping`.
- **Choreography** (`src/core/choreography.ts`): Each bundle has `cameraMovement: { enabled, intensity }`. MrBeast (0.7), High-Energy (0.5), Comedy (0.3) auto-enable; Clean/Calm/Neon/Cinematic auto-disable. `applyChoreography` generates camera events from emphasis words when enabled.
- **Store** (`src/store/editor-store.ts`): `toggleCameraMovement` (always rebuilds on enable), `setCameraIntensity` (sets `maxScale` only, preserves per-event intensity), `addManualCameraEvent` (adds a manual event and merges).
- **Persistence**: `videoEffects` is part of `GlobalStyle`, so it saves/loads via existing autosave automatically.

### Bug fixes applied (6 issues caught in review)
1. **`event.intensity` was dead** — `sampleZoom` only used global `maxScale`, never read per-event `intensity`. Inspector's Subtle/Punch/Heavy buttons had no visual effect. Fixed: `sampleZoom` now computes `effectiveMax = 1 + (globalMax - 1) * event.intensity`.
2. **`toggleCameraMovement` stale-events guard** — `if (ve.cameraEvents.length > 0) return s` prevented rebuilding when emphasis words changed after first enable. Fixed: removed the guard, always rebuild on enable.
3. **Two incompatible intensity scales** — Choreography/Camera Punch used 0-1 fractional; Presets slider used 1-5 integer → `maxScale`. Masked by bug #1. Fixed by #5: per-event intensity (0-1) multiplies global `maxScale`; two fields compose correctly.
4. **No hold phase** — Zoom peaked 60ms into the word then immediately decayed. For a 300ms word, zoom was releasing while still spoken. Fixed: envelope now has anticipate → zoom-in → hold (through word duration) → release.
5. **Global slider stomped per-word tuning** — `setCameraIntensity` overwrote every event's `intensity` uniformly. Fixed: only sets `maxScale`, preserves per-event `intensity`.
6. **Stale events on transcript edits** — Covered by fix #2 (always rebuild on enable).

### Verified
- Lint clean, build clean (TypeScript compiles, all routes generate).
- Browser verification pending (demo mode doesn't have video, so camera zoom only visible with real uploaded video).

### Decisions register updates

| # | Decision | Rationale | Status |
|---|----------|-----------|--------|
| 13 | Camera effects on separate `videoEffects` layer, not `Word.transform` | Video zoom ≠ caption transform; architecture must support future pan/shake/rotate | Done |
| 14 | RAF-driven zoom, no CSS transitions on `<video>` wrapper | CSS transitions fight the playback loop, cause lag/rubber-band | Done |
| 15 | Event-based zoom (emphasis words only), not per-word micro-zoom | Most words should produce zero zoom; zoom should feel like intentional camera reaction | Done |
| 16 | Per-event `intensity` as multiplier on global `maxScale` | Per-word Camera Punch and global slider are on separate fields, compose correctly | Done |
| 17 | Three-phase zoom envelope (anticipate → zoom-in → hold → release) | Hold phase keeps zoom at peak while word is spoken; feels like actual editing effect | Done |

---

## Decisions register

| # | Decision | Rationale | Status |
|---|----------|-----------|--------|
| 1 | Next.js 16 + Turbopack, empty `turbopack: {}` config | Next 16 defaults to Turbopack; webpack config breaks build | Done |
| 2 | Engine in plain TS, framework-agnostic (`src/core/`) | Portability to Tauri; unit-testable | Done |
| 3 | Single zustand store for editor state | Simple, reactive, no Redux ceremony | Done |
| 4 | Add no-key **demo mode** for judges | URL-only demo must work without signing up for Groq | Done |
| 5 | CaptionGroups derived from words, not stored separately | Single source of truth; groups = view | Done |
| 6 | Groq key proxied via server route, held in localStorage | Privacy + not exposing key to third parties | Done |
| 7 | Emphasis/punchline words get an `emphasis` recipe (scale→140, gold, glow) | Punchlines pop without a keyframe editor | Done |
| 8 | Natural-language choreography maps to curated bundles (no LLM call in-loop) | Fast, deterministic, offline-friendly, still feels agentic | Done |
| 9 | Autosave project to localStorage (debounced 300ms), no manual Save button | Simplest + best UX for a judge demo | Done |
| 10 | Don't persist the source video blob/`File`; restore onto black canvas | Blob URLs/File are ephemeral/binary — too large and not meaningful across reloads | Done |
| 11 | Emphasis punchlines render as a single scale(140%) pop (not stacked scales) | A stacked 140%×125% transform looked broken and skipped entrance motion | Done |
| 12 | Words are edited inline via a reusable `EditableWord` (double-click) matched to resolved style | Seamless in-place correction that auto-propagates to export and persists | Done |
| 13 | Camera effects on separate `videoEffects` layer, not `Word.transform` | Video zoom ≠ caption transform; architecture must support future pan/shake/rotate | Done |
| 14 | RAF-driven zoom, no CSS transitions on `<video>` wrapper | CSS transitions fight the playback loop, cause lag/rubber-band | Done |
| 15 | Event-based zoom (emphasis words only), not per-word micro-zoom | Most words should produce zero zoom; zoom should feel like intentional camera reaction | Done |
| 16 | Per-event `intensity` as multiplier on global `maxScale` | Per-word Camera Punch and global slider are on separate fields, compose correctly | Done |
| 17 | Three-phase zoom envelope (anticipate → zoom-in → hold → release) | Hold phase keeps zoom at peak while word is spoken; feels like actual editing effect | Done |
