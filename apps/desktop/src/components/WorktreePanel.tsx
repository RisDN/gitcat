import { AlertTriangle, Check, ChevronDown, ChevronRight, GitMerge, Minus, Plus, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { conflictSideLabels } from "../lib/conflicts";
import type { ConflictResolution, RepositoryOperationState, StatusEntry, WorktreeStatus } from "../lib/types";
import { matchesKeybind } from "../lib/keybinds";
import { ContextMenu, type ContextAction } from "./ContextMenu";
import { FileTree, FileTreeControls } from "./FileTree";
import type { FileTreeItem, FileViewMode } from "./FileTree";
import { Badge, Button, IconButton } from "./Primitives";

const STATUS_LABEL: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  type_changed: "T",
  unmerged: "U",
  untracked: "?",
  ignored: "!",
};

interface WorktreePanelProps {
  status: WorktreeStatus;
  busy: boolean;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onOpenDiff: (entry: StatusEntry, staged: boolean) => void;
  onCommit: (message: string, amend: boolean, signoff: boolean) => Promise<boolean>;
  onResolveConflict: (entry: StatusEntry, resolution: ConflictResolution) => void;
  onOpenConflict: (entry: StatusEntry) => void;
  onAutoResolveConflicts: () => void;
  commitKeybind?: string;
  selectedFile?: { path: string; staged: boolean } | null;
  operation: RepositoryOperationState;
  branchName: string;
  draft: CommitDraft;
  onDraftChange: (draft: CommitDraft) => void;
}

export interface CommitDraft {
  message: string;
  amend: boolean;
  signoff: boolean;
}

export function WorktreePanel({
  status,
  busy,
  onStage,
  onUnstage,
  onOpenDiff,
  onCommit,
  onResolveConflict,
  onOpenConflict,
  onAutoResolveConflicts,
  commitKeybind = "Ctrl+Enter",
  selectedFile,
  operation,
  branchName,
  draft,
  onDraftChange,
}: WorktreePanelProps) {
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>("path");
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [stagedOpen, setStagedOpen] = useState(true);
  const staged = useMemo(() => status.entries.filter((entry) => entry.index && !entry.conflicted), [status.entries]);
  const unstaged = useMemo(() => status.entries.filter((entry) => entry.worktree || entry.conflicted), [status.entries]);
  const stageable = useMemo(() => unstaged.filter((entry) => !entry.conflicted), [unstaged]);
  const conflicts = useMemo(() => status.entries.filter((entry) => entry.conflicted), [status.entries]);
  const canCommit = operation === "normal"
    && !busy
    && Boolean(draft.message.trim())
    && Boolean(staged.length || draft.amend)
    && !conflicts.length;
  const stagedItems = useMemo<FileTreeItem<StatusEntry>[]>(() => staged.map((entry) => {
    const change = entry.conflicted ? "unmerged" : (entry.index ?? "modified");
    return {
      id: entry.path,
      path: entry.path,
      data: entry,
      status: change,
      statusLabel: STATUS_LABEL[change] ?? "M",
    };
  }), [staged]);
  const unstagedItems = useMemo<FileTreeItem<StatusEntry>[]>(() => unstaged.map((entry) => {
    const change = entry.conflicted ? "unmerged" : (entry.worktree ?? "modified");
    return {
      id: entry.path,
      path: entry.path,
      data: entry,
      status: change,
      statusLabel: STATUS_LABEL[change] ?? "M",
    };
  }), [unstaged]);

  const submit = async () => {
    if (!canCommit) return;
    if (await onCommit(draft.message, draft.amend, draft.signoff)) {
      onDraftChange({ ...draft, message: "", amend: false });
    }
  };

  useEffect(() => {
    const submitFromKeybind = () => { void submit(); };
    window.addEventListener("gitcat:commit", submitFromKeybind);
    return () => window.removeEventListener("gitcat:commit", submitFromKeybind);
  });

  return (
    <aside className="gc-worktree" aria-label="Working tree">
      <header className="gc-worktree__header">
        <div>
          <span className="gc-wip-node" />
          <div><strong>Working tree</strong><small>{status.clean ? "Clean" : `${status.entries.length} changed`}</small></div>
        </div>
        <span className="gc-worktree__header-actions">
          {conflicts.length ? (
            <>
              <Badge tone="danger"><AlertTriangle size={11} /> {conflicts.length} conflicts</Badge>
              <Button
                compact
                disabled={busy}
                icon={<WandSparkles size={13} />}
                onClick={onAutoResolveConflicts}
                title="Reuse exact conflict resolutions previously recorded by Git rerere"
              >
                Auto-resolve
              </Button>
            </>
          ) : status.stash_count ? <Badge tone="muted">{status.stash_count} stashed</Badge> : null}
        </span>
      </header>

      <FileTreeControls mode={fileViewMode} onModeChange={setFileViewMode} />

      <StatusSection
        actionLabel="Stage all"
        actionDisabled={!stageable.length}
        branchName={branchName}
        busy={busy}
        items={unstagedItems}
        label="Unstaged"
        onAction={() => onStage(stageable.map((entry) => entry.path))}
        onEntryAction={(entry) => onStage([entry.path])}
        onOpenDiff={(entry) => onOpenDiff(entry, false)}
        onResolveConflict={onResolveConflict}
        onOpenConflict={onOpenConflict}
        onToggle={() => setUnstagedOpen((open) => !open)}
        open={unstagedOpen}
        operation={operation}
        plus
        selectedId={selectedFile && !selectedFile.staged ? selectedFile.path : undefined}
        viewMode={fileViewMode}
      />
      <StatusSection
        actionLabel="Unstage all"
        busy={busy}
        items={stagedItems}
        label="Staged"
        onAction={() => onUnstage(staged.map((entry) => entry.path))}
        onEntryAction={(entry) => onUnstage([entry.path])}
        onOpenDiff={(entry) => onOpenDiff(entry, true)}
        onToggle={() => setStagedOpen((open) => !open)}
        open={stagedOpen}
        selectedId={selectedFile?.staged ? selectedFile.path : undefined}
        viewMode={fileViewMode}
      />

      <div className="gc-commit-form">
        <label htmlFor="commit-message">Commit message</label>
        <textarea
          disabled={busy}
          id="commit-message"
          onChange={(event) => onDraftChange({ ...draft, message: event.target.value })}
          onKeyDown={(event) => {
            if (matchesKeybind(event.nativeEvent, commitKeybind)) {
              event.preventDefault();
              event.stopPropagation();
              void submit();
            }
          }}
          placeholder={"Summary\n\nOptional description"}
          rows={5}
          value={draft.message}
        />
        <div className="gc-commit-form__options">
          <label><input checked={draft.amend} disabled={busy} onChange={(event) => onDraftChange({ ...draft, amend: event.target.checked })} type="checkbox" /> Amend</label>
          <label><input checked={draft.signoff} disabled={busy} onChange={(event) => onDraftChange({ ...draft, signoff: event.target.checked })} type="checkbox" /> Sign off</label>
        </div>
        <Button
          disabled={!canCommit}
          onClick={() => void submit()}
          tone="accent"
        >
          {draft.amend ? "Amend commit" : `Commit ${staged.length || ""}`}
        </Button>
      </div>
    </aside>
  );
}

function StatusSection({
  label,
  items,
  actionLabel,
  actionDisabled = false,
  branchName = "current branch",
  busy,
  onAction,
  onEntryAction,
  onOpenDiff,
  onResolveConflict,
  onOpenConflict,
  onToggle,
  open,
  operation = "normal",
  plus = false,
  selectedId,
  viewMode,
}: {
  label: string;
  items: FileTreeItem<StatusEntry>[];
  actionLabel: string;
  actionDisabled?: boolean;
  branchName?: string;
  busy: boolean;
  onAction: () => void;
  onEntryAction: (entry: StatusEntry) => void;
  onOpenDiff: (entry: StatusEntry) => void;
  onResolveConflict?: (entry: StatusEntry, resolution: ConflictResolution) => void;
  onOpenConflict?: (entry: StatusEntry) => void;
  onToggle: () => void;
  open: boolean;
  operation?: RepositoryOperationState;
  plus?: boolean;
  selectedId?: string;
  viewMode: FileViewMode;
}) {
  return (
    <section className={`gc-status-section${open ? " gc-status-section--open" : ""}`}>
      <header>
        <button aria-expanded={open} className="gc-status-section__toggle" onClick={onToggle} type="button">
          {open ? <ChevronDown aria-hidden="true" size={13} /> : <ChevronRight aria-hidden="true" size={13} />}
          <span>{label} <b>{items.length}</b></span>
        </button>
        <button className="gc-status-section__bulk" disabled={busy || actionDisabled || !items.length} onClick={onAction} type="button">{actionLabel}</button>
      </header>
      {open ? (
        <FileTree
          ariaLabel={`${label} files`}
          emptyState={<><Check aria-hidden="true" size={14} /> Nothing here</>}
          items={items}
          mode={viewMode}
          onSelect={onOpenDiff}
          renderAction={(entry) => (
            entry.conflicted && onResolveConflict ? (
              <ConflictQuickActions
                branchName={branchName}
                busy={busy}
                entry={entry}
                onOpen={() => onOpenConflict?.(entry)}
                onResolve={onResolveConflict}
                operation={operation}
              />
            ) : (
              <IconButton
                aria-label={`${plus ? "Stage" : "Unstage"} ${entry.path}`}
                disabled={busy}
                onClick={() => onEntryAction(entry)}
              >
                {plus ? <Plus aria-hidden="true" size={14} /> : <Minus aria-hidden="true" size={14} />}
              </IconButton>
            )
          )}
          selectedId={selectedId}
        />
      ) : null}
    </section>
  );
}

function ConflictQuickActions({
  branchName,
  busy,
  entry,
  onOpen,
  onResolve,
  operation,
}: {
  branchName: string;
  busy: boolean;
  entry: StatusEntry;
  onOpen: () => void;
  onResolve: (entry: StatusEntry, resolution: ConflictResolution) => void;
  operation: RepositoryOperationState;
}) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const resolve = (resolution: ConflictResolution) => {
    setMenuPosition(null);
    onResolve(entry, resolution);
  };
  const labels = conflictSideLabels(operation, branchName);
  const actions: ContextAction[] = [
    { id: "open_editor", label: "Open merge editor…" },
    { id: "ours", label: `Take ${labels.ours}`, separatorBefore: true },
    { id: "theirs", label: `Take ${labels.theirs}` },
    { id: "delete", label: "Delete file", danger: true },
    { id: "mark_resolved", label: "Mark current working copy resolved", separatorBefore: true },
  ];

  return (
    <span className="gc-conflict-quick">
      <IconButton
        aria-expanded={Boolean(menuPosition)}
        aria-haspopup="menu"
        aria-label={`Resolve conflict in ${entry.path}`}
        disabled={busy}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setMenuPosition((current) => current ? null : { x: bounds.right - 244, y: bounds.bottom + 3 });
        }}
        title="Resolve conflict"
      >
        <GitMerge aria-hidden="true" size={14} />
      </IconButton>
      {menuPosition ? createPortal(
        <ContextMenu
          actions={actions}
          onAction={(action) => {
            if (action === "open_editor") {
              setMenuPosition(null);
              onOpen();
            } else resolve(action as ConflictResolution);
          }}
          onClose={() => setMenuPosition(null)}
          x={menuPosition.x}
          y={menuPosition.y}
        />,
        document.body,
      ) : null}
    </span>
  );
}
