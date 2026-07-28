import { orderedFilePaths } from "../components/file-tree";
import type { ChangeKind, FileViewMode, RepositorySnapshot, StatusEntry } from "../lib/types";

export type WorktreeStageAction = "stage" | "unstage";

export function stagedKindFromWorktree(kind: ChangeKind): ChangeKind {
    return kind === "untracked" || kind === "ignored" ? "added" : kind;
}

export function worktreeKindFromIndex(kind: ChangeKind): ChangeKind {
    if (kind === "added" || kind === "copied") return "untracked";
    if (kind === "renamed") return "modified";
    return kind;
}

export function wipChangeKind(entry: StatusEntry): ChangeKind | null {
    if (entry.conflicted) return "unmerged";
    const kinds = [entry.index, entry.worktree].filter((kind): kind is ChangeKind => Boolean(kind));
    if (kinds.includes("deleted")) return "deleted";
    return kinds.find((kind) => kind === "added" || kind === "untracked" || kind === "copied") ?? kinds[0] ?? null;
}

export function matchesStatusPath(entry: StatusEntry, paths: Set<string>): boolean {
    return paths.has(entry.path) || (entry.old_path ? paths.has(entry.old_path) : false);
}

export function compactStatusEntries(entries: StatusEntry[]): StatusEntry[] {
    return entries.filter((entry) => entry.conflicted || entry.index || entry.worktree);
}

export function optimisticWorktreeSnapshot(
    current: RepositorySnapshot,
    action: WorktreeStageAction,
    paths: string[],
): RepositorySnapshot {
    const selected = new Set(paths);
    if (!selected.size) return current;

    const entries = compactStatusEntries(current.status.entries.map((entry) => {
        if (entry.conflicted || !matchesStatusPath(entry, selected)) return entry;

        if (action === "stage") {
            if (!entry.worktree) return entry;
            return {
                ...entry,
                index: stagedKindFromWorktree(entry.worktree),
                worktree: undefined,
            };
        }

        if (!entry.index) return entry;
        return {
            ...entry,
            index: undefined,
            old_path: entry.index === "renamed" ? undefined : entry.old_path,
            worktree: entry.worktree ?? worktreeKindFromIndex(entry.index),
        };
    }));

    return {
        ...current,
        status: {
            ...current.status,
            clean: entries.length === 0,
            entries,
        },
    };
}

export function optimisticWorktreeSelection(
    current: { path: string; staged: boolean } | null,
    action: WorktreeStageAction,
    paths: string[],
): { path: string; staged: boolean } | null {
    if (!current || !paths.includes(current.path)) return current;
    return { ...current, staged: action === "stage" };
}

export function worktreeSectionPaths(entries: StatusEntry[], staged: boolean): string[] {
    return entries
        .filter((entry) => (staged ? Boolean(entry.index) && !entry.conflicted : Boolean(entry.worktree) || entry.conflicted))
        .map((entry) => entry.path);
}

export function nextWorktreeSelection(
    entries: StatusEntry[],
    current: { path: string; staged: boolean },
    action: WorktreeStageAction,
    paths: string[],
    mode: FileViewMode,
): { path: string; staged: boolean } {
    const ordered = orderedFilePaths(worktreeSectionPaths(entries, current.staged), mode);
    const index = ordered.indexOf(current.path);
    const moved = new Set(paths);
    const following = ordered.slice(index + 1).find((path) => !moved.has(path));
    if (following) return { path: following, staged: current.staged };
    const preceding = ordered.slice(0, Math.max(index, 0)).filter((path) => !moved.has(path)).at(-1);
    if (preceding) return { path: preceding, staged: current.staged };
    return { path: current.path, staged: action === "stage" };
}
