"use client";

import type { ReactNode } from "react";
import type { PreviewPlatform } from "@/core/types";

const PLATFORMS: { label: string; value: PreviewPlatform }[] = [
  { label: "None", value: "none" },
  { label: "TikTok", value: "tiktok" },
  { label: "Reels", value: "reels" },
  { label: "Shorts", value: "shorts" },
];

export function PlatformPreviewToggle({
  value,
  onChange,
  className = "",
}: {
  value: PreviewPlatform;
  onChange: (p: PreviewPlatform) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-1 bg-black/40 rounded-lg p-1 ${className}`}>
      {PLATFORMS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          title={p.value === "none" ? "Hide platform preview" : `Preview how this looks on ${p.label}`}
          className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
            value === p.value ? "bg-[#00ff66] text-black" : "text-zinc-300 hover:bg-white/10"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// Percentage-based mirrors of each feed's 2026 mobile chrome, checked against
// real app screenshots and safe-zone guides (not just forward-engineered from
// memory): TikTok = right rail ~14% wide, bottom ~25%; Reels = rail on the
// RIGHT (~90-100px in-app, same side as TikTok — an earlier version of this
// file had it on the left, which doesn't match any current Reels build),
// bottom ~20-22%; Shorts = most aggressive, bottom tray ~30% + Subscribe. Icons
// are filled like the shipping builds; no pixel-copy of a single release
// (those shift by device/region).
const FILL = "currentColor";

// --- engagement icons (filled, matching shipped builds) --------------------

const HEART = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";
const COMMENT_BUBBLE = "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z";
const SAVE_RIBBON = "M6 2h12a1 1 0 0 1 1 1v18l-7-4-7 4V3a1 1 0 0 1 1-1z";
// A curved forward/redo arrow — confirmed against a real App Store TikTok
// screenshot and the YouTube Shorts player: both use this "bent arrow" shape
// for Share, not a paper-plane/dart (what this constant held before).
const SHARE_ARROW = "M20.19 8.7L14 3.3a1 1 0 0 0-1.66.75V7c-6.4.5-10.5 4.4-11.34 10.5a1 1 0 0 0 1.84.66C4.5 15.1 7.6 13.2 12.34 13v3a1 1 0 0 0 1.66.75l6.19-5.4a1 1 0 0 0 0-1.65z";
const THUMBS_UP = "M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.3-8a2 2 0 0 0-2-2.3H14zM7 21H2v-8h5v8z";
const THUMBS_DOWN = "M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7L2.4 11.7a2 2 0 0 0 2 2.3H10zM17 22h5v-8h-5v8z";
const SEARCH = "M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z";
const CAMERA = "M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z";
const REMIX_STROKE = "M20.24 12.24a8.95 8.95 0 1 1-1.5-6.74M20.24 3v4.5h-4.5";
// Reels-specific icons, confirmed against a real official App Store
// screenshot: Reels uses a "Repost" loop-arrows icon (not TikTok/Shorts'
// single curved arrow) and a paper-plane "send" icon for actual Share.
const REPOST_LOOP = "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z";
const PAPER_PLANE = "M3 20l18-8L3 4v6l12 2-12 2z";

function FilledIcon({ path, size = 22 }: { path: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={FILL} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function StrokeIcon({ path, size = 20, strokeWidth = 1.8 }: { path: string; size?: number; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="white" strokeWidth={strokeWidth}>
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// TikTok comment bubble ships with three dot accents drawn on top.
function TikTokComment({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill={FILL} d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      <circle cx="8" cy="11.5" r="1.3" fill="#0b0b0d" />
      <circle cx="12" cy="11.5" r="1.3" fill="#0b0b0d" />
      <circle cx="16" cy="11.5" r="1.3" fill="#0b0b0d" />
    </svg>
  );
}

function RailAction({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {children}
      {label ? <span className="text-[10px] text-white font-semibold drop-shadow">{label}</span> : null}
    </div>
  );
}

function TikTokFlatAction({ icon, label }: { icon: ReactNode; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {icon}
      {label ? <span className="text-[11px] text-white font-medium drop-shadow">{label}</span> : null}
    </div>
  );
}

function Avatar({ gradient, size = 38, badge }: { gradient: string; size?: number; badge?: ReactNode }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className={`w-full h-full rounded-full ring-[2.5px] ${gradient} p-[2px]`}>
        <div className="w-full h-full rounded-full bg-zinc-600" />
      </div>
      {badge}
    </div>
  );
}

function TikTokDisc() {
  return (
    <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none">
      <circle cx="12" cy="12" r="11" fill="#101014" stroke="#fff" strokeOpacity="0.9" strokeWidth="0.7" />
      <circle cx="12" cy="12" r="8.5" stroke="#fff" strokeOpacity="0.3" strokeWidth="0.6" />
      <circle cx="12" cy="12" r="6" stroke="#fff" strokeOpacity="0.3" strokeWidth="0.6" />
      <circle cx="12" cy="12" r="3.5" stroke="#fff" strokeOpacity="0.3" strokeWidth="0.6" />
      <path d="M9 4.2a8 8 0 0 1 9.5 6.3" stroke="#00f2ea" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.35" fill="#fff" />
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/* TikTok — Following|For You tabs + search top; avatar, like, comment,      */
/* save-star, share on the RIGHT rail; caption bar + ♬ marquee + disc bottom */
/* ------------------------------------------------------------------------ */
function TikTokChrome() {
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent" style={{ height: "9%" }}>
        <div className="h-full flex items-center justify-center gap-6 text-[14px]">
          <span className="text-white/60 font-medium">Following</span>
          <span className="text-white font-bold underline underline-offset-[12px] decoration-2">For You</span>
        </div>
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 px-1 py-0.5 rounded border border-white/70">
          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="white"><rect x="3" y="7" width="18" height="12" rx="1" /><path d="M7 7l3-4M17 7l-3-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
          <span className="text-[9px] font-bold text-white">LIVE</span>
        </div>
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <StrokeIcon path={SEARCH} size={21} strokeWidth={2} />
        </div>
      </div>

      <div className="absolute flex flex-col items-center gap-3.5" style={{ top: "22%", right: "3%" }}>
        <RailAction label="@you">
          <Avatar
            gradient="bg-gradient-to-br from-red-400 via-red-600 to-black"
            badge={
              <div className="absolute -bottom-1 -right-1 w-[14px] h-[14px] rounded-full bg-[#00ff66] flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="#000">
                  <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z" />
                </svg>
              </div>
            }
          />
        </RailAction>
        <TikTokFlatAction icon={<FilledIcon path={HEART} size={30} />} label="12.4M" />
        <TikTokFlatAction icon={<TikTokComment size={30} />} label="1.2M" />
        <TikTokFlatAction icon={<FilledIcon path={SAVE_RIBBON} size={26} />} label="841K" />
        <TikTokFlatAction icon={<FilledIcon path={SHARE_ARROW} size={28} />} label="2281" />
        {/* Sound disc is the rail's last item in the real app — directly below
            Share, not separately anchored near the screen corner. */}
        <TikTokDisc />
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent" style={{ height: "26%" }}>
        <div className="absolute inset-x-3 bottom-3 pr-14 flex flex-col gap-1">
          <span className="text-[15px] font-bold text-white drop-shadow">@captionlab</span>
          <div className="h-2 w-3/5 rounded-full bg-white/50" />
          <div className="h-2 w-2/5 rounded-full bg-white/35" />
          <div className="mt-1 flex items-center gap-1.5">
            <span className="w-[18px] h-[18px] rounded bg-white/80 flex items-center justify-center text-[10px] text-black font-bold">♪</span>
            <div className="h-2 w-1/3 rounded-full bg-white/40" />
            <span className="text-[9px] text-white/80">original sound</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Instagram Reels — camera + Reels / search + share up top; the action      */
/* rail is on the RIGHT (same side as TikTok/Shorts); @creator + caption at  */
/* bottom-left, kept clear of the rail via right padding                    */
/* ------------------------------------------------------------------------ */
function ReelsChrome() {
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent" style={{ height: "9%" }}>
        <div className="h-full flex items-center justify-between px-3">
          <div className="flex items-center gap-1.5">
            <StrokeIcon path={CAMERA} size={21} strokeWidth={1.7} />
            <span className="text-[17px] font-bold tracking-tight text-white drop-shadow">Reels</span>
          </div>
          <div className="flex items-center gap-4">
            <StrokeIcon path={SEARCH} size={21} strokeWidth={2} />
            <FilledIcon path={PAPER_PLANE} size={19} />
          </div>
        </div>
      </div>

      {/* Heart/Comment/Repost/Share only — confirmed via a real App Store
          screenshot. No avatar/Follow at the top of this rail (that was
          wrong); the account cluster lives at the bottom next to the caption,
          same pattern as Shorts. */}
      <div className="absolute flex flex-col items-center gap-3" style={{ top: "30%", right: "3%" }}>
        <RailAction label="12.4K">
          <FilledIcon path={HEART} size={26} />
        </RailAction>
        <RailAction label="1,034">
          <FilledIcon path={COMMENT_BUBBLE} size={26} />
        </RailAction>
        <RailAction label="2.1K">
          <FilledIcon path={REPOST_LOOP} size={24} />
        </RailAction>
        <RailAction label="15.1K">
          <FilledIcon path={PAPER_PLANE} size={24} />
        </RailAction>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent" style={{ height: "22%" }}>
        <div className="absolute inset-x-3 bottom-3 pr-14 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Avatar
              gradient="bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5]"
              size={24}
            />
            <span className="text-[13px] font-semibold text-white drop-shadow">@captionlab</span>
            <span className="px-2 py-0.5 rounded border border-white/70 text-[9px] font-semibold text-white leading-none">Follow</span>
          </div>
          <div className="h-2 w-3/5 rounded-full bg-white/45" />
          <div className="h-2 w-2/5 rounded-full bg-white/30" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* YouTube Shorts — Shorts wordmark top-left; avatar + Subscribe on the right*/
/* rail with 👍/👎/💬/Share/Remix/✕; the tallest bottom tray of the three    */
/* ------------------------------------------------------------------------ */
function ShortsChrome() {
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent" style={{ height: "9%" }}>
        <div className="h-full flex items-center gap-1.5 px-3">
          <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]">
            <rect x="2" y="2" width="20" height="20" rx="5" fill="#ff0033" />
            <path d="M10 8l6.5 4L10 16V8z" fill="#fff" />
          </svg>
          <span className="text-[15px] font-bold tracking-tight text-white drop-shadow">Shorts</span>
        </div>
      </div>

      {/* Engagement rail — Like/Dislike/Comment/Share/Remix only. The channel
          avatar + Subscribe live at the bottom near the caption in the real
          app (confirmed via the official YouTube Shorts player screenshot),
          not stacked at the top of this rail like an earlier version had it. */}
      <div className="absolute flex flex-col items-center gap-2.5" style={{ top: "22%", right: "2.5%" }}>
        <RailAction label="45K">
          <FilledIcon path={THUMBS_UP} size={22} />
        </RailAction>
        <RailAction>
          <FilledIcon path={THUMBS_DOWN} size={22} />
        </RailAction>
        <RailAction label="2.1K">
          <FilledIcon path={COMMENT_BUBBLE} size={24} />
        </RailAction>
        <RailAction label="Share">
          <FilledIcon path={SHARE_ARROW} size={23} />
        </RailAction>
        <RailAction label="Remix">
          <StrokeIcon path={REMIX_STROKE} size={22} strokeWidth={2} />
        </RailAction>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent" style={{ height: "30%" }}>
        <div className="absolute inset-x-3 bottom-5 flex flex-col gap-1.5 pr-16">
          <div className="flex items-center gap-1.5">
            <Avatar gradient="bg-gradient-to-br from-[#1f6feb] to-[#0b3b8c]" size={22} />
            <span className="text-xs font-semibold text-white drop-shadow">@captionlab</span>
            <span className="px-2 py-0.5 rounded-full bg-white/90 text-[9px] font-bold text-black leading-none">Subscribe</span>
          </div>
          <div className="h-2 w-4/5 rounded-full bg-white/50" />
          <div className="h-2 w-3/5 rounded-full bg-white/38" />
          <div className="mt-0.5 flex gap-2">
            <span className="px-2 h-[18px] rounded-full bg-white/15 text-[9px] font-medium text-white flex items-center">captionlab</span>
            <span className="px-2 h-[18px] rounded-full bg-white/15 text-[9px] font-medium text-white flex items-center">#shorts</span>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/40" />
      </div>
    </div>
  );
}

export default function PlatformPreviewOverlay({ platform }: { platform: PreviewPlatform }) {
  if (platform === "none") return null;
  return (
    <div className="absolute inset-0 pointer-events-none select-none z-10 overflow-hidden">
      {platform === "tiktok" && <TikTokChrome />}
      {platform === "reels" && <ReelsChrome />}
      {platform === "shorts" && <ShortsChrome />}
    </div>
  );
}