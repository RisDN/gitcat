import { AlertTriangle } from "lucide-react";
import { useRef } from "react";

import { CommitGraph, type CommitContextMenuRequest } from "../components/CommitGraph";
import { DiffViewer, type DiffViewMode } from "../components/diff";
import { ChangeCountSummary, type FileChangeCounts } from "../components/file-tree";
import { SearchBar } from "../components/SearchBar";
import { Button, Spinner } from "../components/ui";
import { gitcatApi } from "../lib/api";
import type {
    AppSettings,
    BranchInfo,

    CommitSummary,
    FileDiff,
    HistoryPage,
    RepositorySnapshot,
} from "../lib/types";
import type { CommitMenuState, RunMutation } from "./state";

export interface HistoryPaneProps {
    activeConflictCount: number;
    busy: boolean;
    centerView: "graph" | "diff";
    checkoutRemoteBranch: (branch: BranchInfo) => void;
    closeDiff: () => void;
    copySha: (oid: string) => Promise<void>;
    currentHeadOid: string | null;
    diff: FileDiff | null;
    diffLoading: boolean;
    diffMode: DiffViewMode;
    graphColumnWidth: number;
    graphMatches: Set<string>;
    history: HistoryPage | null;
    historyLoading: boolean;
    loadMoreHistory: () => void;
    navigateSearch: (direction: 1 | -1) => void;
    overviewLoading: boolean;
    remoteIconUrls: Map<string, string>;
    runMutation: RunMutation;
    searchBusy: boolean;
    searchFocusToken: number;
    searchIndex: number;
    searchOids: string[];
    searchOpen: boolean;
    searchQuery: string;
    selectCommit: (commit: CommitSummary) => void;
    selectFirstCommitFromWip: () => void;
    selectWip: () => void;
    selectWipFromGraph: () => void;
    selectedOid: string | null;
    setCommitMenu: (menu: CommitMenuState | null) => void;
    setDiffMode: (mode: DiffViewMode) => void;
    setSearchOpen: (open: boolean) => void;
    setSearchQuery: (query: string) => void;
    settings: AppSettings;
    snapshot: RepositorySnapshot | null;
    wipLane: number;
    wipRowRef: React.RefObject<HTMLButtonElement | null>;
    wipRowStyle: React.CSSProperties;
    wipSelected: boolean;
    wipStats: FileChangeCounts;
    worktreeReachable: boolean;
}

export function HistoryPane({
    activeConflictCount,
    busy,
    centerView,
    checkoutRemoteBranch,
    closeDiff,
    copySha,
    currentHeadOid,
    diff,
    diffLoading,
    diffMode,
    graphColumnWidth,
    graphMatches,
    history,
    historyLoading,
    loadMoreHistory,
    navigateSearch,
    overviewLoading,
    remoteIconUrls,
    runMutation,
    searchBusy,
    searchFocusToken,
    searchIndex,
    searchOids,
    searchOpen,
    searchQuery,
    selectCommit,
    selectFirstCommitFromWip,
    selectWip,
    selectWipFromGraph,
    selectedOid,
    setCommitMenu,
    setDiffMode,
    setSearchOpen,
    setSearchQuery,
    settings,
    snapshot,
    wipLane,
    wipRowRef,
    wipRowStyle,
    wipSelected,
    wipStats,
    worktreeReachable,
}: HistoryPaneProps) {
    const graphHeaderRef = useRef<HTMLDivElement | null>(null);

    return (
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" aria-label="Repository history" style={{ gridColumn: 3 }}>
            {searchOpen && centerView === "graph" ? (
                <SearchBar
                    activeIndex={searchIndex}
                    busy={searchBusy}
                    count={searchOids.length}
                    focusToken={searchFocusToken}
                    onChange={setSearchQuery}
                    onClose={() => { setSearchOpen(false); setSearchQuery(""); }}
                    onNext={() => navigateSearch(1)}
                    onPrevious={() => navigateSearch(-1)}
                    value={searchQuery}
                />
            ) : null}
            {centerView === "diff" ? (
                <DiffViewer
                    closeKeybind={settings.keybinds.show_graph}
                    diff={diff}
                    loading={diffLoading}
                    mode={diffMode}
                    onClose={closeDiff}
                    onModeChange={setDiffMode}
                />
            ) : (
                <div
                    className="flex min-h-0 min-w-0 flex-1 flex-col"
                    style={{ "--gc-graph-column-width": `${graphColumnWidth}px` } as React.CSSProperties}
                >
                    <div
                        aria-hidden="true"
                        className="gc-graph-header"
                        ref={graphHeaderRef}
                    >
                        <div className="gc-graph-columns">
                            <span>Branch / Tag</span>
                            <span>Graph</span>
                            <span>Commit message</span>
                            <span>Author</span>
                            <span>Date / Time</span>
                            <span>SHA</span>
                        </div>
                    </div>
                    <div
                        className="min-h-0 min-w-0 flex-1 overflow-auto scrollbar-gutter-stable"
                        onScroll={(event) => {
                            if (graphHeaderRef.current) graphHeaderRef.current.scrollLeft = event.currentTarget.scrollLeft;
                        }}
                    >
                    {worktreeReachable ? (
                        <button
                            className={`gc-wip-row ${wipSelected ? "gc-wip-row--selected" : ""}`}
                            onClick={selectWip}
                            onKeyDown={(event) => {
                                if (event.key === "ArrowDown") {
                                    event.preventDefault();
                                    selectFirstCommitFromWip();
                                }
                            }}
                            ref={wipRowRef}
                            style={wipRowStyle}
                            type="button"
                        >
                            <span className="gc-wip-row__refs" />
                            <span className="gc-wip-row__rail"><i /></span>
                            <span className="gc-wip-row__message">
                                <strong>// WIP</strong>
                                <ChangeCountSummary counts={wipStats} size="md" />
                            </span>
                            <span className={activeConflictCount ? "gc-wip-row__conflicts" : "text-muted"}>
                                {activeConflictCount ? <><AlertTriangle size={12} /> {activeConflictCount}</> : ""}
                            </span>
                            <span />
                        </button>
                    ) : null}
                    {history ? (
                        <CommitGraph
                            beforeFirstSelected={wipSelected}
                            commits={history.commits}
                            headOid={currentHeadOid}
                            detachedHeadOid={snapshot?.head.kind === "detached" ? snapshot.head.oid : null}
                            hideHeadDecoration={false}
                            onNavigateBeforeFirst={worktreeReachable ? selectWipFromGraph : undefined}
                            onCommitContextMenu={(request: CommitContextMenuRequest) => setCommitMenu({ x: request.clientX, y: request.clientY, commit: request.commit })}
                            onCopySha={(oid) => void copySha(oid)}
                            onRefDoubleClick={(decoration) => {
                                if (decoration.kind === "local_branch" && !decoration.is_head) {
                                    void runMutation(`Checked out ${decoration.name}`, (repository) => gitcatApi.checkoutBranch(repository.repository_id, decoration.name));
                                    return;
                                }
                                if (decoration.kind === "remote_branch") {
                                    const branch = snapshot?.remote_branches.find((candidate) => candidate.full_name === decoration.full_name);
                                    if (branch) checkoutRemoteBranch(branch);
                                }
                            }}
                            onSelect={selectCommit}
                            remoteIconUrls={remoteIconUrls}
                            searchMatchOids={graphMatches}
                            selectedOid={selectedOid}
                            wip={snapshot && !snapshot.status.clean
                                ? { lane: wipLane, headOid: currentHeadOid }
                                : undefined}
                        />
                    ) : (
                        <div className="flex h-40 items-center justify-center gap-2 text-muted">
                            <Spinner label="Loading history" /> Loading history…
                        </div>
                    )}
                    {history?.has_more && history.next_cursor ? (
                        <Button
                            className="mx-auto mb-5 mt-3 flex"
                            disabled={busy || overviewLoading || historyLoading}
                            onClick={loadMoreHistory}
                        >{historyLoading ? "Loading older commits…" : "Load older commits"}</Button>
                    ) : null}
                    </div>
                </div>
            )}
        </section>
    );
}
