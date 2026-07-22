import {
  ArchiveRestore,
  ChevronDown,
  Download,
  GitBranchPlus,
  RefreshCw,
  Search,
  Settings,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PullMode, RepositoryOperationState } from "../lib/types";
import { Button, IconButton, Spinner } from "./Primitives";

const PULL_LABELS: Record<PullMode, string> = {
  merge: "Pull (merge)",
  fast_forward_only: "Pull (fast-forward only)",
  rebase: "Pull (rebase)",
};

interface ToolbarProps {
  repositoryName: string;
  branchName: string;
  operation: RepositoryOperationState;
  busy: boolean;
  pullMode: PullMode;
  onPullModeChange: (mode: PullMode) => void;
  onRefresh: () => void;
  onFetch: () => void;
  onPull: (mode: PullMode) => void;
  onPush: () => void;
  onCreateBranch: () => void;
  onStash: () => void;
  onSearch: () => void;
  onSettings: () => void;
}

export function Toolbar({
  repositoryName,
  branchName,
  operation,
  busy,
  pullMode,
  onPullModeChange,
  onRefresh,
  onFetch,
  onPull,
  onPush,
  onCreateBranch,
  onStash,
  onSearch,
  onSettings,
}: ToolbarProps) {
  const [pullOpen, setPullOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pullOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setPullOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [pullOpen]);

  return (
    <header className="gc-toolbar">
      <div className="gc-repository-switcher">
        <span className="gc-toolbar__caption">repository</span>
        <strong>{repositoryName}</strong>
      </div>
      <span className="gc-toolbar__slash" aria-hidden="true">/</span>
      <div className="gc-repository-switcher">
        <span className="gc-toolbar__caption">branch</span>
        <strong>{branchName}</strong>
      </div>

      <div className="gc-toolbar__actions" aria-label="Repository actions">
        <Button compact disabled={busy} icon={<RefreshCw size={16} />} onClick={onRefresh}>Refresh</Button>
        <Button compact disabled={busy} icon={<Download size={16} />} onClick={onFetch}>Fetch</Button>
        <div className="gc-split-action" ref={menuRef}>
          <Button compact disabled={busy} icon={<Download size={16} />} onClick={() => onPull(pullMode)}>
            Pull
          </Button>
          <IconButton
            aria-expanded={pullOpen}
            aria-haspopup="menu"
            aria-label="Choose pull mode"
            disabled={busy}
            onClick={() => setPullOpen((open) => !open)}
          >
            <ChevronDown size={14} />
          </IconButton>
          {pullOpen ? (
            <div className="gc-pull-menu" role="menu">
              <p>Pull behavior</p>
              {(Object.keys(PULL_LABELS) as PullMode[]).map((mode) => (
                <button
                  aria-checked={pullMode === mode}
                  className={pullMode === mode ? "gc-pull-menu__active" : ""}
                  key={mode}
                  onClick={() => {
                    onPullModeChange(mode);
                    setPullOpen(false);
                  }}
                  role="menuitemradio"
                  type="button"
                >
                  <i aria-hidden="true" />
                  <span>{PULL_LABELS[mode]}</span>
                </button>
              ))}
              <small>Choice overrides global Git pull settings.</small>
            </div>
          ) : null}
        </div>
        <Button compact disabled={busy} icon={<Upload size={16} />} onClick={onPush}>Push</Button>
        <Button compact disabled={busy} icon={<GitBranchPlus size={16} />} onClick={onCreateBranch}>Branch</Button>
        <Button compact disabled={busy} icon={<ArchiveRestore size={16} />} onClick={onStash}>Stash</Button>
      </div>

      <div className="gc-toolbar__tail">
        {operation !== "normal" ? <span className="gc-operation-chip">{operation.replace("_", " ")}</span> : null}
        {busy ? <Spinner label="Repository operation running" /> : null}
        <IconButton aria-label="Search commits" onClick={onSearch} title="Search commits (Ctrl+F)">
          <Search size={18} />
        </IconButton>
        <IconButton aria-label="Settings" onClick={onSettings} title="Settings (Ctrl+,)">
          <Settings size={18} />
        </IconButton>
      </div>
    </header>
  );
}
