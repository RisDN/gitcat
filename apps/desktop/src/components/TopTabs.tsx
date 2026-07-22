import { AlertTriangle, ChevronDown, ChevronRight, Folder, FolderPlus, Plus, X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { IconButton } from "./Primitives";

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

export interface TabGroupView {
  id: string;
  name: string;
  collapsed: boolean;
  tabs: TabView[];
}

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

function RepositoryTabItem({
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
    event.currentTarget.querySelector<HTMLButtonElement>(".gc-tab__main")?.focus();
    onContextMenu({ tab, groupId, clientX: event.clientX, clientY: event.clientY });
  };

  const openKeyboardContextMenu = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    if (actionsDisabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onContextMenu({ tab, groupId, clientX: bounds.left + 12, clientY: bounds.bottom - 2 });
  };

  return (
    <div
      className={`gc-tab ${active ? "gc-tab--active" : ""} ${tab.unavailable ? "gc-tab--unavailable" : ""}`}
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
        className="gc-tab__main"
        onClick={() => onSelect(tab.id)}
        onKeyDown={openKeyboardContextMenu}
        title={tab.path}
        type="button"
      >
        <span className="gc-tab__branch" aria-hidden="true" />
        <span className="gc-tab__label">{tab.label}</span>
        {tab.conflictCount ? (
          <span className="gc-tab__conflict" title={`${tab.conflictCount} unresolved conflict${tab.conflictCount === 1 ? "" : "s"}`}>
            <AlertTriangle size={13} />
            <b>{tab.conflictCount}</b>
          </span>
        ) : tab.dirty ? <span className="gc-tab__dirty" title="Uncommitted changes" /> : null}
      </button>
      <IconButton aria-label={`Close ${tab.label}`} disabled={actionsDisabled} onClick={() => onClose(tab.id)}>
        <X size={13} />
      </IconButton>
    </div>
  );
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
  return (
    <div className="gc-tabs" aria-label="Repositories">
      <div className="gc-brand" aria-label="GitCat">
        <span className="gc-brand__mark">GC</span>
        <span className="gc-brand__name">GitCat</span>
      </div>
      <div className="gc-tabs__scroll" role="navigation" aria-label="Open repositories">
        {ungroupedTabs.length ? (
          <div
            className="gc-tab-group gc-tab-group--ungrouped"
            onDragOver={(event) => { if (!actionsDisabled) event.preventDefault(); }}
            onDrop={(event) => {
              if (actionsDisabled) return;
              const tabId = event.dataTransfer.getData("text/gitcat-tab");
              if (tabId) onMoveTab(tabId, null);
            }}
          >
            {ungroupedTabs.map((tab) => (
              <RepositoryTabItem
                active={activeTabId === tab.id}
                actionsDisabled={actionsDisabled}
                groupId={null}
                key={tab.id}
                onClose={onClose}
                onContextMenu={onTabContextMenu}
                onSelect={onSelect}
                tab={tab}
              />
            ))}
          </div>
        ) : null}
        {groups.map((group) => {
          const containsActiveTab = group.tabs.some((tab) => tab.id === activeTabId);
          const collapsed = group.collapsed && !containsActiveTab;
          return (
            <div
              className={`gc-tab-group ${collapsed ? "gc-tab-group--collapsed" : ""}`}
              key={group.id}
              onDragOver={(event) => { if (!actionsDisabled) event.preventDefault(); }}
              onDrop={(event) => {
                if (actionsDisabled) return;
                const tabId = event.dataTransfer.getData("text/gitcat-tab");
                if (tabId) onMoveTab(tabId, group.id);
              }}
            >
              <button
                aria-expanded={!collapsed}
                className="gc-tab-group__label"
                onClick={() => { if (!containsActiveTab) onToggleGroup(group.id); }}
                onDoubleClick={() => onRenameGroup(group.id)}
                title={containsActiveTab
                  ? `${group.name} — contains the active repository; double-click to rename`
                  : `${group.name} — double-click to rename`}
                type="button"
              >
                {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <Folder size={13} />
                <span>{group.name}</span>
                {collapsed ? <b>{group.tabs.length}</b> : null}
              </button>
              {collapsed
                ? null
                : group.tabs.map((tab) => (
                    <RepositoryTabItem
                      active={activeTabId === tab.id}
                      actionsDisabled={actionsDisabled}
                      groupId={group.id}
                      key={tab.id}
                      onClose={onClose}
                      onContextMenu={onTabContextMenu}
                      onSelect={onSelect}
                      tab={tab}
                    />
                  ))}
            </div>
          );
        })}
      </div>
      <div className="gc-tabs__actions">
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
