import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { conflictSideLabels } from "../../lib/conflicts";
import type { ConflictResolution, RepositoryOperationState } from "../../lib/types";
import { ContextMenu, type ContextAction } from "../ContextMenu";
import { IconButton } from "../ui";

const MENU_WIDTH = 268;

export function ConflictBulkMenu({
  branchName,
  busy,
  operation,
  onAutoResolveConflicts,
  onResolveAllConflicts,
}: {
  branchName: string;
  busy: boolean;
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
    <>
      <IconButton
        aria-expanded={Boolean(menuPosition)}
        aria-haspopup="menu"
        aria-label="More bulk conflict resolutions"
        className="size-6!"
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
    </>
  );
}
