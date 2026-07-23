import type { ReactNode } from "react";

import { cx } from "../../lib";

export function IdentityRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-2.5 px-3 pb-3 pt-0.75">{children}</div>;
}

// Renders the shimmer placeholder when no initials are known yet.
export function Avatar({ initials }: { initials?: string }) {
  const shape = "size-9.75 shrink-0 rounded-[5px_11px_5px_11px]";
  if (initials === undefined) return <span className={cx("skeleton", shape)} />;
  return (
    <span
      className={cx(
        shape,
        "grid place-items-center border border-[color-mix(in_srgb,var(--gc-accent)_48%,var(--gc-border))] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--gc-accent)_22%,var(--gc-panel)),var(--gc-background))] font-extrabold text-accent",
      )}
    >
      {initials || "?"}
    </span>
  );
}

export function StatsRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 border-y border-border px-3 py-2">{children}</div>;
}

export function FilesPanel({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col border-t border-border">{children}</div>;
}

export function FilesHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8.75 flex-[0_0_35px] items-center px-3 text-[10px] font-[750] uppercase tracking-[0.06em] text-muted">
      {children}
    </div>
  );
}
