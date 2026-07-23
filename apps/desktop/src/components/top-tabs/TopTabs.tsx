import { FolderPlus, Plus } from "lucide-react";

import { IconButton } from "../ui";
import { Brand } from "./Brand";
import { RepositoryTab } from "./RepositoryTab";
import type { RepositoryTabContextMenuRequest, TabView } from "./RepositoryTab";
import { TabGroupLabel, TabStrip } from "./TabGroup";
import type { TabGroupView } from "./TabGroup";

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
  const renderTab = (tab: TabView, groupId: string | null) => (
    <RepositoryTab
      active={activeTabId === tab.id}
      actionsDisabled={actionsDisabled}
      groupId={groupId}
      key={tab.id}
      onClose={onClose}
      onContextMenu={onTabContextMenu}
      onSelect={onSelect}
      tab={tab}
    />
  );

  return (
    <div
      className="z-20 flex h-11.5 flex-[0_0_46px] select-none items-stretch border-b border-border bg-[color-mix(in_srgb,var(--gc-surface)_94%,black)]"
      aria-label="Repositories"
    >
      <Brand />
      <div
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:h-0.75"
        role="navigation"
        aria-label="Open repositories"
      >
        {ungroupedTabs.length ? (
          <TabStrip onDrop={(tabId) => { if (!actionsDisabled) onMoveTab(tabId, null); }}>
            {ungroupedTabs.map((tab) => renderTab(tab, null))}
          </TabStrip>
        ) : null}
        {groups.map((group) => {
          const containsActiveTab = group.tabs.some((tab) => tab.id === activeTabId);
          const collapsed = group.collapsed && !containsActiveTab;
          return (
            <TabStrip
              collapsed={collapsed}
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
      </div>
      <div className="flex flex-[0_0_auto] items-center gap-0.5 border-l border-border px-2">
        <IconButton aria-label="New repository group" disabled={actionsDisabled} onClick={onCreateGroup} title="New group">
          <FolderPlus size={16} />
        </IconButton>
        <IconButton aria-label="Open repository" disabled={actionsDisabled} onClick={onOpen} title="Open repository">
          <Plus size={18} />
        </IconButton>
      </div>
    </div>
  );
}
