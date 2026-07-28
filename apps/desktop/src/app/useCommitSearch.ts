import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import { gitcatApi } from "../lib/api";
import type { CommitActionAvailability, FileDiff } from "../lib/types";
import type { CommitDetailsPanel, RuntimeRepository } from "./state";

export interface CommitSearchParams {
    activeRepository: RuntimeRepository | undefined;
    activeRepositoryIdRef: RefObject<string | null>;
    diffLoadSequence: RefObject<number>;
    setCenterView: Dispatch<SetStateAction<"graph" | "diff">>;
    setCommitActions: Dispatch<SetStateAction<CommitActionAvailability[]>>;
    setDetails: Dispatch<SetStateAction<CommitDetailsPanel | null>>;
    setDiff: Dispatch<SetStateAction<FileDiff | null>>;
    setDiffLoading: Dispatch<SetStateAction<boolean>>;
    setSelectedOid: Dispatch<SetStateAction<string | null>>;
    setSelectedPath: Dispatch<SetStateAction<string | undefined>>;
    setSelectedWorktreeFile: Dispatch<SetStateAction<{ path: string; staged: boolean } | null>>;
    setWipSelected: Dispatch<SetStateAction<boolean>>;
    showError: (title: string, error: unknown) => void;
}

export function useCommitSearch({
    activeRepository,
    activeRepositoryIdRef,
    diffLoadSequence,
    setCenterView,
    setCommitActions,
    setDetails,
    setDiff,
    setDiffLoading,
    setSelectedOid,
    setSelectedPath,
    setSelectedWorktreeFile,
    setWipSelected,
    showError,
}: CommitSearchParams) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchFocusToken, setSearchFocusToken] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchOids, setSearchOids] = useState<string[]>([]);
    const [searchIndex, setSearchIndex] = useState(0);
    const [searchBusy, setSearchBusy] = useState(false);
    const searchSequence = useRef(0);

    const openSearch = useCallback(() => {
        setSearchOpen(true);
        setSearchFocusToken((token) => token + 1);
        setCenterView("graph");
    }, [setCenterView]);

    useEffect(() => {
        const sequence = ++searchSequence.current;
        if (!searchOpen || !activeRepository || !searchQuery.trim()) {
            setSearchOids([]);
            setSearchIndex(0);
            setSearchBusy(false);
            return;
        }
        const repositoryId = activeRepository.repository_id;
        setSearchBusy(true);
        const timer = window.setTimeout(() => {
            void gitcatApi.searchCommits(activeRepository.repository_id, {
                query: searchQuery,
                scope: { kind: "all_refs" },
                limit: 1000,
            }).then((result) => {
                if (
                    sequence !== searchSequence.current
                    || activeRepositoryIdRef.current !== repositoryId
                ) return;
                setSearchOids(result.hits.map((hit) => hit.oid));
                setSearchIndex(0);
                if (result.hits[0]) {
                    ++diffLoadSequence.current;
                    setSelectedOid(result.hits[0].oid);
                    setWipSelected(false);
                    setSelectedPath(undefined);
                    setSelectedWorktreeFile(null);
                    setDiff(null);
                    setDiffLoading(false);
                    setCenterView("graph");
                }
            }).catch((error) => {
                if (
                    sequence === searchSequence.current
                    && activeRepositoryIdRef.current === repositoryId
                ) showError("Commit search failed", error);
            })
                .finally(() => { if (sequence === searchSequence.current) setSearchBusy(false); });
        }, 180);
        return () => window.clearTimeout(timer);
    }, [activeRepository, searchOpen, searchQuery, showError]);

    const navigateSearch = useCallback((direction: 1 | -1) => {
        if (!searchOids.length) return;
        const next = (searchIndex + direction + searchOids.length) % searchOids.length;
        ++diffLoadSequence.current;
        setSearchIndex(next);
        setSelectedOid(searchOids[next]);
        setWipSelected(false);
        setDetails(null);
        setCommitActions([]);
        setSelectedPath(undefined);
        setSelectedWorktreeFile(null);
        setDiff(null);
        setDiffLoading(false);
        setCenterView("graph");
    }, [searchIndex, searchOids]);

    return {
        navigateSearch,
        openSearch,
        searchBusy,
        searchFocusToken,
        searchIndex,
        searchOids,
        searchOpen,
        searchQuery,
        setSearchOpen,
        setSearchQuery,
    };
}
