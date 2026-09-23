import {
  CaptionGroup,
  GlobalStyle,
  PreviewPlatform,
  TranscriptionResult,
  Word,
  WordStyle,
} from "./types";
import { resolveWordStyle, MIN_CAPTION_Y, MAX_CAPTION_Y } from "./styles";
import { sampleZoom } from "./zoom";
import { easeProgress } from "./easing";

// The width (CSS px) every caption-metric in the editor is designed against.
// Live preview on a ~1280px-wide surface renders 1:1; the export scales by
// outW/1280 so typed sizes, strokes and shadows land at the same proportions
// on the larger rendered frame.
export const EXPORT_DESIGN_WIDTH = 1280;

// Matches WordSpan's `exit.duration || 120` fallback and CaptionOverlay's
// EXIT_FADE_DEFAULT_DURATION_MS so the active-group grace window and the
// exported fade can never drift apart.
export const EXIT_FADE_DEFAULT_DURATION_MS = 120;

// Mirror of Tailwind classes on the caption row: `gap-x-2` (8px) between
// words and `gap-y-1` (4px) between lines. Kept unscaled — the DOM gap is a
// fixed 8/4 CSS px regardless of canvas width.
const GAP_X = 8;
const GAP_Y = 4;

export interface GroupLayoutInput {
  x: number;
  y: number;
  scale: number;
}

// Direct port of CaptionOverlay's active-group lookup: a group's window stays
// open a touch past g.end to cover the last word's exit-fade, but never past
// the next group's start, plus the closing-instant exception for the last group.
export function findActiveCaptionGroup(
  transcription: TranscriptionResult,
  globalStyle: GlobalStyle,
  currentTime: number
): CaptionGroup | null {
  const groups = transcription.captionGroups;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const lastWordId = g.wordIds[g.wordIds.length - 1];
    const lastWord = lastWordId
      ? transcription.words.find((w) => w.id === lastWordId)
      : undefined;
    const exit = lastWord?.animation?.exit || globalStyle.motion.exit;
    const exitDurationMs = exit ? exit.duration || EXIT_FADE_DEFAULT_DURATION_MS : 0;
    const nextStart = groups[i + 1]?.start ?? Infinity;
    const graceEnd = Math.min(g.end + exitDurationMs / 1000, nextStart);
    if (currentTime >= g.start && currentTime < graceEnd) return g;
  }
  const last = groups[groups.length - 1];
  if (last && currentTime === last.end) return last;
  return null;
}

let resolvedAntonFamily: string | null = null;

/** Replaces Next's `var(--font-anton)` with the resolved webfont family name so
 * canvas can reference the loaded font face directly. Falls back to Impact if
 * the variable can't be read (e.g. headless). */
export function resolveCanvasFontFamily(fontFamily: string): string {
  let anton = resolvedAntonFamily;
  if (anton === null && typeof document !== "undefined") {
    anton =
      getComputedStyle(document.documentElement).getPropertyValue("--font-anton").trim() || "";
    resolvedAntonFamily = anton;
  }
  // next/font already emits a quoted, comma-separated family list, e.g.
  // `"Anton", "Anton Fallback"` — wrapping that whole value in another pair of
  // quotes turns it into one bogus family name and the canvas falls through to
  // Impact. Quote only a bare multi-word name.
  if (!anton) return fontFamily.replace("var(--font-anton)", "Impact");
  const needsQuotes = !/["',]/.test(anton) && /\s/.test(anton);
  return fontFamily.replace(
    "var(--font-anton)",
    needsQuotes ? `"${anton}"` : anton
  );
}

export function applyTextTransform(
  text: string,
  transform?: WordStyle["textTransform"]
): string {
  switch (transform ?? "none") {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
    default:
      return text;
  }
}

export interface WordVisuals {
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontPx: number;
  color: string;
  strokeWidthPx: number;
  strokeColor: string;
  letterSpacingPx: number;
  opacity: number;
  shadow: { x: number; y: number; blur: number; color: string } | null;
}

// Exact port of WordSpan — every shipped type renders identically on screen
// and in the export: scale (font-size, not transform, so the word reflows and
// pushes neighbors instead of overlapping and -webkit-text-stroke never gets
// distorted), fade (opacity ramp), glow (text-shadow bloom for entrance and
// while-spoken), exit scale-down, and the last-word-only exit fade. Progress
// is eased per-recipe so a cubic-bezier overshoot "pop" matches the DOM.
export function evaluateWordVisuals(
  word: Word,
  speakerStyles: Record<string, Partial<WordStyle>>,
  globalStyle: GlobalStyle,
  currentTime: number,
  scaleFactor: number,
  isGroupLastWord: boolean
): WordVisuals {
  const style = resolveWordStyle(word, speakerStyles, globalStyle);
  const sf = scaleFactor;
  const baseFontSize = (style.fontSize ?? 48) * sf;

  const entrance = word.animation?.entrance || globalStyle.motion.entrance;
  const activeAnim = word.animation?.active || globalStyle.motion.active;
  const emphasis = word.animation?.emphasis || globalStyle.motion.emphasis;
  const exit = word.animation?.exit || globalStyle.motion.exit;

  const isSpokenNow = currentTime >= word.start && currentTime < word.end;
  const hasEnded = currentTime >= word.end;

  let fontPx = baseFontSize;
  let color = style.color ?? "#FFFFFF";
  let shadow: { x: number; y: number; blur: number; color: string } | null = null;
  let opacity = style.opacity ?? 1;

  const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
  const clampAmount = (v: number) => Math.min(1, Math.max(0, v));
  const clampFont = (px: number) => Math.max(baseFontSize * 0.02, px);

  if (entrance && entrance.type === "scale") {
    const elapsed = (currentTime - word.start) * 1000;
    const duration = entrance.duration || 180;
    const progress = easeProgress(
      Math.min(1, Math.max(0, elapsed / duration)),
      entrance.easing
    );
    const scale =
      (entrance.scaleFrom ?? 80) +
      ((entrance.scaleTo ?? 100) - (entrance.scaleFrom ?? 80)) * progress;
    fontPx = clampFont((baseFontSize * scale) / 100);
  }

  const entranceElapsed = (currentTime - word.start) * 1000;
  // Clamped progress across the ENTIRE entrance lifecycle — 0 before
  // word.start, eases from `from` toward `to` during the window, and holds at
  // `to` after the duration, so a custom from/to isn't discarded the moment
  // entranceActive flips false (which used to snap the word back to its base
  // opacity for fade/glow and drop a murk-configured `to` mid-lifecycle).
  // A configured duration of 0 is a valid explicit choice and means an
  // immediate transition right at word.start (treated as progress=1), not a
  // silent fallback to the 250ms default.
  const entranceDuration = entrance?.duration ?? 250;
  const entranceProgress =
    currentTime < word.start
      ? 0
      : entranceDuration <= 0
        ? 1
        : Math.min(1, Math.max(0, entranceElapsed / entranceDuration));
  const entranceActive =
    !!entrance &&
    currentTime >= word.start &&
    entranceDuration > 0 &&
    entranceProgress < 1;

  if (entrance && entrance.type === "fade") {
    const progress = easeProgress(entranceProgress, entrance.easing);
    opacity = clampAmount(
      lerp(entrance.from ?? 0, entrance.to ?? (style.opacity ?? 1), progress)
    );
  } else if (entrance && entrance.type === "glow") {
    const progress = easeProgress(entranceProgress, entrance.easing);
    opacity = clampAmount(
      lerp(entrance.from ?? 0, entrance.to ?? (style.opacity ?? 1), progress)
    );
    // The fade/glow opacity eases across the whole lifecycle (above), but the
    // glow text-shadow only blooms while the entrance window is active so it
    // doesn't linger at full radius after the word has settled in.
    if (entranceActive) {
      shadow = {
        x: 0,
        y: 0,
        blur: (entrance.glowRadius ?? 20) * sf * progress,
        color: entrance.color || "#FFD700",
      };
    }
  }

  // Choreography-emphasis words still win over the global while-spoken recipe
  // (camera punch + SFX key off word.animation.emphasis).
  const isEmphasisWord = !!emphasis;
  const spoken = emphasis ?? activeAnim;
  if (isSpokenNow && spoken && spoken.type === "scale") {
    // While-spoken scale/glow animate over spoken.duration (clamped across the
    // whole spoken interval; a configured duration of 0 or undefined means an
    // immediate pop, matching the old behavior) using spoken.easing. Scale
    // starts from spoken.scaleFrom and ramps up to the target; glow blooms
    // from zero up to spoken.glowRadius. This mirrors the entrance path and the
    // preview renderer so export and preview are identical.
    const spokenElapsed = (currentTime - word.start) * 1000;
    const spokenDuration = spoken.duration ?? 0;
    const spokenProgress =
      spokenDuration <= 0
        ? 1
        : Math.min(1, Math.max(0, spokenElapsed / spokenDuration));
    const progress = easeProgress(spokenProgress, spoken.easing);
    // When spoken.scaleFrom is absent, start the spoken pop from the current
    // entrance-computed font size (fontPx) instead of 100, so an entrance like
    // Punchy's 40→120 doesn't get suppressed mid-bloom by a hard 100 start.
    const scaleFrom = spoken.scaleFrom ?? (fontPx / baseFontSize) * 100;
    const scaleTo = spoken.scaleTo ?? (isEmphasisWord ? 140 : 125);
    fontPx = clampFont(
      (baseFontSize * (scaleFrom + (scaleTo - scaleFrom) * progress)) / 100
    );
    if (spoken.color && !word.style?.color) color = spoken.color;
    if (spoken.glowRadius) {
      shadow = {
        x: 0,
        y: 0,
        blur: spoken.glowRadius * sf * progress,
        color: spoken.color || "#FFD700",
      };
    }
  } else if (isSpokenNow && spoken && spoken.type === "glow") {
    const spokenElapsed = (currentTime - word.start) * 1000;
    const spokenDuration = spoken.duration ?? 0;
    const spokenProgress =
      spokenDuration <= 0
        ? 1
        : Math.min(1, Math.max(0, spokenElapsed / spokenDuration));
    const progress = easeProgress(spokenProgress, spoken.easing);
    if (spoken.color && !word.style?.color) color = spoken.color;
    shadow = {
      x: 0,
      y: 0,
      blur: (spoken.glowRadius ?? 22) * sf * progress,
      color: spoken.color || "#FFD700",
    };
  }

  if (exit && exit.type !== "none" && hasEnded && isGroupLastWord) {
    const elapsedMs = (currentTime - word.end) * 1000;
    const exitDuration = exit.duration || EXIT_FADE_DEFAULT_DURATION_MS;
    const progress = easeProgress(
      Math.min(1, Math.max(0, elapsedMs / exitDuration)),
      exit.easing
    );
    if (exit.type === "scale") {
      const scale =
        (exit.scaleFrom ?? 100) +
        ((exit.scaleTo ?? 0) - (exit.scaleFrom ?? 100)) * progress;
      fontPx = clampFont((baseFontSize * scale) / 100);
    }
    opacity = clampAmount(lerp(exit.from ?? 1, exit.to ?? 0, progress));
  }

  if (!shadow && style.shadowColor) {
    shadow = {
      x: (style.shadowOffsetX || 0) * sf,
      y: (style.shadowOffsetY || 0) * sf,
      blur: (style.shadowBlur || 0) * sf,
      color: style.shadowColor,
    };
  }

  return {
    text: applyTextTransform(word.text, style.textTransform),
    fontFamily: resolveCanvasFontFamily(style.fontFamily ?? "Impact, sans-serif"),
    fontWeight: style.fontWeight ?? 400,
    fontPx,
    color,
    strokeWidthPx: (style.strokeWidth ?? 0) * sf,
    strokeColor: style.strokeColor ?? "#000000",
    letterSpacingPx: (style.letterSpacing ?? 0) * sf,
    opacity,
    shadow,
  };
}

export interface LayoutWord {
  visuals: WordVisuals;
  width: number;
  ascent: number;
  descent: number;
}

export interface LayoutLine {
  words: LayoutWord[];
  width: number;
  ascent: number;
  descent: number;
  /** Canvas text-baseline y for every word in the line (items-baseline). */
  baseline: number;
}

export interface CaptionLayout {
  lines: LayoutLine[];
  width: number;
  height: number;
}

function measureWordInContext(
  ctx: CanvasRenderingContext2D,
  v: WordVisuals
): { width: number; ascent: number; descent: number } {
  ctx.font = `${v.fontWeight} ${v.fontPx}px ${v.fontFamily}`;
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(v.text);
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? v.fontPx * 0.8;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? v.fontPx * 0.2;
  let width = m.width;
  if (v.letterSpacingPx !== 0 && v.text.length > 0) {
    width = 0;
    for (const ch of v.text) width += ctx.measureText(ch).width + v.letterSpacingPx;
    width -= v.letterSpacingPx;
  }
  return { width, ascent, descent };
}

// Mirrors `flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1`:
// greedy wrapping into the wrapper's max width, baseline-aligned rows, each
// line centered. Wraps per-frame so line breaks follow the same live reflow
// the DOM does as entrance/active pops resize words.
export function layoutCaptionWords(
  ctx: CanvasRenderingContext2D,
  visuals: WordVisuals[],
  wrapperMaxWidth: number
): CaptionLayout {
  const lines: LayoutLine[] = [];
  let current: LayoutWord[] = [];
  let currentWidth = 0;

  const pushLine = (words: LayoutWord[]) => {
    if (words.length === 0) return;
    let ascent = 0;
    let descent = 0;
    let width = 0;
    for (const w of words) {
      ascent = Math.max(ascent, w.ascent);
      descent = Math.max(descent, w.descent);
      width += w.width;
    }
    width += GAP_X * (words.length - 1);
    lines.push({ words, width, ascent, descent, baseline: 0 });
  };

  for (const v of visuals) {
    const m = measureWordInContext(ctx, v);
    const lw: LayoutWord = {
      visuals: v,
      width: m.width,
      ascent: m.ascent,
      descent: m.descent,
    };
    const needed = current.length ? currentWidth + GAP_X + m.width : m.width;
    if (current.length && needed > wrapperMaxWidth) {
      pushLine(current);
      current = [];
      currentWidth = 0;
    }
    const lwWidth = m.width;
    currentWidth += current.length === 0 ? lwWidth : GAP_X + lwWidth;
    current.push(lw);
  }
  pushLine(current);

  let cursor = 0;
  let width = 0;
  for (const line of lines) {
    line.baseline = cursor + line.ascent;
    cursor += line.ascent + line.descent + GAP_Y;
    width = Math.max(width, line.width);
  }
  const height = cursor > GAP_Y ? cursor - GAP_Y : 0;

  return { lines, width, height };
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function paintWord(ctx: CanvasRenderingContext2D, lw: LayoutWord, x: number, baseline: number) {
  const v = lw.visuals;
  ctx.save();
  ctx.globalAlpha = v.opacity;
  ctx.font = `${v.fontWeight} ${v.fontPx}px ${v.fontFamily}`;
  ctx.fillStyle = v.color;
  if (v.strokeWidthPx > 0) {
    ctx.strokeStyle = v.strokeColor;
    ctx.lineWidth = v.strokeWidthPx;
    ctx.lineJoin = "round";
    ctx.miterLimit = 1.5;
  }
  if (v.shadow) {
    ctx.shadowOffsetX = v.shadow.x;
    ctx.shadowOffsetY = v.shadow.y;
    ctx.shadowBlur = v.shadow.blur;
    ctx.shadowColor = v.shadow.color;
  }
  if (v.letterSpacingPx !== 0) {
    let cx = x;
    for (const ch of v.text) {
      if (v.strokeWidthPx > 0) ctx.strokeText(ch, cx, baseline);
      ctx.fillText(ch, cx, baseline);
      cx += ctx.measureText(ch).width + v.letterSpacingPx;
    }
  } else {
    if (v.strokeWidthPx > 0) ctx.strokeText(v.text, x, baseline);
    ctx.fillText(v.text, x, baseline);
  }
  ctx.restore();
}

export function paintCaptionGroup(
  ctx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  layout: CaptionLayout,
  groupLayout: GroupLayoutInput,
  globalStyle: GlobalStyle,
  scaleFactor: number
) {
  const yPct = Math.min(MAX_CAPTION_Y, Math.max(MIN_CAPTION_Y, globalStyle.transform.y ?? 80));
  const hasBg =
    !!globalStyle.style.backgroundColor && globalStyle.style.backgroundColor !== "transparent";
  const padVertical = (globalStyle.style.backgroundPadding ?? 6) * scaleFactor;
  const padHorizontal = padVertical * 2;
  const radius = (globalStyle.style.backgroundBorderRadius ?? 8) * scaleFactor;

  // Wrapper: `left: 50%; top: yPct%; translate(-50%, -50%) translate(x, y)` —
  // the layout.x/y drag offsets are design-surface px, so scale them by
  // scaleFactor onto the export canvas.
  const centerX = outW / 2 + (groupLayout.x ?? 0) * scaleFactor;
  const centerY = outH * (yPct / 100) + (groupLayout.y ?? 0) * scaleFactor;
  const scale = groupLayout.scale ?? 1;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(scale, scale);

  if (hasBg) {
    const boxW = layout.width + padHorizontal * 2;
    const boxH = layout.height + padVertical * 2;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    ctx.shadowBlur = 24;
    ctx.fillStyle = globalStyle.style.backgroundColor!;
    roundRectPath(
      ctx,
      -layout.width / 2 - padHorizontal,
      -layout.height / 2 - padVertical,
      boxW,
      boxH,
      radius
    );
    ctx.fill();
    ctx.restore();
  }

  for (const line of layout.lines) {
    let x = -line.width / 2;
    for (const lw of line.words) {
      paintWord(ctx, lw, x, line.baseline);
      x += lw.width + GAP_X;
    }
  }

  ctx.restore();
}

// The video frame source for a single paint call: either the raw <video>
// element, or (when background removal is active) an offscreen canvas
// already holding that frame composited over the chosen background —
// see BackgroundCompositor.renderFrame in background-composite.ts.
export type VideoFrameSource = HTMLVideoElement | HTMLCanvasElement;

function sourceSize(source: VideoFrameSource): { w: number; h: number } {
  return source instanceof HTMLVideoElement
    ? { w: source.videoWidth, h: source.videoHeight }
    : { w: source.width, h: source.height };
}

export interface SceneDrawOptions {
  transcription: TranscriptionResult;
  globalStyle: GlobalStyle;
  speakerStyles: Record<string, Partial<WordStyle>>;
  groupLayouts: Record<string, GroupLayoutInput>;
  video: VideoFrameSource | null;
  currentTime: number;
  outW: number;
  outH: number;
  previewPlatform: PreviewPlatform;
  /** Bottom legibility gradient — matches the preview overlay. Defaults to on. */
  drawGradient?: boolean;
  /** Defaults to outW / EXPORT_DESIGN_WIDTH. */
  scaleFactor?: number;
}

/**
 * Paints one full output frame: black canvas, the video (camera zoom applied
 * around center, object-cover when a platform crop is active with the user's
 * reframe offset, contain otherwise — matching VideoPreview), the bottom
 * gradient, then the active caption group. No editor chrome (selection frames
 * / toolbar / platform preview overlay) is drawn.
 */
export function paintExportFrame(canvas: HTMLCanvasElement, opts: SceneDrawOptions) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { outW, outH } = opts;
  const sf = opts.scaleFactor ?? outW / EXPORT_DESIGN_WIDTH;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, outW, outH);

  const video = opts.video;
  const { w: videoW, h: videoH } = video ? sourceSize(video) : { w: 0, h: 0 };
  if (video && videoW > 0 && videoH > 0) {
    const zoom = sampleZoom(
      opts.currentTime,
      opts.globalStyle.videoEffects.cameraEvents,
      opts.globalStyle.videoEffects
    );
    const crop = opts.previewPlatform !== "none";
    const srcW = videoW;
    const srcH = videoH;
    // Base cover scale at zoom = 1; camera zoom multiplies it. The reframe
    // margin is derived from these pre-zoom dimensions scaled by zoom, which
    // reproduces the preview's object-position physics exactly (the object
    // offset is applied to the unscaled layer, then the whole layer zooms).
    const baseScale =
      crop ? Math.max(outW / srcW, outH / srcH) : Math.min(outW / srcW, outH / srcH);
    const baseDw = srcW * baseScale;
    const baseDh = srcH * baseScale;
    const scale = baseScale * zoom;
    const dw = srcW * scale;
    const dh = srcH * scale;
    // Reframe: the crop window slides within the cover-scale overflow margin
    // by reframe.x/y (normalized -1..1, 0 = centered) — the same framing the
    // preview shows via object-position. Touched only for the platform crop.
    const rf = opts.globalStyle.videoEffects.reframe ?? { x: 0, y: 0 };
    const marginX = crop ? Math.max(0, (baseDw - outW) / 2) * zoom : 0;
    const marginY = crop ? Math.max(0, (baseDh - outH) / 2) * zoom : 0;
    const sx = (outW - dw) / 2 - (rf.x ?? 0) * marginX;
    const sy = (outH - dh) / 2 - (rf.y ?? 0) * marginY;
    ctx.drawImage(video, sx, sy, dw, dh);
  }

  if (opts.drawGradient !== false) {
    const gh = outH * 0.35;
    const g = ctx.createLinearGradient(0, outH - gh, 0, outH);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.fillStyle = g;
    ctx.fillRect(0, outH - gh, outW, gh);
  }

  const activeGroup = findActiveCaptionGroup(
    opts.transcription,
    opts.globalStyle,
    opts.currentTime
  );
  if (!activeGroup) return;

  const words: Word[] = [];
  for (const wid of activeGroup.wordIds) {
    const w = opts.transcription.words.find((x) => x.id === wid);
    if (w) words.push(w);
  }
  if (words.length === 0) return;

  const visuals = words.map((w, i) =>
    evaluateWordVisuals(
      w,
      opts.speakerStyles,
      opts.globalStyle,
      opts.currentTime,
      sf,
      i === words.length - 1
    )
  );

  const maxW = opts.globalStyle.style.maxWidth ?? 800;
  const wrapperMaxWidth = Math.min(maxW * sf, outW * 0.92);
  const layout = layoutCaptionWords(ctx, visuals, wrapperMaxWidth);
  const groupLayout = opts.groupLayouts[activeGroup.id] || { x: 0, y: 0, scale: 1 };

  paintCaptionGroup(ctx, outW, outH, layout, groupLayout, opts.globalStyle, sf);
}

export { GAP_X, GAP_Y };