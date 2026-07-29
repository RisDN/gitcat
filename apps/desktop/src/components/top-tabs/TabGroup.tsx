import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";
import type { DragEvent as ReactDragEvent, ReactNode } from "react";

import { cx } from "../../lib";
import type { TabView } from "./RepositoryTab";

export interface TabGroupView {
  id: string;
  name: string;
  collapsed: boolean;
  tabs: TabView[];
}

// Also used for the ungrouped run of tabs, which has no label.
export function TabStrip({ ariaLabel, collapsed = false, children, grouped = false, onDrop }: {
  ariaLabel?: string;
  collapsed?: boolean;
  children: ReactNode;
  grouped?: boolean;
  onDrop: (tabId: string) => void;
}) {
  const [dropActive, setDropActive] = useState(false);

  return (
    <div
      aria-label={ariaLabel}
      className={cx(
        "relative flex flex-[0_0_auto] items-center gap-1 rounded-[7px] border border-transparent p-0.5 transition-[background-color,border-color] duration-100",
        grouped && "bg-background/18",
        collapsed && "px-0.5",
        dropActive && "border-[color-mix(in_srgb,var(--gc-accent)_55%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-accent)_8%,transparent)]",
      )}
      onDragEnter={() => setDropActive(true)}
      onDragLeave={(event: ReactDragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDragOver={(event: ReactDragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event: ReactDragEvent) => {
        setDropActive(false);
        const tabId = event.dataTransfer.getData("text/gitcat-tab");
        if (tabId) onDrop(tabId);
      }}
      role="group"
    >
      {children}
    </div>
  );
}

export function TabGroupLabel({ collapsed, containsActiveTab, group, onRename, onToggle }: {
  collapsed: boolean;
  containsActiveTab: boolean;
  group: TabGroupView;
  onRename: () => void;
  onToggle: () => void;
}) {
  const GroupIcon = collapsed ? Folder : FolderOpen;

  return (
    <button
      aria-expanded={!collapsed}
      aria-label={`${group.name} folder, ${group.tabs.length} ${group.tabs.length === 1 ? "repository" : "repositories"}`}
      className={cx(
        "group/folder relative flex h-11 min-w-25 max-w-37 items-center gap-1.75 rounded-[5px] border px-2 text-left transition-[background-color,border-color,color] duration-100",
        "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--gc-accent)_18%,transparent)]",
        collapsed
          ? "cursor-pointer border-border/65 bg-background/38 text-muted hover:border-border-strong hover:bg-foreground/5 hover:text-foreground"
          : "border-border/70 bg-[color-mix(in_srgb,var(--gc-panel)_76%,transparent)] text-foreground",
        containsActiveTab && "border-[color-mix(in_srgb,var(--gc-accent)_30%,var(--gc-border))]",
      )}
      onClick={() => { if (!containsActiveTab) onToggle(); }}
      onDoubleClick={onRename}
      title={containsActiveTab
        ? `${group.name} - contains the active repository; double-click to rename`
        : `${group.name} - double-click to rename`}
      type="button"
    >
      <span className="grid size-6.5 shrink-0 place-items-center rounded-[4px] border border-border/60 bg-background/48 text-muted group-hover/folder:text-foreground">
        <GroupIcon size={14} strokeWidth={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[9.5px] font-[750] uppercase leading-3.5 tracking-[0.065em]">
          {group.name}
        </strong>
        <span className="flex items-center gap-1 font-mono text-[8px] leading-3 text-muted">
          {group.tabs.length} {group.tabs.length === 1 ? "repo" : "repos"}
          {containsActiveTab ? <i className="size-1 rounded-full bg-accent shadow-[0_0_5px_var(--gc-accent)]" /> : null}
        </span>
      </span>
      {collapsed ? <ChevronRight className="shrink-0" size={12} /> : <ChevronDown className="shrink-0" size={12} />}
    </button>
  );
}
