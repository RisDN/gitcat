import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

import type { ConflictResolution, RepositoryOperationState, StatusEntry, WorktreeStatus } from "../../lib/types";
import { ContextMenu, type ContextAction } from "../ContextMenu";
import { FileTreeControls } from "../file-tree";
import type { FileTreeItem, FileViewMode } from "../file-tree";
import { SidePanel } from "../ui";
import { CommitForm } from "./CommitForm";
import type { CommitDraft } from "./CommitForm";
import { StatusSection } from "./StatusSection";
import { WorktreeHeader } from "./WorktreeHeader";

export type { CommitDraft };

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

function buildCommitMessage(draft: CommitDraft): string {
  const summary = draft.message.trim();
  const description = draft.description.trim();
  return description ? `${summary}\n\n${description}` : summary;
}

function toTreeItems(entries: StatusEntry[], side: "index" | "worktree"): FileTreeItem<StatusEntry>[] {
  return entries.map((entry) => {
    const change = entry.conflicted ? "unmerged" : (entry[side] ?? "modified");
    const stats = side === "index" ? entry.index_stats : entry.worktree_stats;
    return {
      id: entry.path,
      path: entry.path,
      data: entry,
      status: change,
      statusLabel: STATUS_LABEL[change] ?? "M",
      additions: stats?.additions ?? null,
      deletions: stats?.deletions ?? null,
    };
  });
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
  const stagedItems = useMemo(() => toTreeItems(staged, "index"), [staged]);
  const unstagedItems = useMemo(() => toTreeItems(unstaged, "worktree"), [unstaged]);

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
    <SidePanel aria-label="Working tree">
      <WorktreeHeader
        branchName={branchName}
        busy={busy}
        changeCount={status.entries.length}
        clean={status.clean}
        conflictCount={conflicts.length}
        onAutoResolveConflicts={onAutoResolveConflicts}
        onDiscardAll={() => onDiscard(status.entries.map((entry) => entry.path))}
        stashCount={status.stash_count}
      />

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

      <CommitForm
        busy={busy}
        canCommit={canCommit}
        commitKeybind={commitKeybind}
        draft={draft}
        onDraftChange={onDraftChange}
        onSubmit={() => void submit()}
        stagedCount={staged.length}
      />

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
    </SidePanel>
  );
}
