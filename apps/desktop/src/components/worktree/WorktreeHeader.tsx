import { AlertTriangle, ChevronDown, Trash2, WandSparkles } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { conflictSideLabels } from "../../lib/conflicts";
import type { ConflictResolution, RepositoryOperationState } from "../../lib/types";
import { ContextMenu, type ContextAction } from "../ContextMenu";
import { Badge, Button, IconButton } from "../ui";

const MENU_WIDTH = 268;

export function WorktreeHeader({
  branchName,
  busy,
  changeCount,
  clean,
  conflictCount,
  operation,
  stashCount,
  onAutoResolveConflicts,
  onDiscardAll,
  onResolveAllConflicts,
}: {
  branchName: string;
  busy: boolean;
  changeCount: number;
  clean: boolean;
  conflictCount: number;
  operation: RepositoryOperationState;
  stashCount: number;
  onAutoResolveConflicts: () => void;
  onDiscardAll: () => void;
  onResolveAllConflicts: (resolution: ConflictResolution) => void;
}) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const labels = conflictSideLabels(operation, branchName);
  const actions: ContextAction[] = [
    { id: "ours", label: `Take ${labels.ours} for all` },
    { id: "theirs", label: `Take ${labels.theirs} for all` },
    { id: "auto", label: "Reuse recorded resolutions", separatorBefore: true },
  ];

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
              onClick={() => onResolveAllConflicts("mark_resolved")}
              title={`Stage the current working copy of all ${conflictCount} conflicted files as resolved`}
              tone="warning"
            >
              Mark all resolved
            </Button>
            <IconButton
              aria-expanded={Boolean(menuPosition)}
              aria-haspopup="menu"
              aria-label="More bulk conflict resolutions"
              className="size-6.5!"
              disabled={busy}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                setMenuPosition((current) => current ? null : { x: bounds.right - MENU_WIDTH, y: bounds.bottom + 3 });
              }}
              title="More bulk conflict resolutions"
            >
              <ChevronDown aria-hidden="true" size={13} />
            </IconButton>
          </>
        ) : stashCount ? (
          <Badge className="whitespace-nowrap" tone="muted">{stashCount} stashed</Badge>
        ) : null}
      </span>
      {menuPosition ? createPortal(
        <ContextMenu
          actions={actions}
          onAction={(action) => {
            setMenuPosition(null);
            if (action === "auto") onAutoResolveConflicts();
            else onResolveAllConflicts(action as ConflictResolution);
          }}
          onClose={() => setMenuPosition(null)}
          x={menuPosition.x}
          y={menuPosition.y}
        />,
        document.body,
      ) : null}
    </header>
  );
}
