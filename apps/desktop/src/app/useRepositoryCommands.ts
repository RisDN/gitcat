import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { ToastMessage } from "../components/ToastRegion";
import { gitcatApi } from "../lib/api";
import type { PullMode, RepositorySnapshot, StashEntry } from "../lib/types";
import { continuableOperation } from "./snapshot";
import type { PromptState, RunMutation } from "./state";

export interface RepositoryCommandsParams {
    addToast: (toast: Omit<ToastMessage, "id">) => void;
    autoPrune: boolean;
    defaultPullMode: PullMode;
    runMutation: RunMutation;
    selectWip: () => void;
    setPrompt: Dispatch<SetStateAction<PromptState>>;
    setRightPanelVisible: Dispatch<SetStateAction<boolean>>;
    snapshot: RepositorySnapshot | null;
    stashes: StashEntry[];
}

export function useRepositoryCommands({
    addToast,
    autoPrune,
    defaultPullMode,
    runMutation,
    selectWip,
    setPrompt,
    setRightPanelVisible,
    snapshot,
    stashes,
}: RepositoryCommandsParams) {
    const fetchActiveRepository = useCallback(() => {
        void runMutation("Fetch complete", (repository) => gitcatApi.fetch(repository.repository_id, {
            remote: null,
            prune: autoPrune,
            tags: false,
        }));
    }, [autoPrune, runMutation]);

    const pullActiveRepository = useCallback((mode: PullMode = defaultPullMode) => {
        void runMutation("Pull complete", (repository) => gitcatApi.pull(repository.repository_id, {
            remote: null,
            branch: null,
            mode,
            prune: autoPrune,
            autostash: true,
        }));
    }, [autoPrune, defaultPullMode, runMutation]);

    const pushActiveRepository = useCallback(() => {
        void runMutation("Push complete", (repository) => gitcatApi.push(repository.repository_id, {
            remote: null,
            branch: null,
            set_upstream: false,
        }));
    }, [runMutation]);

    const createBranchAtHead = useCallback(() => {
        if (!snapshot) return;
        const oid = snapshot.head.kind === "unborn" ? null : snapshot.head.oid;
        if (oid) setPrompt({ kind: "create_branch", startOid: oid });
        else addToast({ tone: "info", title: "Create the first commit before branching" });
    }, [addToast, snapshot]);

    const stashActiveRepository = useCallback(() => {
        void runMutation("Changes stashed", (repository) => gitcatApi.stashPush(repository.repository_id, null, true));
    }, [runMutation]);

    const popLatestStash = useCallback(() => {
        if (!stashes.length) return;
        void runMutation("Stash popped", (repository) => gitcatApi.stashApply(repository.repository_id, stashes[0].index, true));
    }, [runMutation, stashes]);

    const continueActiveOperation = useCallback(() => {
        const operation = snapshot ? continuableOperation(snapshot.operation_state) : null;
        if (operation) void runMutation("Operation continued", (repository) => gitcatApi.continueOperation(repository.repository_id, operation));
    }, [runMutation, snapshot]);

    const abortActiveOperation = useCallback(() => {
        const operation = snapshot ? continuableOperation(snapshot.operation_state) : null;
        if (!operation || !window.confirm(`Abort the active ${operation.replace("_", "-")} operation and discard its in-progress state?`)) return;
        void runMutation("Operation aborted", (repository) => gitcatApi.abortOperation(repository.repository_id, operation));
    }, [runMutation, snapshot]);

    const skipActiveOperation = useCallback(() => {
        const operation = snapshot ? continuableOperation(snapshot.operation_state) : null;
        if (!operation || operation === "merge") return;
        const label = operation.replace("_", "-");
        if (!window.confirm(`Skip the commit currently being applied by this ${label} and drop its changes?`)) return;
        void runMutation("Commit skipped", (repository) => gitcatApi.skipOperation(repository.repository_id, operation));
    }, [runMutation, snapshot]);

    const autoResolveActiveConflicts = useCallback(() => {
        if (!snapshot?.status.entries.some((entry) => entry.conflicted)) return;
        void runMutation("Recorded conflict resolutions applied", (repository) => gitcatApi.autoResolveConflicts(repository.repository_id));
    }, [runMutation, snapshot]);

    const focusCommitMessage = useCallback(() => {
        if (!snapshot) return;
        selectWip();
        setRightPanelVisible(true);
        requestAnimationFrame(() => document.getElementById("commit-message")?.focus());
    }, [selectWip, snapshot]);

    return {
        abortActiveOperation,
        autoResolveActiveConflicts,
        continueActiveOperation,
        createBranchAtHead,
        fetchActiveRepository,
        focusCommitMessage,
        popLatestStash,
        pullActiveRepository,
        pushActiveRepository,
        skipActiveOperation,
        stashActiveRepository,
    };
}
