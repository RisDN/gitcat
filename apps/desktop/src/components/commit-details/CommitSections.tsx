import type { ReactNode } from "react";

import { cx, identityInitials } from "../../lib";
import type { Identity } from "../../lib/types";

export function IdentityRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-2.5 px-3 pb-3 pt-0.75">{children}</div>;
}

// Renders the shimmer placeholder when no initials are known yet.
export function Avatar({ initials }: { initials?: string }) {
  const shape = "size-9.75 shrink-0 rounded";
  if (initials === undefined) return <span className={cx("skeleton", shape)} />;
  return (
    <span
      className={cx(
        shape,
        "grid place-items-center border font-extrabold text-accent",
      )}
    >
      {initials || "?"}
    </span>
  );
}

export function CoAuthorRow({ coAuthors }: { coAuthors: readonly Identity[] }) {
  if (coAuthors.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-3">
      <span className="text-[10px] font-[750] uppercase tracking-[0.06em] text-muted">
        Co-authors
      </span>
      <ul className="flex flex-col gap-1.5">
        {coAuthors.map((coAuthor) => (
          <li className="flex min-w-0 items-center gap-2" key={`${coAuthor.name}:${coAuthor.email}`}>
            <span
              className={cx(
                "size-6 shrink-0 rounded-[4px_8px_4px_8px]",
                "grid place-items-center border border-[color-mix(in_srgb,var(--gc-accent)_38%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-accent)_12%,var(--gc-panel))] text-[10px] font-extrabold text-accent",
              )}
              title={coAuthor.email || coAuthor.name}
            >
              {identityInitials(coAuthor.name) || "?"}
            </span>
            <span
              className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px]"
              title={coAuthor.email || coAuthor.name}
            >
              {coAuthor.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatsRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 border-b border-border px-3 pb-2">{children}</div>;
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
