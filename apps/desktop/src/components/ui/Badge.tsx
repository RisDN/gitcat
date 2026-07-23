import type { ReactNode } from "react";

import { cx } from "../../lib";

const TONE: Record<string, string> = {
  muted: "border-border text-muted",
  accent: "border-[color-mix(in_srgb,var(--gc-accent)_42%,var(--gc-border))] text-accent",
  warning: "border-[color-mix(in_srgb,var(--gc-warning)_45%,var(--gc-border))] text-warning",
  danger: "border-[color-mix(in_srgb,var(--gc-danger)_55%,var(--gc-border))] bg-danger/9 text-danger",
};

export function Badge({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex min-h-5 items-center rounded-full border bg-muted/9 px-1.75 py-px text-[11px] font-[650]",
        TONE[tone] ?? TONE.muted,
        className,
      )}
    >
      {children}
    </span>
  );
}
