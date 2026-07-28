import { Check, Settings } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { GRAPH_COLUMNS, visibleGraphColumns } from "../lib/columns";
import type { GraphColumnSettings } from "../lib/types";
import { ContextMenu, type ContextAction } from "./ContextMenu";
import { IconButton } from "./ui";

const MENU_WIDTH = 244;

export function GraphColumnMenu({
  columns,
  onChange,
}: {
  columns: GraphColumnSettings;
  onChange: (columns: GraphColumnSettings) => void;
}) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const lastVisible = visibleGraphColumns(columns).length === 1;
  const actions: ContextAction[] = GRAPH_COLUMNS.map((column) => ({
    id: column.key,
    label: column.label,
    icon: columns[column.key] ? <Check aria-hidden="true" size={12} strokeWidth={3} /> : null,
    disabled: columns[column.key] && lastVisible,
  }));

  return (
    <>
      <IconButton
        aria-expanded={Boolean(menuPosition)}
        aria-haspopup="menu"
        aria-label="Column settings"
        className="size-6!"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setMenuPosition((current) => current ? null : { x: bounds.right - MENU_WIDTH, y: bounds.bottom + 3 });
        }}
        title="Column settings"
      >
        <Settings aria-hidden="true" size={13} />
      </IconButton>
      {menuPosition ? createPortal(
        <ContextMenu
          actions={actions}
          onAction={(action) => {
            const key = action as keyof GraphColumnSettings;
            onChange({ ...columns, [key]: !columns[key] });
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
