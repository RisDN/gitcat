import type { ReactNode } from "react";

export interface ContextAction {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

export function ContextMenu({
  x,
  y,
  actions,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  actions: ContextAction[];
  onAction: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="gc-context-layer" onMouseDown={onClose} role="presentation">
      <div
        className="gc-context-menu"
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={(event) => event.stopPropagation()}
        role="menu"
        style={{ left: Math.min(x, window.innerWidth - 248), top: Math.min(y, window.innerHeight - 380) }}
      >
        {actions.map((action) => (
          <button
            className={`${action.separatorBefore ? "gc-context-menu__separator" : ""} ${action.danger ? "gc-context-menu__danger" : ""}`}
            disabled={action.disabled}
            key={action.id}
            onClick={() => onAction(action.id)}
            role="menuitem"
            type="button"
          >
            <span>{action.icon}</span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
