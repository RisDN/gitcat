import { ChevronDown, ChevronRight, Folder, FolderPlus, Plus, X } from "lucide-react";

import { IconButton } from "./Primitives";

export interface TabView {
  id: string;
  label: string;
  path: string;
  dirty?: boolean;
  unavailable?: boolean;
}

export interface TabGroupView {
  id: string;
  name: string;
  collapsed: boolean;
  tabs: TabView[];
}

interface TopTabsProps {
  groups: TabGroupView[];
  activeTabId?: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOpen: () => void;
  onCreateGroup: () => void;
  onToggleGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string) => void;
  onMoveTab: (tabId: string, groupId: string) => void;
}

export function TopTabs({
  groups,
  activeTabId,
  onSelect,
  onClose,
  onOpen,
  onCreateGroup,
  onToggleGroup,
  onRenameGroup,
  onMoveTab,
}: TopTabsProps) {
  return (
    <div className="gc-tabs" role="tablist" aria-label="Repositories">
      <div className="gc-brand" aria-label="GitCat">
        <span className="gc-brand__mark">GC</span>
        <span className="gc-brand__name">GitCat</span>
      </div>
      <div className="gc-tabs__scroll">
        {groups.map((group) => (
          <div
            className={`gc-tab-group ${group.collapsed ? "gc-tab-group--collapsed" : ""}`}
            key={group.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const tabId = event.dataTransfer.getData("text/gitcat-tab");
              if (tabId) onMoveTab(tabId, group.id);
            }}
          >
            <button
              className="gc-tab-group__label"
              onClick={() => onToggleGroup(group.id)}
              onDoubleClick={() => onRenameGroup(group.id)}
              title={`${group.name} — double-click to rename`}
              type="button"
            >
              {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <Folder size={13} />
              <span>{group.name}</span>
              {group.collapsed ? <b>{group.tabs.length}</b> : null}
            </button>
            {group.collapsed
              ? null
              : group.tabs.map((tab) => (
                  <div
                    aria-selected={activeTabId === tab.id}
                    className={`gc-tab ${activeTabId === tab.id ? "gc-tab--active" : ""} ${tab.unavailable ? "gc-tab--unavailable" : ""}`}
                    draggable
                    key={tab.id}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/gitcat-tab", tab.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    role="tab"
                  >
                    <button className="gc-tab__main" onClick={() => onSelect(tab.id)} type="button">
                      <span className="gc-tab__branch" aria-hidden="true" />
                      <span className="gc-tab__label">{tab.label}</span>
                      {tab.dirty ? <span className="gc-tab__dirty" title="Uncommitted changes" /> : null}
                    </button>
                    <IconButton aria-label={`Close ${tab.label}`} onClick={() => onClose(tab.id)}>
                      <X size={13} />
                    </IconButton>
                  </div>
                ))}
          </div>
        ))}
      </div>
      <div className="gc-tabs__actions">
        <IconButton aria-label="New repository group" onClick={onCreateGroup} title="New group">
          <FolderPlus size={16} />
        </IconButton>
        <IconButton aria-label="Open repository" onClick={onOpen} title="Open repository">
          <Plus size={18} />
        </IconButton>
      </div>
    </div>
  );
}
