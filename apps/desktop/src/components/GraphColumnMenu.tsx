import { Check, Settings } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import {
  ALL_GRAPH_COLUMNS,
  COMPACT_GRAPH_COLUMN_WIDTHS,
  DEFAULT_GRAPH_COLUMN_WIDTHS,
  GRAPH_COLUMNS,
  visibleGraphColumns,
} from "../lib/columns";
import type { GraphColumnSettings, GraphColumnWidths } from "../lib/types";
import { ContextMenu, type ContextAction } from "./ContextMenu";
import { IconButton } from "./ui";

const MENU_WIDTH = 244;

export function GraphColumnMenu({
  columns,
  onChange,
  onWidthsChange,
}: {
  columns: GraphColumnSettings;
  onChange: (columns: GraphColumnSettings) => void;
  onWidthsChange: (widths: GraphColumnWidths) => void;
}) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const lastVisible = visibleGraphColumns(columns).length === 1;
  const actions: ContextAction[] = [
    ...GRAPH_COLUMNS.map((column) => ({
      id: column.key,
      label: column.label,
      icon: columns[column.key] ? <Check aria-hidden="true" size={12} strokeWidth={3} /> : null,
      disabled: columns[column.key] && lastVisible,
    })),
    { id: "reset-default", label: "Reset columns to default layout", separatorBefore: true },
    { id: "reset-compact", label: "Reset columns to compact layout" },
  ];

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
            if (action === "reset-default" || action === "reset-compact") {
              // Both resets restore every column too: a layout is the widths
              // and the visibility together.
              onChange({ ...ALL_GRAPH_COLUMNS });
              onWidthsChange({
                ...(action === "reset-default"
                  ? DEFAULT_GRAPH_COLUMN_WIDTHS
                  : COMPACT_GRAPH_COLUMN_WIDTHS),
              });
              return;
            }

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
