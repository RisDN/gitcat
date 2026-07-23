import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  FolderGit,
  GitBranch,
  Monitor,
  Plus,
  Search,
  Tag,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

import type { BranchInfo, RefLabel } from "../lib/types";
import { IconButton, Input } from "./Primitives";

export type BranchScope = "local" | "remote";

export interface BranchContextMenuRequest {
  branch: BranchInfo;
  scope: BranchScope;
  clientX: number;
  clientY: number;
}

interface RefSidebarProps {
  localBranches: BranchInfo[];
  remoteBranches: BranchInfo[];
  remoteIconUrls?: ReadonlyMap<string, string>;
  tags: RefLabel[];
  onCheckout: (branch: BranchInfo) => void;
  onCreateBranch: () => void;
  onCheckoutRemote: (branch: BranchInfo) => void;
  onBranchContextMenu: (request: BranchContextMenuRequest) => void;
}

export function RefSidebar({
  localBranches,
  remoteBranches,
  remoteIconUrls,
  tags,
  onCheckout,
  onCreateBranch,
  onCheckoutRemote,
  onBranchContextMenu,
}: RefSidebarProps) {
  const [filter, setFilter] = useState("");
  const [sections, setSections] = useState({ local: true, remote: true, tags: false });
  const needle = filter.trim().toLocaleLowerCase();
  const filteredLocal = useMemo(
    () => localBranches.filter((branch) => branch.name.toLocaleLowerCase().includes(needle)),
    [localBranches, needle],
  );
  const filteredRemote = useMemo(
    () => remoteBranches.filter((branch) => branch.name.toLocaleLowerCase().includes(needle)),
    [remoteBranches, needle],
  );
  const remoteGroups = useMemo(() => {
    const groups = new Map<string, BranchInfo[]>();
    for (const branch of filteredRemote) {
      const remote = remoteNameOf(branch.name);
      const existing = groups.get(remote);
      if (existing) existing.push(branch);
      else groups.set(remote, [branch]);
    }
    return [...groups.entries()];
  }, [filteredRemote]);

  const toggle = (section: keyof typeof sections) =>
    setSections((current) => ({ ...current, [section]: !current[section] }));

  const openBranchMenu = (branch: BranchInfo, scope: BranchScope, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onBranchContextMenu({ branch, scope, clientX: event.clientX, clientY: event.clientY });
  };

  const openBranchMenuFromKeyboard = (
    branch: BranchInfo,
    scope: BranchScope,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    onBranchContextMenu({ branch, scope, clientX: bounds.left + 12, clientY: bounds.bottom - 2 });
  };

  return (
    <aside className="gc-sidebar" aria-label="References">
      <div className="gc-sidebar__filter">
        <Search size={14} />
        <Input
          aria-label="Filter branches"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter branches"
          value={filter}
        />
      </div>

      <RefSection
        count={filteredLocal.length}
        icon={<Monitor size={14} />}
        label="LOCAL"
        onToggle={() => toggle("local")}
        open={sections.local}
        trailing={
          <IconButton aria-label="Create branch" onClick={onCreateBranch} title="Create branch">
            <Plus size={14} />
          </IconButton>
        }
      >
        {filteredLocal.map((branch) => (
          <div
            className={`gc-ref-row gc-ref-row--branch ${branch.is_head ? "gc-ref-row--current" : ""}`}
            key={branch.full_name}
            onContextMenu={(event) => openBranchMenu(branch, "local", event)}
          >
            <button
              onClick={() => onCheckout(branch)}
              onKeyDown={(event) => openBranchMenuFromKeyboard(branch, "local", event)}
              type="button"
            >
              <span className="gc-ref-row__lead">
                {branch.is_head ? <Check aria-label="Current branch" size={12} strokeWidth={3} /> : null}
              </span>
              <GitBranch className="gc-ref-row__icon" size={13} />
              <span>{branch.name}</span>
              {branch.ahead ? <small>↑{branch.ahead}</small> : null}
              {branch.behind ? <small>↓{branch.behind}</small> : null}
            </button>
          </div>
        ))}
        {!filteredLocal.length ? <p className="gc-sidebar__empty">No matching local branch</p> : null}
      </RefSection>

      <RefSection
        count={filteredRemote.length}
        icon={<Cloud size={14} />}
        label="REMOTE"
        onToggle={() => toggle("remote")}
        open={sections.remote}
      >
        {remoteGroups.map(([remote, branches]) => (
          <div className="gc-ref-group" key={remote}>
            <div className="gc-ref-row gc-ref-row--group">
              <span className="gc-ref-row__static">
                <RemoteIcon iconUrl={remoteIconUrls?.get(remote)} />
                {remote}
              </span>
            </div>
            {branches.map((branch) => (
              <div
                className="gc-ref-row gc-ref-row--branch gc-ref-row--nested"
                key={branch.full_name}
                onContextMenu={(event) => openBranchMenu(branch, "remote", event)}
              >
                <button
                  onClick={() => onCheckoutRemote(branch)}
                  onKeyDown={(event) => openBranchMenuFromKeyboard(branch, "remote", event)}
                  type="button"
                >
                  <GitBranch className="gc-ref-row__icon" size={13} />
                  <span>{branchNameWithoutRemote(branch.name)}</span>
                </button>
              </div>
            ))}
          </div>
        ))}
        {!filteredRemote.length ? <p className="gc-sidebar__empty">No matching remote branch</p> : null}
      </RefSection>

      <RefSection
        count={tags.length}
        icon={<Tag size={14} />}
        label="TAGS"
        onToggle={() => toggle("tags")}
        open={sections.tags}
      >
        {tags.map((tag) => (
          <div className="gc-ref-row" key={tag.full_name}>
            <span className="gc-ref-row__static"><span className="gc-ref-row__node gc-ref-row__node--tag" />{tag.name}</span>
          </div>
        ))}
      </RefSection>
    </aside>
  );
}

function RemoteIcon({ iconUrl }: { iconUrl?: string }) {
  const [failed, setFailed] = useState(false);
  if (!iconUrl || failed) return <FolderGit className="gc-ref-row__icon" size={13} />;
  return (
    <img
      alt=""
      aria-hidden="true"
      className="gc-ref-row__avatar"
      onError={() => setFailed(true)}
      src={iconUrl}
    />
  );
}

export function remoteNameOf(branchName: string): string {
  const slashIndex = branchName.indexOf("/");
  return slashIndex >= 0 ? branchName.slice(0, slashIndex) : branchName;
}

export function branchNameWithoutRemote(branchName: string): string {
  const slashIndex = branchName.indexOf("/");
  return slashIndex >= 0 ? branchName.slice(slashIndex + 1) : branchName;
}

function RefSection({
  label,
  count,
  icon,
  open,
  onToggle,
  trailing,
  children,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="gc-ref-section">
      <header>
        <button aria-expanded={open} onClick={onToggle} type="button">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {icon}
          <span>{label}</span>
          <b>{count}</b>
        </button>
        {trailing}
      </header>
      {open ? <div className="gc-ref-section__body">{children}</div> : null}
    </section>
  );
}
