import { Check, Cloud, GitBranch, Monitor, Plus, Search, Tag } from "lucide-react";
import { useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

import { cx } from "../../lib";
import type { BranchInfo, RefLabel } from "../../lib/types";
import { IconButton, Input, SidePanel } from "../ui";
import { RefButton, RefCounter, RefName, RefRow, RefStatic, RemoteIcon, TagNode } from "./RefRow";
import { RefSection, SidebarEmpty } from "./RefSection";

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

export function remoteNameOf(branchName: string): string {
  const slashIndex = branchName.indexOf("/");
  return slashIndex >= 0 ? branchName.slice(0, slashIndex) : branchName;
}

export function branchNameWithoutRemote(branchName: string): string {
  const slashIndex = branchName.indexOf("/");
  return slashIndex >= 0 ? branchName.slice(slashIndex + 1) : branchName;
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
    <SidePanel className="overflow-x-hidden" aria-label="References">
      <div className="m-2.25 flex h-9.75 flex-[0_0_39px] items-center gap-2 rounded-[5px] border border-border bg-background px-2.25 text-muted focus-within:border-accent focus-within:text-accent">
        <Search size={14} />
        <Input
          aria-label="Filter branches"
          className="min-w-0 flex-1 border-0 bg-transparent outline-0 placeholder:text-muted"
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
          <RefRow
            current={branch.is_head}
            key={branch.full_name}
            onContextMenu={(event) => openBranchMenu(branch, "local", event)}
          >
            <RefButton
              className="gap-1.5 pl-1.5"
              onClick={() => onCheckout(branch)}
              onKeyDown={(event) => openBranchMenuFromKeyboard(branch, "local", event)}
            >
              <span className="inline-flex w-3.25 shrink-0 items-center justify-center text-success">
                {branch.is_head ? <Check aria-label="Current branch" size={12} strokeWidth={3} /> : null}
              </span>
              <GitBranch
                className={cx(
                  "shrink-0",
                  branch.is_head
                    ? "text-[color-mix(in_srgb,var(--gc-success)_70%,var(--gc-text))]"
                    : "text-muted",
                )}
                size={13}
              />
              <RefName>{branch.name}</RefName>
              {branch.ahead ? <RefCounter>{`↑${branch.ahead}`}</RefCounter> : null}
              {branch.behind ? <RefCounter>{`↓${branch.behind}`}</RefCounter> : null}
            </RefButton>
          </RefRow>
        ))}
        {!filteredLocal.length ? <SidebarEmpty>No matching local branch</SidebarEmpty> : null}
      </RefSection>

      <RefSection
        count={filteredRemote.length}
        icon={<Cloud size={14} />}
        label="REMOTE"
        onToggle={() => toggle("remote")}
        open={sections.remote}
      >
        {remoteGroups.map(([remote, branches]) => (
          <div className="mt-1 first:mt-0" key={remote}>
            <RefRow hoverable={false}>
              <RefStatic className="gap-1.5 pl-1.5 text-[color-mix(in_srgb,var(--gc-text)_88%,var(--gc-muted))]">
                <RemoteIcon iconUrl={remoteIconUrls?.get(remote)} />
                {remote}
              </RefStatic>
            </RefRow>
            {branches.map((branch) => (
              <RefRow
                key={branch.full_name}
                onContextMenu={(event) => openBranchMenu(branch, "remote", event)}
              >
                <RefButton
                  className="gap-1.5 pl-6"
                  onClick={() => onCheckoutRemote(branch)}
                  onKeyDown={(event) => openBranchMenuFromKeyboard(branch, "remote", event)}
                >
                  <GitBranch className="shrink-0 text-muted" size={13} />
                  <RefName>{branchNameWithoutRemote(branch.name)}</RefName>
                </RefButton>
              </RefRow>
            ))}
          </div>
        ))}
        {!filteredRemote.length ? <SidebarEmpty>No matching remote branch</SidebarEmpty> : null}
      </RefSection>

      <RefSection
        count={tags.length}
        icon={<Tag size={14} />}
        label="TAGS"
        onToggle={() => toggle("tags")}
        open={sections.tags}
      >
        {tags.map((tag) => (
          <RefRow key={tag.full_name}>
            <RefStatic className="gap-2 pl-4.5">
              <TagNode />
              {tag.name}
            </RefStatic>
          </RefRow>
        ))}
      </RefSection>
    </SidePanel>
  );
}
