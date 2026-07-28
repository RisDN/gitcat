import { startTransition, useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

import { gitcatApi } from "../lib/api";
import type {
    CommitActionAvailability,
    ConflictFileDetails,
    FileDiff,
    HistoryPage,
    RepositorySnapshot,
    StashEntry,
} from "../lib/types";
import { continuableOperation } from "./snapshot";
import type { CommitDetailsPanel, RuntimeRepository } from "./state";

export interface RepositoryOverviewParams {
    activeRepository: RuntimeRepository | undefined;
    activeRepositoryIdRef: RefObject<string | null>;
    detailsLoadSequence: RefObject<number>;
    diffLoadSequence: RefObject<number>;
    busy: boolean;
    history: HistoryPage | null;
    historyLoadSequence: RefObject<number>;
    historyLoading: boolean;
    historyPageSize: number;
    overviewLoadSequence: RefObject<number>;
    overviewLoading: boolean;
    overviewRepositoryId: string | null;
    pendingSelectionRef: RefObject<{ index: number; subject: string } | null>;
    selectedOid: string | null;
    selectedOidRef: RefObject<string | null>;
    setCenterView: Dispatch<SetStateAction<"graph" | "diff">>;
    setCommitActions: Dispatch<SetStateAction<CommitActionAvailability[]>>;
    setConflictEditor: Dispatch<SetStateAction<ConflictFileDetails | null>>;
    setDetails: Dispatch<SetStateAction<CommitDetailsPanel | null>>;
    setDiff: Dispatch<SetStateAction<FileDiff | null>>;
    setDiffLoading: Dispatch<SetStateAction<boolean>>;
    setHistory: Dispatch<SetStateAction<HistoryPage | null>>;
    setHistoryLoading: Dispatch<SetStateAction<boolean>>;
    setOverviewLoading: Dispatch<SetStateAction<boolean>>;
    setOverviewRepositoryId: Dispatch<SetStateAction<string | null>>;
    setSelectedOid: Dispatch<SetStateAction<string | null>>;
    setSelectedPath: Dispatch<SetStateAction<string | undefined>>;
    setSelectedWorktreeFile: Dispatch<SetStateAction<{ path: string; staged: boolean } | null>>;
    setSnapshot: Dispatch<SetStateAction<RepositorySnapshot | null>>;
    setStashes: Dispatch<SetStateAction<StashEntry[]>>;
    setWipSelected: Dispatch<SetStateAction<boolean>>;
    showError: (title: string, error: unknown) => void;
    wipSelected: boolean;
}

export function useRepositoryOverview({
    activeRepository,
    activeRepositoryIdRef,
    detailsLoadSequence,
    diffLoadSequence,
    busy,
    history,
    historyLoadSequence,
    historyLoading,
    historyPageSize,
    overviewLoadSequence,
    overviewLoading,
    overviewRepositoryId,
    pendingSelectionRef,
    selectedOid,
    selectedOidRef,
    setCenterView,
    setCommitActions,
    setConflictEditor,
    setDetails,
    setDiff,
    setDiffLoading,
    setHistory,
    setHistoryLoading,
    setOverviewLoading,
    setOverviewRepositoryId,
    setSelectedOid,
    setSelectedPath,
    setSelectedWorktreeFile,
    setSnapshot,
    setStashes,
    setWipSelected,
    showError,
    wipSelected,
}: RepositoryOverviewParams) {
    const loadOverview = useCallback(async (
        repository: RuntimeRepository,
        preserveSelection = true,
        showLoading = true,
    ) => {
        const sequence = ++overviewLoadSequence.current;
        if (showLoading && activeRepositoryIdRef.current === repository.repository_id) {
            ++historyLoadSequence.current;
            setHistoryLoading(false);
            setOverviewLoading(true);
        }
        try {
            const overview = await gitcatApi.loadRepositoryOverview(repository.repository_id, {
                scope: { kind: "all_refs" },
                cursor: null,
                limit: historyPageSize,
            });
            if (
                sequence !== overviewLoadSequence.current
                || activeRepositoryIdRef.current !== repository.repository_id
            ) return;
            startTransition(() => {
                setOverviewRepositoryId(repository.repository_id);
                setSnapshot(overview.snapshot);
                setHistory(overview.history);
                setStashes(overview.stashes);
                const pending = pendingSelectionRef.current;
                pendingSelectionRef.current = null;
                // A reword rebuilds the commit under a new oid; re-find it by
                // position (the replay keeps the order) and fall back to subject.
                const rewritten = pending
                    ? overview.history.commits[pending.index]?.subject === pending.subject
                        ? overview.history.commits[pending.index]
                        : overview.history.commits.find((commit) => commit.subject === pending.subject)
                    : undefined;
                const previous = preserveSelection ? selectedOidRef.current : null;
                if (rewritten) {
                    setSelectedOid(rewritten.oid);
                    setWipSelected(false);
                } else if (previous && overview.history.commits.some((commit) => commit.oid === previous)) {
                    setSelectedOid(previous);
                    setWipSelected(false);
                } else if (
                    !overview.snapshot.status.clean
                    || continuableOperation(overview.snapshot.operation_state)
                ) {
                    setSelectedOid(null);
                    setWipSelected(true);
                } else {
                    setSelectedOid(overview.history.commits[0]?.oid ?? null);
                    setWipSelected(false);
                }
            });
        } finally {
            if (
                showLoading
                && sequence === overviewLoadSequence.current
                && activeRepositoryIdRef.current === repository.repository_id
            ) setOverviewLoading(false);
        }
    }, [historyPageSize]);

    useEffect(() => {
        ++overviewLoadSequence.current;
        ++detailsLoadSequence.current;
        ++diffLoadSequence.current;
        ++historyLoadSequence.current;
        setHistoryLoading(false);
        setOverviewLoading(false);
        setOverviewRepositoryId(null);
        setSnapshot(null);
        setHistory(null);
        setDetails(null);
        setDiff(null);
        setConflictEditor(null);
        setSelectedPath(undefined);
        setSelectedWorktreeFile(null);
        setDiffLoading(false);
        setCenterView("graph");
        if (!activeRepository) return;
        void loadOverview(activeRepository, false)
            .catch((error) => showError("Repository could not be loaded", error));
    }, [activeRepository, loadOverview, showError]);

    useEffect(() => {
        if (
            !activeRepository
            || overviewRepositoryId !== activeRepository.repository_id
            || !selectedOid
            || wipSelected
        ) {
            ++detailsLoadSequence.current;
            setDetails(null);
            setCommitActions([]);
            return;
        }
        const repositoryId = activeRepository.repository_id;
        const sequence = ++detailsLoadSequence.current;
        setDetails(null);
        setCommitActions([]);
        void gitcatApi.loadCommitPanel(activeRepository.repository_id, selectedOid)
            .then((panel) => {
                if (
                    sequence !== detailsLoadSequence.current
                    || activeRepositoryIdRef.current !== repositoryId
                ) return;
                setDetails(panel.details);
                setCommitActions(panel.actions);
            })
            .catch((error) => {
                if (
                    sequence === detailsLoadSequence.current
                    && activeRepositoryIdRef.current === repositoryId
                ) showError("Commit details could not be loaded", error);
            });
    }, [activeRepository, overviewRepositoryId, selectedOid, showError, wipSelected]);

    const loadMoreHistory = useCallback(() => {
        if (!activeRepository || !history?.next_cursor) return;
        if (busy || overviewLoading || historyLoading) return;
        const repositoryId = activeRepository.repository_id;
        const sequence = ++historyLoadSequence.current;
        setHistoryLoading(true);
        void gitcatApi.history(repositoryId, {
            scope: { kind: "all_refs" },
            cursor: history.next_cursor,
            limit: historyPageSize,
        }).then((page) => {
            if (
                sequence !== historyLoadSequence.current
                || activeRepositoryIdRef.current !== repositoryId
            ) return;
            setHistory((current) => current
                ? { ...page, commits: [...current.commits, ...page.commits] }
                : page);
        }).catch((error) => {
            if (
                sequence === historyLoadSequence.current
                && activeRepositoryIdRef.current === repositoryId
            ) showError("More commits could not be loaded", error);
        }).finally(() => {
            if (
                sequence === historyLoadSequence.current
                && activeRepositoryIdRef.current === repositoryId
            ) setHistoryLoading(false);
        });
    }, [
        activeRepository,
        busy,
        history,
        historyLoading,
        historyPageSize,
        overviewLoading,
        showError,
    ]);

    return { loadMoreHistory, loadOverview };
}
