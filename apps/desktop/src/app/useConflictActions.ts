import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";

import { gitcatApi } from "../lib/api";
import type { ConflictFileDetails, ConflictResolution, StatusEntry } from "../lib/types";
import type { RunMutation, RuntimeRepository } from "./state";

export interface ConflictActionsParams {
    activeRepository: RuntimeRepository | undefined;
    activeRepositoryIdRef: RefObject<string | null>;
    busy: boolean;
    runMutation: RunMutation;
    setBusy: Dispatch<SetStateAction<boolean>>;
    setConflictEditor: Dispatch<SetStateAction<ConflictFileDetails | null>>;
    showError: (title: string, error: unknown) => void;
}

export function useConflictActions({
    activeRepository,
    activeRepositoryIdRef,
    busy,
    runMutation,
    setBusy,
    setConflictEditor,
    showError,
}: ConflictActionsParams) {
    const openConflictEditor = useCallback(async (entry: StatusEntry) => {
        if (!activeRepository || busy) return;
        const repositoryId = activeRepository.repository_id;
        setBusy(true);
        try {
            const next = await gitcatApi.conflictDetails(repositoryId, entry.path);
            if (activeRepositoryIdRef.current === repositoryId) setConflictEditor(next);
        } catch (error) {
            if (activeRepositoryIdRef.current === repositoryId) showError("Conflict editor could not be opened", error);
        } finally {
            setBusy(false);
        }
    }, [activeRepository, busy, showError]);

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

    return { openConflictEditor, resolveConflictEntry, resolveConflictPaths };
}
