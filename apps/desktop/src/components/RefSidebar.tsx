import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  FolderGit,
  GitBranch,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
  Tag,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { BranchInfo, RefLabel } from "../lib/types";
import { IconButton } from "./Primitives";

interface RefSidebarProps {
  localBranches: BranchInfo[];
  remoteBranches: BranchInfo[];
  remoteIconUrls?: ReadonlyMap<string, string>;
  tags: RefLabel[];
  onCheckout: (branch: BranchInfo) => void;
  onCreateBranch: () => void;
  onRenameBranch: (branch: BranchInfo) => void;
  onDeleteBranch: (branch: BranchInfo) => void;
  onCheckoutRemote: (branch: BranchInfo) => void;
}

export function RefSidebar({
  localBranches,
  remoteBranches,
  remoteIconUrls,
  tags,
  onCheckout,
  onCreateBranch,
  onRenameBranch,
  onDeleteBranch,
  onCheckoutRemote,
}: RefSidebarProps) {
  const [filter, setFilter] = useState("");
  const [sections, setSections] = useState({ local: true, remote: true, tags: false });
  const [branchMenu, setBranchMenu] = useState<string | null>(null);
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

  return (
    <aside className="gc-sidebar" aria-label="References">
      <div className="gc-sidebar__filter">
        <Search size={14} />
        <input
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
          <div className={`gc-ref-row gc-ref-row--branch ${branch.is_head ? "gc-ref-row--current" : ""}`} key={branch.full_name}>
            <button onClick={() => onCheckout(branch)} type="button">
              <span className="gc-ref-row__lead">
                {branch.is_head ? <Check aria-label="Current branch" size={12} strokeWidth={3} /> : null}
              </span>
              <GitBranch className="gc-ref-row__icon" size={13} />
              <span>{branch.name}</span>
              {branch.ahead ? <small>↑{branch.ahead}</small> : null}
              {branch.behind ? <small>↓{branch.behind}</small> : null}
            </button>
            <IconButton
              aria-label={`Actions for ${branch.name}`}
              onClick={() => setBranchMenu((current) => (current === branch.full_name ? null : branch.full_name))}
            >
              <MoreHorizontal size={14} />
            </IconButton>
            {branchMenu === branch.full_name ? (
              <div className="gc-ref-menu">
                <button onClick={() => onCheckout(branch)} type="button">Checkout</button>
                <button onClick={() => onRenameBranch(branch)} type="button">Rename…</button>
                <button className="danger" disabled={branch.is_head} onClick={() => onDeleteBranch(branch)} type="button">Delete…</button>
              </div>
            ) : null}
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
              <div className="gc-ref-row gc-ref-row--branch gc-ref-row--nested" key={branch.full_name}>
                <button onClick={() => onCheckoutRemote(branch)} type="button">
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

function remoteNameOf(branchName: string): string {
  const slashIndex = branchName.indexOf("/");
  return slashIndex >= 0 ? branchName.slice(0, slashIndex) : branchName;
}

function branchNameWithoutRemote(branchName: string): string {
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
