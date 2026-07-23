import { AlertTriangle, Check, ChevronDown, ChevronRight, GitMerge, Trash2, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

import { conflictSideLabels } from "../lib/conflicts";
import type { ConflictResolution, RepositoryOperationState, StatusEntry, WorktreeStatus } from "../lib/types";
import { matchesKeybind } from "../lib/keybinds";
import { ContextMenu, type ContextAction } from "./ContextMenu";
import { FileTree, FileTreeControls } from "./FileTree";
import type { FileTreeItem, FileViewMode } from "./FileTree";
import { Badge, Button, IconButton, Input, TextArea } from "./Primitives";

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
  collapseSignal?: number;
  fileViewMode: FileViewMode;
  onFileViewModeChange: (mode: FileViewMode) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onStashFile: (paths: string[]) => void;
  onIgnore: (patterns: string[]) => void;
  onCreatePatch: (paths: string[], staged: boolean) => void;
  onOpenFolder: (path: string) => void;
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
  description: string;
  amend: boolean;
  signoff: boolean;
}

function buildCommitMessage(draft: CommitDraft): string {
  const summary = draft.message.trim();
  const description = draft.description.trim();
  return description ? `${summary}\n\n${description}` : summary;
}

export function WorktreePanel({
  status,
  busy,
  collapseSignal,
  fileViewMode,
  onFileViewModeChange,
  onStage,
  onUnstage,
  onDiscard,
  onStashFile,
  onIgnore,
  onCreatePatch,
  onOpenFolder,
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

  const [fileMenu, setFileMenu] = useState<{ entry: StatusEntry; staged: boolean; x: number; y: number } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ path: string; entries: StatusEntry[]; staged: boolean; x: number; y: number } | null>(null);

  const openFileMenu = (entry: StatusEntry, staged: boolean, event: ReactMouseEvent) => {
    if (entry.conflicted) return;
    setFolderMenu(null);
    setFileMenu({ entry, staged, x: event.clientX, y: event.clientY });
  };

  const openFolderMenu = (folder: { path: string; items: StatusEntry[] }, staged: boolean, event: ReactMouseEvent) => {
    setFileMenu(null);
    setFolderMenu({
      path: folder.path,
      entries: folder.items.filter((entry) => !entry.conflicted),
      staged,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const fileMenuActions = useMemo<ContextAction[]>(() => {
    if (!fileMenu) return [];
    const base = fileMenu.entry.path.replaceAll("\\", "/");
    const name = base.split("/").at(-1) ?? base;
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot + 1) : "";
    const folder = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
    const ignore: ContextAction[] = [{ id: "ignore-file", label: "Ignore this file" }];
    if (ext) ignore.push({ id: "ignore-ext", label: `Ignore all *.${ext} files` });
    if (folder) ignore.push({ id: "ignore-folder", label: `Ignore ${folder}/ folder` });
    return [
      fileMenu.staged ? { id: "unstage", label: "Unstage" } : { id: "stage", label: "Stage" },
      { id: "discard", label: "Discard changes", danger: true },
      { id: "ignore", label: "Ignore", submenu: ignore },
      { id: "stash", label: "Stash file" },
      { id: "copy", label: "Copy file path", separatorBefore: true },
      { id: "patch", label: "Create patch from file changes" },
    ];
  }, [fileMenu]);

  const executeFileAction = (id: string) => {
    if (!fileMenu) return;
    const { entry, staged } = fileMenu;
    const base = entry.path.replaceAll("\\", "/");
    const name = base.split("/").at(-1) ?? base;
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot + 1) : "";
    const folder = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
    switch (id) {
      case "stage": onStage([entry.path]); break;
      case "unstage": onUnstage([entry.path]); break;
      case "discard": onDiscard([entry.path]); break;
      case "stash": onStashFile([entry.path]); break;
      case "ignore-file": onIgnore([base]); break;
      case "ignore-ext": if (ext) onIgnore([`*.${ext}`]); break;
      case "ignore-folder": if (folder) onIgnore([`${folder}/`]); break;
      case "copy": void navigator.clipboard?.writeText(entry.path); break;
      case "patch": onCreatePatch([entry.path], staged); break;
    }
    setFileMenu(null);
  };

  const folderMenuActions = useMemo<ContextAction[]>(() => {
    if (!folderMenu) return [];
    const empty = !folderMenu.entries.length;
    return [
      folderMenu.staged
        ? { id: "unstage", label: "Unstage folder", disabled: busy || empty }
        : { id: "stage", label: "Stage folder", disabled: busy || empty },
      { id: "discard", label: "Discard all changes in folder", danger: true, disabled: busy || empty },
      { id: "ignore", label: `Ignore all files in '${folderMenu.path}/'`, disabled: busy },
      { id: "stash", label: "Stash folder", disabled: busy || empty },
      { id: "patch", label: "Create Patch from changes in directory", disabled: empty },
      { id: "open", label: "Open folder", separatorBefore: true },
    ];
  }, [busy, folderMenu]);

  const executeFolderAction = (id: string) => {
    if (!folderMenu) return;
    const { entries, path, staged } = folderMenu;
    const paths = entries.map((entry) => entry.path);
    switch (id) {
      case "stage": onStage(paths); break;
      case "unstage": onUnstage(paths); break;
      case "discard": onDiscard(paths); break;
      case "stash": onStashFile(paths); break;
      case "ignore": onIgnore([`${path}/`]); break;
      case "patch": onCreatePatch(paths, staged); break;
      case "open": onOpenFolder(path); break;
    }
    setFolderMenu(null);
  };

  const submit = async () => {
    if (!canCommit) return;
    if (await onCommit(buildCommitMessage(draft), draft.amend, draft.signoff)) {
      onDraftChange({ ...draft, message: "", description: "", amend: false });
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
          <IconButton
            aria-label="Discard all changes"
            className="gc-worktree__discard"
            disabled={busy || !status.entries.length}
            onClick={() => onDiscard(status.entries.map((entry) => entry.path))}
            title="Discard all changes"
          >
            <Trash2 aria-hidden="true" size={15} />
          </IconButton>
          <div className="gc-worktree__summary">
            <strong>{status.clean ? "No file changes" : `${status.entries.length} file change${status.entries.length === 1 ? "" : "s"}`}</strong>
            <small>on</small>
            <Badge tone="accent">{branchName}</Badge>
          </div>
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

      <FileTreeControls mode={fileViewMode} onModeChange={onFileViewModeChange} />

      <StatusSection
        actionLabel="Stage all"
        actionDisabled={!stageable.length}
        branchName={branchName}
        busy={busy}
        collapseSignal={collapseSignal}
        items={unstagedItems}
        label="Unstaged"
        onAction={() => onStage(stageable.map((entry) => entry.path))}
        onEntryAction={(entry) => onStage([entry.path])}
        onItemContextMenu={(entry, event) => openFileMenu(entry, false, event)}
        onFolderContextMenu={(folder, event) => openFolderMenu(folder, false, event)}
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
        actionPriority
        busy={busy}
        collapseSignal={collapseSignal}
        items={stagedItems}
        label="Staged"
        onAction={() => onUnstage(staged.map((entry) => entry.path))}
        onEntryAction={(entry) => onUnstage([entry.path])}
        onItemContextMenu={(entry, event) => openFileMenu(entry, true, event)}
        onFolderContextMenu={(folder, event) => openFolderMenu(folder, true, event)}
        onOpenDiff={(entry) => onOpenDiff(entry, true)}
        onToggle={() => setStagedOpen((open) => !open)}
        open={stagedOpen}
        selectedId={selectedFile?.staged ? selectedFile.path : undefined}
        viewMode={fileViewMode}
      />

      <div className="gc-commit-form">
        <label htmlFor="commit-message">Commit message</label>
        <Input
          className="gc-commit-form__summary"
          disabled={busy}
          id="commit-message"
          onChange={(event) => onDraftChange({ ...draft, message: event.target.value })}
          onKeyDown={(event) => {
            if (matchesKeybind(event.nativeEvent, commitKeybind)) {
              event.preventDefault();
              event.stopPropagation();
              void submit();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              document.getElementById("commit-description")?.focus();
            }
          }}
          placeholder="Summary"
          type="text"
          value={draft.message}
        />
        <TextArea
          disabled={busy}
          id="commit-description"
          onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
          onKeyDown={(event) => {
            if (matchesKeybind(event.nativeEvent, commitKeybind)) {
              event.preventDefault();
              event.stopPropagation();
              void submit();
            }
          }}
          placeholder="Description (optional)"
          rows={4}
          value={draft.description}
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
          {draft.amend ? "Amend commit" : staged.length > 0 ? `Commit Changes to ${staged.length} files` : "Stage Changes to Commit"}
        </Button>
      </div>

      {fileMenu ? createPortal(
        <ContextMenu
          actions={fileMenuActions}
          onAction={executeFileAction}
          onClose={() => setFileMenu(null)}
          x={fileMenu.x}
          y={fileMenu.y}
        />,
        document.body,
      ) : null}

      {folderMenu ? createPortal(
        <ContextMenu
          actions={folderMenuActions}
          onAction={executeFolderAction}
          onClose={() => setFolderMenu(null)}
          x={folderMenu.x}
          y={folderMenu.y}
        />,
        document.body,
      ) : null}
    </aside>
  );
}

function StatusSection({
  label,
  items,
  actionLabel,
  actionDisabled = false,
  actionPriority = false,
  branchName = "current branch",
  busy,
  collapseSignal,
  onAction,
  onEntryAction,
  onItemContextMenu,
  onFolderContextMenu,
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
  actionPriority?: boolean;
  branchName?: string;
  busy: boolean;
  collapseSignal?: number;
  onAction: () => void;
  onEntryAction: (entry: StatusEntry) => void;
  onItemContextMenu?: (entry: StatusEntry, event: ReactMouseEvent) => void;
  onFolderContextMenu?: (folder: { path: string; items: StatusEntry[] }, event: ReactMouseEvent) => void;
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
        {actionDisabled || !items.length ? null : (
          <button className={`gc-status-section__bulk${actionPriority ? " gc-status-section__bulk--priority" : ""}`} disabled={busy} onClick={onAction} type="button">{actionLabel}</button>
        )}
      </header>
      {open ? (
        <FileTree
          ariaLabel={`${label} files`}
          collapseSignal={collapseSignal}
          emptyState={<><Check aria-hidden="true" size={14} /> Nothing here</>}
          items={items}
          mode={viewMode}
          onItemContextMenu={onItemContextMenu}
          onFolderContextMenu={onFolderContextMenu}
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
              <button
                aria-label={`${plus ? "Stage" : "Unstage"} ${entry.path}`}
                className={`gc-file-tree__stage gc-file-tree__stage--${plus ? "add" : "remove"}`}
                disabled={busy}
                onClick={() => onEntryAction(entry)}
                type="button"
              >
                {plus ? "Stage File" : "Unstage File"}
              </button>
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
