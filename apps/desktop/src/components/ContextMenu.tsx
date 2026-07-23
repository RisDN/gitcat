import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ComponentPropsWithRef, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import { cx } from "../lib";
import { MenuIcon, MenuItem, MenuItemHost, MenuLabel, MenuSurface } from "./menu";

const NESTED_MENU_WIDTH = 268;

// Slightly lighter border and rounder corners than the in-app menus.
function ContextSurface({ className = "", ...props }: ComponentPropsWithRef<"div">) {
  return (
    <MenuSurface
      className={cx(
        "max-h-[calc(100vh-16px)] rounded-[7px]! border-[color-mix(in_srgb,var(--gc-border)_92%,white_3%)]!",
        className,
      )}
      {...props}
    />
  );
}

function focusWithoutScrolling(element: HTMLElement | null | undefined): void {
  element?.focus({ preventScroll: true });
}

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
    const width = NESTED_MENU_WIDTH;
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
      focusWithoutScrolling(buttonRefs.current.find((button) => button && !button.disabled));
    }
    return () => focusWithoutScrolling(previousFocus);
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
    if (direction === "first") focusWithoutScrolling(enabled[0]);
    else if (direction === "last") focusWithoutScrolling(enabled.at(-1));
    else {
      const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
      focusWithoutScrolling(enabled[(current + direction + enabled.length) % enabled.length]);
    }
  };

  return (
    <div className="fixed inset-0 z-200" onMouseDown={onClose} role="presentation">
      <ContextSurface
        className="absolute w-61"
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
              <MenuItemHost
                key={action.id}
                separatorBefore={action.separatorBefore}
                onMouseLeave={() => setOpenSubmenu((current) => (current?.id === action.id ? null : current))}
              >
                <MenuItem
                  aria-expanded={open}
                  aria-haspopup="menu"
                  danger={action.danger}
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
                >
                  {action.icon !== undefined ? <MenuIcon>{action.icon}</MenuIcon> : null}
                  <MenuLabel>{action.label}</MenuLabel>
                  <ChevronRight aria-hidden="true" className="ml-auto text-muted" size={13} />
                </MenuItem>
                {open ? (
                  <ContextSurface
                    className="fixed z-201 w-67"
                    role="menu"
                    style={{ left: openSubmenu.left, top: openSubmenu.top }}
                  >
                    {action.submenu.map((child) => (
                      <MenuItem
                        danger={child.danger}
                        disabled={child.disabled}
                        key={child.id}
                        onClick={() => onAction(child.id)}
                        role="menuitem"
                        separatorBefore={child.separatorBefore}
                      >
                        {child.icon !== undefined ? <MenuIcon>{child.icon}</MenuIcon> : null}
                        <MenuLabel>{child.label}</MenuLabel>
                      </MenuItem>
                    ))}
                  </ContextSurface>
                ) : null}
              </MenuItemHost>
            );
          }
          return (
            <MenuItem
              danger={action.danger}
              disabled={action.disabled}
              key={action.id}
              onClick={() => onAction(action.id)}
              onMouseEnter={() => setOpenSubmenu(null)}
              ref={(node) => { buttonRefs.current[index] = node; }}
              role="menuitem"
              separatorBefore={action.separatorBefore}
            >
              {action.icon !== undefined ? <MenuIcon>{action.icon}</MenuIcon> : null}
              <MenuLabel>{action.label}</MenuLabel>
            </MenuItem>
          );
        })}
      </ContextSurface>
    </div>
  );
}
