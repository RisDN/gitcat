import { AlertTriangle, Trash2, WandSparkles } from "lucide-react";

import { Badge, Button, IconButton } from "../ui";

export function WorktreeHeader({
  branchName,
  busy,
  changeCount,
  clean,
  conflictCount,
  stashCount,
  onAutoResolveConflicts,
  onDiscardAll,
}: {
  branchName: string;
  busy: boolean;
  changeCount: number;
  clean: boolean;
  conflictCount: number;
  stashCount: number;
  onAutoResolveConflicts: () => void;
  onDiscardAll: () => void;
}) {
  return (
    <header className="flex min-h-14.25 flex-[0_0_auto] items-center justify-between gap-2 border-b border-border px-2.75 py-2.25">
      <div className="flex min-w-0 items-center gap-1.75">
        <IconButton
          aria-label="Discard all changes"
          className="size-6.75! rounded! border-danger! bg-[color-mix(in_srgb,var(--gc-danger)_16%,var(--gc-background))] text-danger! enabled:hover:border-danger! enabled:hover:bg-danger! enabled:hover:text-white! disabled:cursor-default disabled:opacity-45"
          disabled={busy || !changeCount}
          onClick={onDiscardAll}
          title="Discard all changes"
        >
          <Trash2 aria-hidden="true" size={15} />
        </IconButton>
        <div className="flex min-w-0 items-center gap-1.25 text-[12px]">
          <strong className="whitespace-nowrap">
            {clean ? "No file changes" : `${changeCount} file change${changeCount === 1 ? "" : "s"}`}
          </strong>
          <small className="text-[11px] text-muted">on</small>
          <Badge className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" tone="accent">{branchName}</Badge>
        </div>
      </div>
      <span className="flex items-center justify-end gap-1.25">
        {conflictCount ? (
          <>
            <Badge className="gap-1 whitespace-nowrap" tone="danger">
              <AlertTriangle size={11} /> {conflictCount} conflicts
            </Badge>
            <Button
              className="min-h-6.5! px-1.75! text-[9px]!"
              compact
              disabled={busy}
              icon={<WandSparkles size={13} />}
              onClick={onAutoResolveConflicts}
              title="Reuse exact conflict resolutions previously recorded by Git rerere"
            >
              Auto-resolve
            </Button>
          </>
        ) : stashCount ? (
          <Badge className="whitespace-nowrap" tone="muted">{stashCount} stashed</Badge>
        ) : null}
      </span>
    </header>
  );
}
