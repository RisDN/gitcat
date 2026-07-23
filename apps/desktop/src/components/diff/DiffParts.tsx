import type { ReactNode } from "react";

import { cx } from "../../lib";
import type { DiffLine } from "../../lib/types";

export type DiffViewMode = "inline" | "split";

export function linePrefix(kind: DiffLine["kind"]): string {
  switch (kind) {
    case "addition":
      return "+";
    case "deletion":
      return "−";
    case "context":
      return " ";
    case "no_newline":
      return "";
  }
}

export function displayLineNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

export function LineContent({ line }: { line: DiffLine }) {
  return (
    <>
      <span aria-hidden="true" className="gc-diff-line__prefix">
        {linePrefix(line.kind)}
      </span>
      <code className="gc-diff-line__code">{line.content || " "}</code>
    </>
  );
}

// One hunk of a file diff; the label ties the table to its @@ range for AT.
export function HunkSection({ label, children }: { label: string; children: ReactNode }) {
  return <section aria-labelledby={label} className="w-full min-w-full">{children}</section>;
}

// Sticks to the top of the scroller so the @@ range stays visible while reading
// a long hunk; .gc-diff-table__head offsets its own sticky top by this height.
export function HunkHeader({ id, children }: { id: string; children: string }) {
  return (
    <h3
      className="sticky top-0 z-3 m-0 border-y border-[color-mix(in_srgb,var(--gc-accent)_30%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-accent)_9%,var(--gc-panel))] px-2.75 py-1.5 text-[10px] font-medium text-[color-mix(in_srgb,var(--gc-accent)_72%,var(--gc-text))]"
      id={id}
    >
      <code>{children}</code>
    </h3>
  );
}

const CHANGE_KIND_TONE: Record<string, string> = {
  added: "border-[color-mix(in_srgb,var(--gc-success)_55%,var(--gc-border))] text-success",
  deleted: "border-[color-mix(in_srgb,var(--gc-danger)_55%,var(--gc-border))] text-danger",
};

export function ChangeKind({ status }: { status: string }) {
  return (
    <span
      className={cx(
        "rounded-[3px] border px-1.25 py-0.5 text-[9px] uppercase",
        CHANGE_KIND_TONE[status] ?? "border-border text-muted",
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function ModeButton({ active, children, mode, onSelect }: {
  active: boolean;
  children: string;
  mode: DiffViewMode;
  onSelect: (mode: DiffViewMode) => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cx(
        "cursor-pointer rounded-[3px] bg-transparent px-2.25 py-1.25 text-[10px] font-bold",
        active ? "bg-[color-mix(in_srgb,var(--gc-accent)_17%,var(--gc-panel))] text-accent" : "text-muted",
      )}
      data-diff-mode={mode}
      onClick={() => onSelect(mode)}
      type="button"
    >
      {children}
    </button>
  );
}

export function DiffState({ children }: { children: string }) {
  return (
    <div className="grid min-h-45 flex-1 place-items-center text-muted" role="status">
      {children}
    </div>
  );
}
