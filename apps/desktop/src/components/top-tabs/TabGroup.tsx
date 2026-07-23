import { ChevronDown, ChevronRight, Folder } from "lucide-react";
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
export function TabStrip({ collapsed = false, children, onDrop }: {
  collapsed?: boolean;
  children: ReactNode;
  onDrop: (tabId: string) => void;
}) {
  return (
    <div
      className={cx("flex flex-[0_0_auto] items-stretch border-r border-border", collapsed && "items-center px-0.75")}
      onDragOver={(event: ReactDragEvent) => event.preventDefault()}
      onDrop={(event: ReactDragEvent) => {
        const tabId = event.dataTransfer.getData("text/gitcat-tab");
        if (tabId) onDrop(tabId);
      }}
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
  return (
    <button
      aria-expanded={!collapsed}
      className="flex min-w-20.5 max-w-33 cursor-pointer items-center gap-1.25 border-r border-border/70 bg-background/44 px-2.25 text-[10px] font-bold uppercase tracking-[0.04em] text-muted hover:bg-foreground/5 hover:text-foreground"
      onClick={() => { if (!containsActiveTab) onToggle(); }}
      onDoubleClick={onRename}
      title={containsActiveTab
        ? `${group.name} — contains the active repository; double-click to rename`
        : `${group.name} — double-click to rename`}
      type="button"
    >
      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      <Folder size={13} />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{group.name}</span>
      {collapsed ? <b className="ml-auto text-[10px] text-accent">{group.tabs.length}</b> : null}
    </button>
  );
}
