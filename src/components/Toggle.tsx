"use client";

/* The knob is positioned with inline styles rather than Tailwind's
   `translate-x-*` utilities. In this app's generated CSS `.translate-x-0.5`
   has no rule at all and `.translate-x-5` resolves to the same 2px as the
   "off" value, so the knob sat at one position in both states. Inline styles
   are independent of the stylesheet, so the switch is guaranteed to move. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      onClick={onChange}
      className={`
        relative w-10 h-5 rounded-full transition-colors shrink-0
        ${checked ? "bg-[#00FF66]" : "bg-zinc-700"}
      `}
    >
      <span
        className="absolute w-4 h-4 rounded-full bg-white shadow"
        style={{
          top: 2,
          left: 2,
          transform: checked ? "translateX(20px)" : "translateX(0px)",
          transition: "transform 150ms ease",
        }}
      />
    </button>
  );
}
