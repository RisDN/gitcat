import { Check } from "lucide-react";
import type { ReactNode, RefObject, UIEvent } from "react";

import { cx } from "../../lib";
import type { MergeRow, MergeSide } from "../../lib/mergeConflicts";

// Each side owns a colour and keeps it everywhere it appears: the pane badge,
// its conflict lines, and the lines it contributed to the result. Picking a
// line is then readable without matching text between three panes.
export const SIDE_TONE: Record<MergeSide, {
  badge: string;
  bar: string;
  row: string;
  rowSelected: string;
  tag: string;
}> = {
  ours: {
    badge: "bg-accent text-[#07161b]",
    bar: "bg-accent",
    row: "bg-accent/8",
    rowSelected: "bg-accent/20",
    tag: "text-accent",
  },
  theirs: {
    badge: "bg-warning text-[#1c1204]",
    bar: "bg-warning",
    row: "bg-warning/8",
    rowSelected: "bg-warning/20",
    tag: "text-warning",
  },
};

export function MergePaneHeader({
  badge,
  badgeSide,
  checked,
  label,
  detail,
  onToggleAll,
  right,
}: {
  badge?: string;
  badgeSide?: MergeSide;
  checked?: boolean;
  label: ReactNode;
  detail?: ReactNode;
  onToggleAll?: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="flex h-9 flex-[0_0_auto] items-center gap-2 border-b border-border bg-panel/74 px-2.5">
      {onToggleAll ? (
        <button
          aria-label={checked ? `Remove every ${badge ?? "side"} line from the result` : `Add every ${badge ?? "side"} line to the result`}
          aria-pressed={checked}
          className="grid shrink-0 cursor-pointer place-items-center bg-transparent p-0"
          onClick={onToggleAll}
          title={checked ? "Deselect this side everywhere" : "Select this side for every conflict"}
          type="button"
        >
          <span
            className={cx(
              "grid size-3.5 place-items-center rounded-[3px] border",
              checked && badgeSide
                ? cx("border-transparent", SIDE_TONE[badgeSide].bar, badgeSide === "ours" ? "text-[#07161b]" : "text-[#1c1204]")
                : "border-border-strong bg-background text-transparent",
            )}
          >
            <Check size={10} strokeWidth={3} />
          </span>
        </button>
      ) : null}
      {badge ? (
        <span
          className={cx(
            "inline-grid size-4.5 shrink-0 place-items-center rounded-[3px] text-[10px] font-bold",
            badgeSide ? SIDE_TONE[badgeSide].badge : "bg-muted/30 text-foreground",
          )}
        >
          {badge}
        </span>
      ) : null}
      <strong className="min-w-0 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px]">{label}</strong>
      {detail ? (
        <small className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-muted">{detail}</small>
      ) : <span className="flex-1" />}
      {right}
    </header>
  );
}

export function MergePane({
  ariaLabel,
  busy = false,
  emptyMessage,
  header,
  isSelected,
  onToggleConflict,
  onScroll,
  rows,
  scrollRef,
  showSideTag = false,
}: {
  ariaLabel: string;
  busy?: boolean;
  emptyMessage?: string;
  header: ReactNode;
  isSelected?: (conflictIndex: number) => boolean;
  onToggleConflict?: (conflictIndex: number) => void;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  rows: MergeRow[];
  scrollRef?: RefObject<HTMLDivElement | null>;
  showSideTag?: boolean;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-border last:border-r-0">
      {header}
      {emptyMessage !== undefined ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-[11px] text-muted">{emptyMessage}</div>
      ) : (
        <div
          aria-label={ariaLabel}
          className="min-h-0 min-w-0 flex-1 overflow-auto py-1"
          onScroll={onScroll}
          ref={scrollRef}
        >
          {rows.map((row) => {
            const conflict = row.conflictIndex !== null;
            const selected = conflict && isSelected ? isSelected(row.conflictIndex as number) : false;
            const interactive = conflict && Boolean(onToggleConflict);
            const tone = row.side ? SIDE_TONE[row.side] : null;
            const body = (
              <>
                <span className={cx("h-full w-full", row.tone === "unresolved" ? "bg-lane-3" : tone && (selected || showSideTag) ? tone.bar : "")} />
                <span className={cx("grid place-items-center font-mono text-[9px] font-bold", tone?.tag)}>
                  {showSideTag && row.side ? (row.side === "ours" ? "A" : "B") : null}
                  {!showSideTag && conflict && row.first && onToggleConflict ? (
                    <span
                      aria-hidden="true"
                      className={cx(
                        "grid size-3.5 place-items-center rounded-[3px] border",
                        selected && tone
                          ? cx("border-transparent", tone.bar, row.side === "ours" ? "text-[#07161b]" : "text-[#1c1204]")
                          : "border-border-strong bg-background text-transparent",
                      )}
                    >
                      <Check size={10} strokeWidth={3} />
                    </span>
                  ) : null}
                </span>
                <span className="select-none border-r border-border/75 px-1.75 text-right font-mono text-[9px] leading-[1.7] text-muted">
                  {row.number ?? ""}
                </span>
                <code
                  className={cx(
                    "min-w-0 overflow-hidden text-ellipsis whitespace-pre px-2 font-mono text-[11px] leading-[1.7]",
                    row.tone === "unresolved" && "text-foreground",
                  )}
                >
                  {row.text || " "}
                </code>
              </>
            );
            const className = cx(
              "grid w-full grid-cols-[3px_20px_38px_minmax(0,1fr)] items-stretch text-left",
              row.tone === "unresolved" && "bg-lane-3/38",
              row.tone === "conflict" && tone && (selected || showSideTag ? tone.rowSelected : tone.row),
              interactive && "cursor-pointer hover:brightness-125",
            );
            return interactive ? (
              <button
                className={className}
                data-conflict={row.first ? row.conflictIndex : undefined}
                disabled={busy}
                key={row.key}
                onClick={() => onToggleConflict?.(row.conflictIndex as number)}
                title={selected ? "Remove these lines from the result" : "Add these lines to the result"}
                type="button"
              >
                {body}
              </button>
            ) : (
              <div className={className} data-conflict={row.first ? row.conflictIndex : undefined} key={row.key}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
