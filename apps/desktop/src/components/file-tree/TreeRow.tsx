import { Minus, Pencil, Plus } from "lucide-react";
import type { ComponentPropsWithRef } from "react";

import { cx } from "../../lib";
import { treeIndent } from "./tree";

const FILE_STATUS_TONE: Record<string, string> = {
  added: "text-success",
  untracked: "text-success",
  deleted: "text-danger",
  unmerged: "text-danger",
  modified: "text-warning",
  type_changed: "text-warning",
  renamed: "text-warning",
  copied: "text-warning",
};

export function fileStatusClass(status: string): string {
  return cx(
    "grid size-4.75 place-items-center font-mono text-[10px] font-[750] leading-none",
    FILE_STATUS_TONE[status] ?? "text-muted",
  );
}

// A conflicted row keeps its danger tint over the selection colour: an unmerged
// path needs attention before anything else in the list.
export function TreeRow({ children, selected, unmerged, ...props }: ComponentPropsWithRef<"div"> & {
  selected?: boolean;
  unmerged?: boolean;
}) {
  return (
    <div
      className={cx(
        "group/row relative flex min-w-0 items-center rounded-[3px]",
        selected && "shadow-[inset_2px_0_0_var(--gc-accent)]",
        unmerged ? "bg-danger/6" : selected ? "bg-row-selected" : "hover:bg-row-hover",
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TreeEntry({ className = "", depth, ...props }: ComponentPropsWithRef<"button"> & { depth: number }) {
  return (
    <button
      className={cx(
        "flex min-h-7.25 min-w-0 cursor-pointer items-center gap-1.75 bg-transparent pl-[calc(7px+var(--gc-tree-depth)*15px)] pr-1.5 text-left text-[11px] font-medium leading-[1.35] text-muted hover:text-foreground",
        className,
      )}
      style={treeIndent(depth)}
      type="button"
      {...props}
    />
  );
}

export function EntryName({ children }: { children: string }) {
  return <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{children}</span>;
}

export function ChangeCount({ tone, children }: { tone: "add" | "remove"; children: number }) {
  const Icon = tone === "add" ? Plus : Minus;
  return (
    <small className="flex shrink-0 items-center gap-px font-mono text-[9px] leading-none text-foreground">
      <Icon
        aria-hidden="true"
        className={cx("shrink-0", tone === "add" ? "text-success" : "text-danger")}
        size={10}
        strokeWidth={3}
      />
      {children}
    </small>
  );
}

export function ModifiedCount({ children }: { children: number }) {
  return (
    <small className="flex shrink-0 items-center gap-px font-mono text-[9px] leading-none text-foreground">
      <Pencil aria-hidden="true" className="shrink-0 text-warning" size={10} strokeWidth={3} />
      {children}
    </small>
  );
}

// Revealed on row hover, or pinned open while a conflict is unresolved.
export function RowAction({ children, pinned }: { children: React.ReactNode; pinned: boolean }) {
  return (
    <span
      className={cx(
        "absolute right-1.25 top-1/2 z-2 grid w-23 -translate-y-1/2 place-items-end transition-opacity",
        pinned
          ? "opacity-100"
          : "pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
      )}
    >
      {children}
    </span>
  );
}
