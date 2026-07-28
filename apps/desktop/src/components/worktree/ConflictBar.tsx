import { AlertTriangle, ChevronDown, WandSparkles } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { conflictSideLabels } from "../../lib/conflicts";
import type { ConflictResolution, RepositoryOperationState } from "../../lib/types";
import { ContextMenu, type ContextAction } from "../ContextMenu";
import { Button, IconButton } from "../ui";

const MENU_WIDTH = 268;

export function ConflictBar({
  branchName,
  busy,
  conflictCount,
  operation,
  onAutoResolveConflicts,
  onResolveAllConflicts,
}: {
  branchName: string;
  busy: boolean;
  conflictCount: number;
  operation: RepositoryOperationState;
  onAutoResolveConflicts: () => void;
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
    <div
      className="flex min-h-9.75 flex-[0_0_auto] items-center gap-2 border-b border-[color-mix(in_srgb,var(--gc-danger)_32%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-danger)_8%,var(--gc-panel))] px-2.75 py-1.5"
      role="status"
    >
      <AlertTriangle aria-hidden="true" className="shrink-0 text-danger" size={14} />
      <strong className="min-w-0 flex-1 truncate text-[11px] text-danger">
        {conflictCount} conflicted file{conflictCount === 1 ? "" : "s"}
      </strong>
      <Button
        className="min-h-6.75! shrink-0 px-2! text-[11px]!"
        compact
        disabled={busy}
        icon={<WandSparkles size={12} />}
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
        className="size-6.75! shrink-0"
        disabled={busy}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setMenuPosition((current) => current ? null : { x: bounds.right - MENU_WIDTH, y: bounds.bottom + 3 });
        }}
        title="More bulk conflict resolutions"
      >
        <ChevronDown aria-hidden="true" size={13} />
      </IconButton>
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
    </div>
  );
}
