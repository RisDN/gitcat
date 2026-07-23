import { AlertTriangle, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

import { cx } from "../../lib";
import { IconButton } from "../ui";

export interface TabView {
  id: string;
  label: string;
  path: string;
  dirty?: boolean;
  conflictCount?: number;
  unavailable?: boolean;
}

export interface RepositoryTabContextMenuRequest {
  tab: TabView;
  groupId: string | null;
  clientX: number;
  clientY: number;
}

export function RepositoryTab({
  tab,
  groupId,
  active,
  actionsDisabled,
  onSelect,
  onClose,
  onContextMenu,
}: {
  tab: TabView;
  groupId: string | null;
  active: boolean;
  actionsDisabled: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onContextMenu: (request: RepositoryTabContextMenuRequest) => void;
}) {
  const openContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (actionsDisabled) return;
    event.currentTarget.querySelector<HTMLButtonElement>("[data-tab-main]")?.focus();
    onContextMenu({ tab, groupId, clientX: event.clientX, clientY: event.clientY });
  };

  const openKeyboardContextMenu = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    if (actionsDisabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onContextMenu({ tab, groupId, clientX: bounds.left + 12, clientY: bounds.bottom - 2 });
  };

  return (
    <div
      className={cx(
        "flex w-44.5 items-stretch border-r border-border/75",
        active
          ? "relative bg-background text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent after:content-['']"
          : "bg-transparent text-muted hover:bg-foreground/4 hover:text-foreground",
        tab.unavailable && "opacity-[0.52]",
      )}
      draggable={!actionsDisabled}
      onAuxClick={(event) => {
        if (event.button === 1 && !actionsDisabled) onClose(tab.id);
      }}
      onContextMenu={openContextMenu}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/gitcat-tab", tab.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 bg-transparent pl-2.75 pr-1 text-inherit"
        data-tab-main=""
        onClick={() => onSelect(tab.id)}
        onKeyDown={openKeyboardContextMenu}
        title={tab.path}
        type="button"
      >
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[12px] font-[650]">
          {tab.label}
        </span>
        {tab.conflictCount ? (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 text-danger"
            title={`${tab.conflictCount} unresolved conflict${tab.conflictCount === 1 ? "" : "s"}`}
          >
            <AlertTriangle size={13} />
            <b className="font-mono text-[9px] font-bold leading-none">{tab.conflictCount}</b>
          </span>
        ) : tab.dirty ? (
          <span className="size-1.5 shrink-0 rounded-full bg-warning" title="Uncommitted changes" />
        ) : null}
      </button>
      <IconButton
        aria-label={`Close ${tab.label}`}
        className="h-full! w-6.5! rounded-none!"
        disabled={actionsDisabled}
        onClick={() => onClose(tab.id)}
      >
        <X size={13} />
      </IconButton>
    </div>
  );
}
