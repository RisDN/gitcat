import {
  AlertTriangle,
  CircleDotDashed,
  FolderGit2,
  House,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

import { cx } from "../../lib";
import { IconButton } from "../ui";
import { repositoryLocation, repositoryTabDescription } from "./tabPresentation";

export interface TabView {
  id: string;
  label: string;
  path: string;
  kind?: "repository" | "start";
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
  onNavigate,
}: {
  tab: TabView;
  groupId: string | null;
  active: boolean;
  actionsDisabled: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onContextMenu: (request: RepositoryTabContextMenuRequest) => void;
  onNavigate: (tabId: string, direction: "previous" | "next" | "first" | "last") => void;
}) {
  const tabRef = useRef<HTMLDivElement>(null);
  const TabIcon = tab.kind === "start" ? House : FolderGit2;
  const location = tab.kind === "start" ? "Repository home" : repositoryLocation(tab.path);

  useEffect(() => {
    const tabElement = tabRef.current;
    if (!active || !tabElement) return;

    const keepActiveTabVisible = () => {
      tabElement.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    keepActiveTabVisible();

    const tabList = tabElement.closest('[role="tablist"]');
    if (!tabList || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(keepActiveTabVisible);
    observer.observe(tabList);
    return () => observer.disconnect();
  }, [active]);

  const openContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (actionsDisabled) return;
    event.currentTarget.querySelector<HTMLButtonElement>("[data-tab-main]")?.focus();
    onContextMenu({ tab, groupId, clientX: event.clientX, clientY: event.clientY });
  };

  const openKeyboardContextMenu = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      if (actionsDisabled) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      onContextMenu({ tab, groupId, clientX: bounds.left + 12, clientY: bounds.bottom - 2 });
      return;
    }

    const direction = {
      ArrowLeft: "previous",
      ArrowRight: "next",
      Home: "first",
      End: "last",
    }[event.key] as "previous" | "next" | "first" | "last" | undefined;
    if (!direction) return;
    event.preventDefault();
    onNavigate(tab.id, direction);
  };

  return (
    <div
      aria-disabled={tab.unavailable || undefined}
      className={cx(
        "group/tab relative flex h-11 w-49 min-w-41 max-w-54 items-stretch overflow-hidden rounded-[6px] border transition-[background-color,border-color,box-shadow,opacity] duration-120",
        active
          ? "border-[color-mix(in_srgb,var(--gc-accent)_40%,var(--gc-border))] bg-background text-foreground shadow-[0_1px_0_color-mix(in_srgb,var(--gc-text)_4%,transparent),0_5px_14px_rgb(0_0_0/16%)] after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-accent after:shadow-[0_0_9px_color-mix(in_srgb,var(--gc-accent)_52%,transparent)] after:content-['']"
          : "border-transparent bg-transparent text-muted hover:border-border/65 hover:bg-foreground/4 hover:text-foreground",
        tab.unavailable && "border-dashed opacity-[0.68]",
        "data-[dragging=true]:opacity-35",
      )}
      data-repository-tab={tab.id}
      draggable={!actionsDisabled}
      onAuxClick={(event) => {
        if (event.button === 1 && !actionsDisabled) onClose(tab.id);
      }}
      onContextMenu={openContextMenu}
      onDragEnd={(event) => {
        delete event.currentTarget.dataset.dragging;
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/gitcat-tab", tab.id);
        event.dataTransfer.effectAllowed = "move";
        event.currentTarget.dataset.dragging = "true";
      }}
      ref={tabRef}
      title={repositoryTabDescription(tab)}
    >
      <button
        aria-selected={active}
        className={cx(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-2 bg-transparent py-1 pl-2.25 text-inherit",
          "focus-visible:bg-row-selected focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        )}
        data-tab-main=""
        onClick={() => onSelect(tab.id)}
        onKeyDown={openKeyboardContextMenu}
        role="tab"
        tabIndex={active ? 0 : -1}
        type="button"
      >
        <span
          className={cx(
            "grid size-6.5 shrink-0 place-items-center rounded-[4px] border",
            active
              ? "border-[color-mix(in_srgb,var(--gc-accent)_36%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-accent)_11%,var(--gc-panel))] text-accent"
              : "border-border/55 bg-background/35 text-muted group-hover/tab:text-foreground",
          )}
        >
          <TabIcon size={14} strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="flex min-w-0 items-center gap-1.25">
            <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-[670] leading-4 text-inherit">
              {tab.label}
            </strong>
            {tab.dirty ? (
              <CircleDotDashed
                aria-label="Uncommitted changes"
                className="shrink-0 text-warning"
                size={11}
              />
            ) : null}
            {tab.conflictCount ? (
              <span
                aria-label={`${tab.conflictCount} unresolved conflict${tab.conflictCount === 1 ? "" : "s"}`}
                className="inline-flex shrink-0 items-center gap-0.5 text-danger"
              >
                <AlertTriangle size={11} />
                <b className="font-mono text-[8px] font-bold leading-none">{tab.conflictCount}</b>
              </span>
            ) : null}
          </span>
          <span
            className={cx(
              "block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[9px] leading-3",
              tab.unavailable ? "text-danger" : active ? "text-muted" : "text-muted/78",
            )}
          >
            {tab.unavailable ? `Unavailable · ${location}` : location}
          </span>
        </span>
      </button>
      <IconButton
        aria-label={`Close ${tab.label}`}
        className={cx(
          "mr-1 h-full! w-5.5! rounded-[4px]! transition-opacity duration-100",
          active
            ? "opacity-75 hover:opacity-100"
            : "pointer-events-none opacity-0 group-hover/tab:pointer-events-auto group-hover/tab:opacity-70 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-70",
        )}
        disabled={actionsDisabled}
        onClick={() => onClose(tab.id)}
        tabIndex={active ? 0 : -1}
        title={`Close ${tab.label}`}
      >
        <X size={12} />
      </IconButton>
    </div>
  );
}
