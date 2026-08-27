import { useState } from "react";

import type { BranchInfo, CheckSummary, PullRequestInfo, RefLabel } from "../../lib/types";
import { RefRail } from "./RefRail";
import { RefSidebar } from "./RefSidebar";
import type { BranchContextMenuRequest } from "./RefSidebar";
import type { RefSectionKey, RefSectionState } from "./sections";

interface RefPanelProps {
  collapsed: boolean;
  localBranches: BranchInfo[];
  remoteBranches: BranchInfo[];
  remoteIconUrls?: ReadonlyMap<string, string>;
  pullRequests?: ReadonlyMap<string, PullRequestInfo>;
  checks?: ReadonlyMap<string, CheckSummary>;
  tags: RefLabel[];
  toggleKeybind: string;
  onCollapse: () => void;
  onExpand: () => void;
  onCheckout: (branch: BranchInfo) => void;
  onCreateBranch: () => void;
  onCheckoutRemote: (branch: BranchInfo) => void;
  onBranchContextMenu: (request: BranchContextMenuRequest) => void;
  onOpenPullRequest?: (pull: PullRequestInfo) => void;
}

// Owns the expanded/collapsed section state so the rail can expand the panel
// straight into the section whose icon was clicked.
export function RefPanel({ collapsed, onExpand, toggleKeybind, ...sidebar }: RefPanelProps) {
  const [sections, setSections] = useState<RefSectionState>({ local: true, remote: true, tags: false });

  if (collapsed) {
    return (
      <RefRail
        expandKeybind={toggleKeybind}
        localCount={sidebar.localBranches.length}
        onExpand={(section?: RefSectionKey) => {
          if (section) setSections((current) => ({ ...current, [section]: true }));
          onExpand();
        }}
        remoteCount={sidebar.remoteBranches.length}
        tagCount={sidebar.tags.length}
      />
    );
  }

  return (
    <RefSidebar
      {...sidebar}
      collapseKeybind={toggleKeybind}
      onToggleSection={(section) => setSections((current) => ({ ...current, [section]: !current[section] }))}
      sections={sections}
    />
  );
}
