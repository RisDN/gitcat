import { FolderPlus, Plus } from "lucide-react";
import { useMemo } from "react";

import { IconButton } from "../ui";
import { RepositoryTab } from "./RepositoryTab";
import type { RepositoryTabContextMenuRequest, TabView } from "./RepositoryTab";
import { TabGroupLabel, TabStrip } from "./TabGroup";
import type { TabGroupView } from "./TabGroup";
import { TabOverview } from "./TabOverview";

interface TopTabsProps {
  ungroupedTabs: TabView[];
  groups: TabGroupView[];
  activeTabId?: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOpen: () => void;
  onCreateGroup: () => void;
  onToggleGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string) => void;
  onMoveTab: (tabId: string, groupId: string | null) => void;
  onTabContextMenu: (request: RepositoryTabContextMenuRequest) => void;
  actionsDisabled?: boolean;
}

export function TopTabs({
  ungroupedTabs,
  groups,
  activeTabId,
  onSelect,
  onClose,
  onOpen,
  onCreateGroup,
  onToggleGroup,
  onRenameGroup,
  onMoveTab,
  onTabContextMenu,
  actionsDisabled = false,
}: TopTabsProps) {
  const orderedTabs = useMemo(
    () => [...ungroupedTabs, ...groups.flatMap((group) => group.tabs)],
    [groups, ungroupedTabs],
  );

  const navigateFromTab = (
    tabId: string,
    direction: "previous" | "next" | "first" | "last",
  ) => {
    if (!orderedTabs.length) return;
    const currentIndex = orderedTabs.findIndex((tab) => tab.id === tabId);
    const nextIndex = direction === "first"
      ? 0
      : direction === "last"
        ? orderedTabs.length - 1
        : direction === "previous"
          ? (currentIndex - 1 + orderedTabs.length) % orderedTabs.length
          : (currentIndex + 1) % orderedTabs.length;
    const nextTab = orderedTabs[nextIndex];
    if (!nextTab) return;
    onSelect(nextTab.id);
    requestAnimationFrame(() => {
      const tabElement = [...document.querySelectorAll<HTMLElement>("[data-repository-tab]")]
        .find((element) => element.dataset.repositoryTab === nextTab.id);
      tabElement?.querySelector<HTMLButtonElement>("[data-tab-main]")?.focus();
    });
  };

  const renderTab = (tab: TabView, groupId: string | null) => (
    <RepositoryTab
      active={activeTabId === tab.id}
      actionsDisabled={actionsDisabled}
      groupId={groupId}
      key={tab.id}
      onClose={onClose}
      onContextMenu={onTabContextMenu}
      onNavigate={navigateFromTab}
      onSelect={onSelect}
      tab={tab}
    />
  );

  return (
    <div
      className="z-20 flex h-14 flex-[0_0_56px] select-none items-stretch border-b border-border bg-[linear-gradient(180deg,color-mix(in_srgb,var(--gc-surface)_97%,black),color-mix(in_srgb,var(--gc-surface)_91%,black))]"
      aria-label="Repositories"
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden px-1.5 py-1.25 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Open repositories"
      >
        {ungroupedTabs.length ? (
          <TabStrip ariaLabel="Repositories without a folder" onDrop={(tabId) => { if (!actionsDisabled) onMoveTab(tabId, null); }}>
            {ungroupedTabs.map((tab) => renderTab(tab, null))}
          </TabStrip>
        ) : null}
        {groups.map((group) => {
          const containsActiveTab = group.tabs.some((tab) => tab.id === activeTabId);
          const collapsed = group.collapsed && !containsActiveTab;
          return (
            <TabStrip
              ariaLabel={`${group.name} folder`}
              collapsed={collapsed}
              grouped
              key={group.id}
              onDrop={(tabId) => { if (!actionsDisabled) onMoveTab(tabId, group.id); }}
            >
              <TabGroupLabel
                collapsed={collapsed}
                containsActiveTab={containsActiveTab}
                group={group}
                onRename={() => onRenameGroup(group.id)}
                onToggle={() => onToggleGroup(group.id)}
              />
              {collapsed ? null : group.tabs.map((tab) => renderTab(tab, group.id))}
            </TabStrip>
          );
        })}
        {!orderedTabs.length ? (
          <span className="flex h-11 items-center px-2.5 text-[11px] text-muted">
            No repositories open
          </span>
        ) : null}
      </div>
      <div className="flex flex-[0_0_auto] items-center gap-1 border-l border-border bg-background/22 px-2">
        <TabOverview
          activeTabId={activeTabId}
          disabled={actionsDisabled}
          groups={groups}
          onSelect={onSelect}
          ungroupedTabs={ungroupedTabs}
        />
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
        <IconButton
          aria-label="New repository folder"
          className="size-8.5! rounded-md!"
          disabled={actionsDisabled}
          onClick={onCreateGroup}
          title="New repository folder"
        >
          <FolderPlus size={16} />
        </IconButton>
        <button
          className="inline-flex h-8.5 cursor-pointer items-center gap-1.25 rounded-md border border-[color-mix(in_srgb,var(--gc-accent)_38%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-accent)_10%,var(--gc-panel))] px-2.25 text-[11px] font-[680] text-foreground transition-colors enabled:hover:border-accent enabled:hover:bg-[color-mix(in_srgb,var(--gc-accent)_17%,var(--gc-panel))] focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
          disabled={actionsDisabled}
          onClick={onOpen}
          title="Open repository"
          type="button"
        >
          <Plus className="text-accent" size={15} strokeWidth={2.25} />
          <span>Open</span>
        </button>
      </div>
    </div>
  );
}
