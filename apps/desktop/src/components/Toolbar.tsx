import {
  AlertTriangle,
  ArchiveRestore,
  ChevronDown,
  Download,
  GitBranchPlus,
  GitMerge,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { PullMode, RepositoryOperationState } from "../lib/types";
import { Button, IconButton, Spinner } from "./Primitives";

export const PULL_LABELS: Record<PullMode, string> = {
  merge: "Pull (merge)",
  fast_forward_only: "Pull (fast-forward only)",
  rebase: "Pull (rebase)",
};

export interface ConflictIndicator {
  state: "checking" | "clean" | "conflicting" | "active" | "unavailable";
  label: string;
  count?: number;
}

function handleMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  close: () => void,
  restoreFocus: () => void,
) {
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  let next: number | null = null;
  if (event.key === "ArrowDown") next = (current + 1 + items.length) % items.length;
  else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else if (event.key === "Escape") {
    event.preventDefault();
    close();
    requestAnimationFrame(restoreFocus);
    return;
  } else if (event.key === "Tab") {
    close();
    return;
  }
  if (next !== null && items[next]) {
    event.preventDefault();
    items[next].focus();
  }
}

interface ToolbarProps {
  repositoryName: string;
  branchName: string;
  operation: RepositoryOperationState;
  busy: boolean;
  refreshing?: boolean;
  pullMode: PullMode;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  leftPanelKeybind: string;
  rightPanelKeybind: string;
  searchKeybind: string;
  settingsKeybind: string;
  conflictIndicator: ConflictIndicator;
  conflictTarget: string | null;
  conflictTargets: string[];
  onPullModeChange: (mode: PullMode) => void;
  onRefresh: () => void;
  onFetch: () => void;
  onPull: (mode: PullMode) => void;
  onPush: () => void;
  onCreateBranch: () => void;
  onStash: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onConflictIndicator: () => void;
  onConflictTargetChange: (target: string | null) => void;
}

export function Toolbar({
  repositoryName,
  branchName,
  operation,
  busy,
  refreshing = false,
  pullMode,
  leftPanelVisible,
  rightPanelVisible,
  leftPanelKeybind,
  rightPanelKeybind,
  searchKeybind,
  settingsKeybind,
  conflictIndicator,
  conflictTarget,
  conflictTargets,
  onPullModeChange,
  onRefresh,
  onFetch,
  onPull,
  onPush,
  onCreateBranch,
  onStash,
  onSearch,
  onSettings,
  onToggleLeftPanel,
  onToggleRightPanel,
  onConflictIndicator,
  onConflictTargetChange,
}: ToolbarProps) {
  const [pullOpen, setPullOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const conflictMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pullOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setPullOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [pullOpen]);

  useEffect(() => {
    if (!conflictOpen) return;
    const close = (event: MouseEvent) => {
      if (!conflictMenuRef.current?.contains(event.target as Node)) setConflictOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [conflictOpen]);

  useEffect(() => {
    if (!pullOpen && !conflictOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPullOpen(false);
      setConflictOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [conflictOpen, pullOpen]);

  useEffect(() => {
    if (pullOpen) requestAnimationFrame(() => menuRef.current?.querySelector<HTMLDivElement>("[role='menu']")?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
  }, [pullOpen]);

  useEffect(() => {
    if (conflictOpen) requestAnimationFrame(() => conflictMenuRef.current?.querySelector<HTMLDivElement>("[role='menu']")?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
  }, [conflictOpen]);

  return (
    <header className="gc-toolbar">
      <div className="gc-toolbar__context">
        <div className="gc-repository-switcher">
          <span className="gc-toolbar__caption">repository</span>
          <strong>{repositoryName}</strong>
        </div>
        <span className="gc-toolbar__slash" aria-hidden="true">/</span>
        <div className="gc-repository-switcher">
          <span className="gc-toolbar__caption">branch</span>
          <strong>{branchName}</strong>
        </div>
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
            <div
              className="gc-pull-menu"
              onKeyDown={(event) => handleMenuKeyDown(
                event,
                () => setPullOpen(false),
                () => menuRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")?.focus(),
              )}
              role="menu"
            >
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
        {busy || refreshing ? <Spinner label={busy ? "Repository operation running" : "Refreshing repository"} /> : null}
        <div className="gc-conflict-control" ref={conflictMenuRef}>
          <IconButton
            aria-expanded={conflictOpen}
            aria-haspopup="menu"
            aria-label={conflictIndicator.label}
            className={`gc-conflict-indicator gc-conflict-indicator--${conflictIndicator.state}`}
            onClick={() => { setConflictOpen((open) => !open); setPullOpen(false); }}
            title={conflictIndicator.label}
          >
            {conflictIndicator.state === "checking" ? <LoaderCircle aria-hidden="true" className="gc-spin" size={18} /> : null}
            {conflictIndicator.state === "clean" ? <ShieldCheck aria-hidden="true" size={18} /> : null}
            {conflictIndicator.state === "conflicting" || conflictIndicator.state === "active" ? <AlertTriangle aria-hidden="true" size={18} /> : null}
            {conflictIndicator.state === "unavailable" ? <GitMerge aria-hidden="true" size={18} /> : null}
            {conflictIndicator.count ? <b>{conflictIndicator.count}</b> : null}
          </IconButton>
          {conflictOpen ? (
            <div
              className="gc-conflict-menu"
              onKeyDown={(event) => handleMenuKeyDown(
                event,
                () => setConflictOpen(false),
                () => conflictMenuRef.current?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")?.focus(),
              )}
              role="menu"
            >
              <button className={`gc-conflict-menu__status gc-conflict-menu__status--${conflictIndicator.state}`} onClick={() => { onConflictIndicator(); setConflictOpen(false); }} role="menuitem" type="button">
                <strong>{conflictIndicator.label}</strong>
                <small>Show status details</small>
              </button>
              <p>Compare current branch with</p>
              <button
                aria-checked={!conflictTarget}
                onClick={() => { onConflictTargetChange(null); setConflictOpen(false); }}
                role="menuitemradio"
                type="button"
              >
                <i aria-hidden="true" />
                <span>No target</span>
              </button>
              {conflictTargets.map((target) => (
                <button
                  aria-checked={conflictTarget === target}
                  key={target}
                  onClick={() => { onConflictTargetChange(target); setConflictOpen(false); }}
                  role="menuitemradio"
                  type="button"
                >
                  <i aria-hidden="true" />
                  <span>{target}</span>
                </button>
              ))}
              <small>Read-only merge preview. Your worktree and index are not changed.</small>
            </div>
          ) : null}
        </div>
        <IconButton
          aria-label={`${leftPanelVisible ? "Hide" : "Show"} left panel`}
          onClick={onToggleLeftPanel}
          title={`${leftPanelVisible ? "Hide" : "Show"} left panel (${leftPanelKeybind})`}
        >
          {leftPanelVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </IconButton>
        <IconButton
          aria-label={`${rightPanelVisible ? "Hide" : "Show"} commit panel`}
          onClick={onToggleRightPanel}
          title={`${rightPanelVisible ? "Hide" : "Show"} commit panel (${rightPanelKeybind})`}
        >
          {rightPanelVisible ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </IconButton>
        <IconButton aria-label="Search commits" onClick={onSearch} title={`Search commits (${searchKeybind})`}>
          <Search size={18} />
        </IconButton>
        <IconButton aria-label="Settings" onClick={onSettings} title={`Settings (${settingsKeybind})`}>
          <Settings size={18} />
        </IconButton>
      </div>
    </header>
  );
}
