import {
  ArrowDownAZ,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  FileType,
  Folder,
  FolderTree,
  List,
  Minus,
  Pencil,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import type { FileViewMode } from "../lib/types";

export type { FileViewMode };

export interface FileTreeItem<T> {
  id: string;
  path: string;
  data: T;
  status: string;
  statusLabel: string;
  binary?: boolean;
  additions?: number | null;
  deletions?: number | null;
}

interface FileTreeProps<T> {
  ariaLabel: string;
  collapseSignal?: number;
  emptyState: ReactNode;
  items: readonly FileTreeItem<T>[];
  mode: FileViewMode;
  onSelect: (item: T) => void;
  onItemContextMenu?: (item: T, event: ReactMouseEvent) => void;
  renderAction?: (item: T) => ReactNode;
  selectedId?: string;
}

interface MutableFolder<T> {
  name: string;
  path: string;
  folders: Map<string, MutableFolder<T>>;
  files: FileTreeItem<T>[];
}

interface FolderNode<T> {
  kind: "folder";
  name: string;
  path: string;
  count: number;
  children: TreeNode<T>[];
}

interface FileNode<T> {
  kind: "file";
  name: string;
  item: FileTreeItem<T>;
}

type TreeNode<T> = FolderNode<T> | FileNode<T>;

const pathCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const STATUS_ICON: Record<string, LucideIcon> = {
  added: Plus,
  untracked: Plus,
  modified: Pencil,
  deleted: Minus,
  renamed: ArrowRight,
  copied: Copy,
  type_changed: FileType,
  unmerged: TriangleAlert,
};

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function compareNames(left: { name: string }, right: { name: string }): number {
  return pathCollator.compare(left.name, right.name);
}

function finalizeFolder<T>(folder: MutableFolder<T>): { children: TreeNode<T>[]; count: number } {
  const folderNodes = [...folder.folders.values()]
    .map((child): FolderNode<T> => {
      const finalized = finalizeFolder(child);
      return {
        kind: "folder",
        name: child.name,
        path: child.path,
        count: finalized.count,
        children: finalized.children,
      };
    })
    .sort(compareNames);
  const fileNodes = [...folder.files]
    .sort((left, right) => pathCollator.compare(normalizePath(left.path), normalizePath(right.path)))
    .map((item): FileNode<T> => ({
      kind: "file",
      name: normalizePath(item.path).split("/").at(-1) ?? item.path,
      item,
    }));

  return {
    children: [...folderNodes, ...fileNodes],
    count: fileNodes.length + folderNodes.reduce((total, child) => total + child.count, 0),
  };
}

function buildTree<T>(items: readonly FileTreeItem<T>[]): TreeNode<T>[] {
  const root: MutableFolder<T> = {
    name: "",
    path: "",
    folders: new Map(),
    files: [],
  };

  for (const item of items) {
    const segments = normalizePath(item.path).split("/").filter(Boolean);
    if (!segments.length) continue;

    let current = root;
    const folderPath: string[] = [];
    for (const segment of segments.slice(0, -1)) {
      folderPath.push(segment);
      let child = current.folders.get(segment);
      if (!child) {
        child = {
          name: segment,
          path: folderPath.join("/"),
          folders: new Map(),
          files: [],
        };
        current.folders.set(segment, child);
      }
      current = child;
    }
    current.files.push(item);
  }

  return finalizeFolder(root).children;
}

function collectFolderPaths<T>(nodes: readonly TreeNode<T>[], paths: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    paths.push(node.path);
    collectFolderPaths(node.children, paths);
  }
  return paths;
}

function treeIndent(depth: number): CSSProperties {
  return { "--gc-tree-depth": depth } as CSSProperties;
}

export function FileTreeControls({
  mode,
  onModeChange,
}: {
  mode: FileViewMode;
  onModeChange: (mode: FileViewMode) => void;
}) {
  return (
    <div className="gc-file-view-controls">
      <span aria-label="Files sorted alphabetically" className="gc-file-view-controls__sort" title="Sorted A–Z">
        <ArrowDownAZ aria-hidden="true" size={15} />
      </span>
      <div aria-label="File list layout" className="gc-file-view-switch" role="group">
        <button
          aria-pressed={mode === "path"}
          className={mode === "path" ? "gc-file-view-switch__active" : ""}
          onClick={() => onModeChange("path")}
          type="button"
        >
          <List aria-hidden="true" size={13} />
          Path
        </button>
        <button
          aria-pressed={mode === "tree"}
          className={mode === "tree" ? "gc-file-view-switch__active" : ""}
          onClick={() => onModeChange("tree")}
          type="button"
        >
          <FolderTree aria-hidden="true" size={13} />
          Tree
        </button>
      </div>
    </div>
  );
}

export function FileTree<T>({
  ariaLabel,
  collapseSignal = 0,
  emptyState,
  items,
  mode,
  onSelect,
  onItemContextMenu,
  renderAction,
  selectedId,
}: FileTreeProps<T>) {
  const sortedItems = useMemo(
    () => [...items].sort((left, right) => pathCollator.compare(normalizePath(left.path), normalizePath(right.path))),
    [items],
  );
  const tree = useMemo(() => buildTree(items), [items]);
  const folderPaths = useMemo(() => collectFolderPaths(tree), [tree]);
  const [folderExpansion, setFolderExpansion] = useState<Map<string, boolean>>(() => new Map());
  const [defaultExpanded, setDefaultExpanded] = useState<boolean | null>(null);
  const isFolderExpanded = (path: string) => (
    folderExpansion.get(path) ?? defaultExpanded ?? normalizePath(path).split("/").length <= 3
  );
  const allExpanded = folderPaths.every(isFolderExpanded);
  const collapseSignalRef = useRef(collapseSignal);
  const skipSelectionExpandRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (collapseSignalRef.current === collapseSignal) return;
    collapseSignalRef.current = collapseSignal;
    skipSelectionExpandRef.current = selectedId;
    setFolderExpansion(new Map());
    setDefaultExpanded(false);
  }, [collapseSignal, selectedId]);

  useEffect(() => {
    if (mode !== "tree" || !selectedId) return;
    if (skipSelectionExpandRef.current === selectedId) return;
    const selected = items.find((item) => item.id === selectedId);
    if (!selected) return;
    const segments = normalizePath(selected.path).split("/").slice(0, -1);
    const ancestors = segments.map((_, index) => segments.slice(0, index + 1).join("/"));
    setFolderExpansion((current) => {
      if (ancestors.every((path) => current.get(path) === true)) return current;
      const next = new Map(current);
      ancestors.forEach((path) => next.set(path, true));
      return next;
    });
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.gc-file-tree__row--selected[data-file-tree-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }, [items, mode, selectedId]);

  const toggleFolder = (path: string) => {
    const expanded = isFolderExpanded(path);
    setFolderExpansion((current) => {
      const next = new Map(current);
      next.set(path, !expanded);
      return next;
    });
  };

  const toggleAll = () => {
    setFolderExpansion(new Map());
    setDefaultExpanded(!allExpanded);
  };

  const renderFile = (item: FileTreeItem<T>, label: string, depth: number) => {
    const StatusIcon = STATUS_ICON[item.status] ?? Pencil;
    return (
    <div
      className={`gc-file-tree__row${selectedId === item.id ? " gc-file-tree__row--selected" : ""}`}
      data-file-tree-id={item.id}
      key={item.id}
      onContextMenu={onItemContextMenu ? (event) => { event.preventDefault(); onItemContextMenu(item.data, event); } : undefined}
      role="listitem"
    >
      <button
        aria-current={selectedId === item.id ? "true" : undefined}
        className="gc-file-tree__file"
        onClick={() => onSelect(item.data)}
        style={treeIndent(depth)}
        title={item.path}
        type="button"
      >
        <b
          aria-label={item.statusLabel}
          className={`gc-file-status gc-file-status--${item.status}`}
          title={item.statusLabel}
        >
          <StatusIcon aria-hidden="true" size={12} strokeWidth={2.6} />
        </b>
        <span className="gc-file-tree__name">{label}</span>
        {item.additions ? <small className="gc-file-tree__additions">+{item.additions}</small> : null}
        {item.deletions ? <small className="gc-file-tree__deletions">−{item.deletions}</small> : null}
        {item.binary ? <small className="gc-file-tree__binary">binary</small> : null}
      </button>
      {renderAction ? <span className="gc-file-tree__action">{renderAction(item.data)}</span> : null}
    </div>
    );
  };

  const renderNodes = (nodes: readonly TreeNode<T>[], depth: number): ReactNode => nodes.map((node) => {
    if (node.kind === "file") return renderFile(node.item, node.name, depth);

    const expanded = isFolderExpanded(node.path);
    return (
      <div className="gc-file-tree__branch" key={node.path} role="listitem">
        <button
          aria-expanded={expanded}
          className="gc-file-tree__folder"
          onClick={() => toggleFolder(node.path)}
          style={treeIndent(depth)}
          title={node.path}
          type="button"
        >
          {expanded ? <ChevronDown aria-hidden="true" size={13} /> : <ChevronRight aria-hidden="true" size={13} />}
          <Folder aria-hidden="true" size={14} />
          <span>{node.name}</span>
          <small>{node.count}</small>
        </button>
        {expanded ? <div role="list" style={treeIndent(depth)}>{renderNodes(node.children, depth + 1)}</div> : null}
      </div>
    );
  });

  if (!items.length) {
    return <div className="gc-file-tree__empty">{emptyState}</div>;
  }

  return (
    <div className={`gc-file-tree gc-file-tree--${mode}`}>
      {mode === "tree" && folderPaths.length ? (
        <button className="gc-file-tree__expand" onClick={toggleAll} type="button">
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      ) : null}
      <div aria-label={ariaLabel} className="gc-file-tree__items" role="list">
        {mode === "tree"
          ? renderNodes(tree, 0)
          : sortedItems.map((item) => renderFile(item, normalizePath(item.path), 0))}
      </div>
    </div>
  );
}
