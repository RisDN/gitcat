import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

export interface ContextAction {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  submenu?: ContextAction[];
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
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState({ left: Math.max(8, x), top: Math.max(8, y) });
  const [openSubmenu, setOpenSubmenu] = useState<{ id: string; left: number; top: number } | null>(null);

  const openSubmenuFor = (id: string, host: HTMLElement) => {
    const bounds = host.getBoundingClientRect();
    const width = 244;
    let left = bounds.right - 4;
    if (left + width > window.innerWidth - 8) left = bounds.left - width + 4;
    setOpenSubmenu({ id, left: Math.max(8, left), top: Math.max(8, bounds.top - 6) });
  };

  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = menuRef.current;
    if (menu) {
      const bounds = menu.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)),
      });
      buttonRefs.current.find((button) => button && !button.disabled)?.focus();
    }
    return () => previousFocus?.focus();
  }, [x, y]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>, direction: 1 | -1 | "first" | "last") => {
    const enabled = buttonRefs.current.filter((button): button is HTMLButtonElement => Boolean(button && !button.disabled));
    if (!enabled.length) return;
    event.preventDefault();
    if (direction === "first") enabled[0].focus();
    else if (direction === "last") enabled.at(-1)?.focus();
    else {
      const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
      enabled[(current + direction + enabled.length) % enabled.length].focus();
    }
  };

  return (
    <div className="gc-context-layer" onMouseDown={onClose} role="presentation">
      <div
        className="gc-context-menu"
        ref={menuRef}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") moveFocus(event, 1);
          else if (event.key === "ArrowUp") moveFocus(event, -1);
          else if (event.key === "Home") moveFocus(event, "first");
          else if (event.key === "End") moveFocus(event, "last");
          else if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            onClose();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        role="menu"
        style={position}
      >
        {actions.map((action, index) => {
          if (action.submenu) {
            const open = openSubmenu?.id === action.id;
            return (
              <div
                className={`gc-context-menu__submenu-host${action.separatorBefore ? " gc-context-menu__separator" : ""}`}
                key={action.id}
                onMouseLeave={() => setOpenSubmenu((current) => (current?.id === action.id ? null : current))}
              >
                <button
                  aria-expanded={open}
                  aria-haspopup="menu"
                  className={action.danger ? "gc-context-menu__danger" : ""}
                  disabled={action.disabled}
                  onClick={(event) => {
                    if (openSubmenu?.id === action.id) setOpenSubmenu(null);
                    else openSubmenuFor(action.id, event.currentTarget);
                  }}
                  onMouseEnter={(event) => openSubmenuFor(action.id, event.currentTarget)}
                  onFocus={(event) => openSubmenuFor(action.id, event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight") { event.preventDefault(); openSubmenuFor(action.id, event.currentTarget); }
                    else if (event.key === "ArrowLeft") { event.preventDefault(); setOpenSubmenu(null); }
                  }}
                  ref={(node) => { buttonRefs.current[index] = node; }}
                  role="menuitem"
                  type="button"
                >
                  <span>{action.icon}</span>
                  <span>{action.label}</span>
                  <ChevronRight aria-hidden="true" className="gc-context-menu__chevron" size={13} />
                </button>
                {open ? (
                  <div
                    className="gc-context-menu gc-context-menu--nested"
                    role="menu"
                    style={{ left: openSubmenu.left, top: openSubmenu.top }}
                  >
                    {action.submenu.map((child) => (
                      <button
                        className={`${child.separatorBefore ? "gc-context-menu__separator" : ""} ${child.danger ? "gc-context-menu__danger" : ""}`}
                        disabled={child.disabled}
                        key={child.id}
                        onClick={() => onAction(child.id)}
                        role="menuitem"
                        type="button"
                      >
                        <span>{child.icon}</span>
                        <span>{child.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }
          return (
            <button
              className={`${action.separatorBefore ? "gc-context-menu__separator" : ""} ${action.danger ? "gc-context-menu__danger" : ""}`}
              disabled={action.disabled}
              key={action.id}
              onClick={() => onAction(action.id)}
              onMouseEnter={() => setOpenSubmenu(null)}
              ref={(node) => { buttonRefs.current[index] = node; }}
              role="menuitem"
              type="button"
            >
              <span>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
