import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

import { gitcatApi } from "../lib/api";
import type {
    ConflictFileDetails,
    ConflictLineEndingPolicy,
    ConflictResolution,
    RepositorySnapshot,
    StatusEntry,
} from "../lib/types";
import type { CenterView, RunMutation, RuntimeRepository } from "./state";

export interface ConflictActionsParams {
    activeRepository: RuntimeRepository | undefined;
    activeRepositoryIdRef: RefObject<string | null>;
    busy: boolean;
    conflictEditor: ConflictFileDetails | null;
    runMutation: RunMutation;
    setBusy: Dispatch<SetStateAction<boolean>>;
    setCenterView: Dispatch<SetStateAction<CenterView>>;
    setConflictEditor: Dispatch<SetStateAction<ConflictFileDetails | null>>;
    setSelectedWorktreeFile: Dispatch<SetStateAction<{ path: string; staged: boolean } | null>>;
    showError: (title: string, error: unknown) => void;
    snapshot: RepositorySnapshot | null;
}

export function useConflictActions({
    activeRepository,
    activeRepositoryIdRef,
    busy,
    conflictEditor,
    runMutation,
    setBusy,
    setCenterView,
    setConflictEditor,
    setSelectedWorktreeFile,
    showError,
    snapshot,
}: ConflictActionsParams) {
    const openConflictEditor = useCallback(async (entry: StatusEntry) => {
        if (!activeRepository || busy) return;
        const repositoryId = activeRepository.repository_id;
        setBusy(true);
        try {
            const next = await gitcatApi.conflictDetails(repositoryId, entry.path);
            if (activeRepositoryIdRef.current !== repositoryId) return;
            setConflictEditor(next);
            setSelectedWorktreeFile({ path: entry.path, staged: false });
            setCenterView("merge");
        } catch (error) {
            if (activeRepositoryIdRef.current === repositoryId) showError("Conflict editor could not be opened", error);
        } finally {
            setBusy(false);
        }
    }, [activeRepository, busy, showError]);

    const closeConflictEditor = useCallback(() => {
        setConflictEditor(null);
        setSelectedWorktreeFile(null);
        setCenterView("graph");
    }, []);

    // The backend refuses the write when the conflict or the working copy moved
    // under the editor, so a stale composition never silently overwrites one.
    const saveConflictResult = useCallback((text: string, lineEnding: ConflictLineEndingPolicy) => {
        const current = conflictEditor;
        if (!current) return;
        void runMutation("Conflict result saved", (repository) => gitcatApi.saveConflictResult(
            repository.repository_id,
            current.path,
            text,
            lineEnding,
            current.expected_state,
        )).then((success) => { if (success) closeConflictEditor(); });
    }, [closeConflictEditor, conflictEditor, runMutation]);

    // Resolving the file from anywhere else -- the sidebar menu, an external
    // tool, `git add` in a terminal -- leaves the editor showing a conflict that
    // no longer exists.
    useEffect(() => {
        if (!conflictEditor || !snapshot) return;
        const entry = snapshot.status.entries.find((item) => item.path === conflictEditor.path);
        if (!entry?.conflicted) closeConflictEditor();
    }, [closeConflictEditor, conflictEditor, snapshot]);

    const resolveConflictEntry = useCallback((entry: StatusEntry, resolution: ConflictResolution) => {
        if (resolution === "delete" && !window.confirm(`Delete '${entry.path}' as the conflict resolution?`)) return;
        void runMutation("Conflict resolved", async (repository) => {
            const conflict = await gitcatApi.conflictDetails(repository.repository_id, entry.path);
            return gitcatApi.resolveConflict(
                repository.repository_id,
                entry.path,
                resolution,
                conflict.expected_state,
            );
        });
    }, [runMutation]);

    const resolveConflictPaths = useCallback((paths: string[], resolution: ConflictResolution) => {
        if (!paths.length) return;
        const count = `${paths.length} conflicted file${paths.length === 1 ? "" : "s"}`;
        const question = resolution === "mark_resolved"
            ? `Stage the current working copy of ${count} as resolved?`
            : resolution === "delete"
                ? `Delete ${count} as the conflict resolution?`
                : `Take the ${resolution === "ours" ? "current" : "incoming"} version for ${count}?`;
        if (!window.confirm(question)) return;
        void runMutation(
            `${paths.length} conflict${paths.length === 1 ? "" : "s"} resolved`,
            (repository) => gitcatApi.resolveConflicts(repository.repository_id, paths, resolution),
        );
    }, [runMutation]);

    return { closeConflictEditor, openConflictEditor, resolveConflictEntry, resolveConflictPaths, saveConflictResult };
}
