import type { CSSProperties } from "react";

import type { BranchInfo } from "../../lib/types";
import { pathCollator } from "../file-tree/tree";

export interface BranchFolderNode {
  kind: "folder";
  name: string;
  path: string;
  count: number;
  children: BranchTreeNode[];
}

export interface BranchLeafNode {
  kind: "branch";
  name: string;
  branch: BranchInfo;
}

export type BranchTreeNode = BranchFolderNode | BranchLeafNode;

interface MutableBranchFolder {
  name: string;
  path: string;
  folders: Map<string, MutableBranchFolder>;
  branches: BranchInfo[];
}

function compareNames(left: { name: string }, right: { name: string }): number {
  return pathCollator.compare(left.name, right.name);
}

function finalize(folder: MutableBranchFolder): { children: BranchTreeNode[]; count: number } {
  const folderNodes = [...folder.folders.values()]
    .map((child): BranchFolderNode => {
      const finalized = finalize(child);
      return {
        kind: "folder",
        name: child.name,
        path: child.path,
        count: finalized.count,
        children: finalized.children,
      };
    })
    .sort(compareNames);
  const leafNodes = folder.branches
    .map((branch): BranchLeafNode => ({
      kind: "branch",
      name: branch.name.split("/").at(-1) ?? branch.name,
      branch,
    }))
    .sort(compareNames);

  return {
    children: [...folderNodes, ...leafNodes],
    count: leafNodes.length + folderNodes.reduce((total, child) => total + child.count, 0),
  };
}

// Slashes in a branch name become folders, so `feat/diff-view-modes` nests the
// same way remote branches nest under their remote.
export function buildBranchTree(
  branches: readonly BranchInfo[],
  stripSegments = 0,
): BranchTreeNode[] {
  const root: MutableBranchFolder = { name: "", path: "", folders: new Map(), branches: [] };

  for (const branch of branches) {
    const segments = branch.name.split("/").filter(Boolean).slice(stripSegments);
    if (!segments.length) continue;

    let current = root;
    const folderPath: string[] = [];
    for (const segment of segments.slice(0, -1)) {
      folderPath.push(segment);
      let child = current.folders.get(segment);
      if (!child) {
        child = { name: segment, path: folderPath.join("/"), folders: new Map(), branches: [] };
        current.folders.set(segment, child);
      }
      current = child;
    }
    current.branches.push(branch);
  }

  return finalize(root).children;
}

export function branchIndent(depth: number): CSSProperties {
  return { "--gc-ref-depth": depth } as CSSProperties;
}
