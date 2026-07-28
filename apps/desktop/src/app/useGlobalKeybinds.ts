import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { DiffViewMode } from "../components/diff";
import type { FolderCollapseTarget } from "../components/file-tree";
import { gitcatApi } from "../lib/api";
import { isEditableTarget, isPlainTypingKeybind, matchesKeybind } from "../lib/keybinds";
import type {
    ConflictFileDetails,
    FileDiff,
    KeybindSettings,
    PullMode,
    RepositorySnapshot,
} from "../lib/types";
import type { BranchMenuState, CommitMenuState, PromptState, RuntimeRepository, TabMenuState } from "./state";

export interface GlobalKeybindsParams {
    abortActiveOperation: () => void;
    activateRepositoryTab: (nextId: string | undefined) => void;
    activeRepository: RuntimeRepository | undefined;
    activeTabId: string | null;
    autoResolveActiveConflicts: () => void;
    busy: boolean;
    centerView: "graph" | "diff";
    chooseRepository: (targetTabId?: string | null) => Promise<void>;
    closeDiff: () => void;
    closeTab: (tabId: string) => void;
    commitMenu: CommitMenuState | null;
    conflictEditor: ConflictFileDetails | null;
    continueActiveOperation: () => void;
    copySha: (oid: string) => Promise<void>;
    createBranchAtHead: () => void;
    cycleRepository: (direction: 1 | -1) => void;
    diff: FileDiff | null;
    diffLoading: boolean;
    fetchActiveRepository: () => void;
    focusCommitMessage: () => void;
    keybinds: KeybindSettings;
    openSearch: () => void;
    openStartTab: () => void;
    orderedTabIds: string[];
    overviewLoading: boolean;
    prompt: PromptState;
    pullActiveRepository: (mode?: PullMode) => void;
    pushActiveRepository: () => void;
    refreshActiveRepository: () => void;
    reopenClosedRepository: () => Promise<void>;
    runMutation: unknown;
    selectWip: () => void;
    selectedOid: string | null;
    selectedWorktreeFile: { path: string; staged: boolean } | null;
    setBranchMenu: Dispatch<SetStateAction<BranchMenuState | null>>;
    setCenterView: Dispatch<SetStateAction<"graph" | "diff">>;
    setCommitMenu: Dispatch<SetStateAction<CommitMenuState | null>>;
    setDiffMode: (mode: DiffViewMode) => void;
    setLeftPanelVisible: Dispatch<SetStateAction<boolean>>;
    setRightPanelVisible: Dispatch<SetStateAction<boolean>>;
    setSettingsOpen: Dispatch<SetStateAction<boolean>>;
    setTabMenu: Dispatch<SetStateAction<TabMenuState | null>>;
    settingsOpen: boolean;
    showError: (title: string, error: unknown) => void;
    snapshot: RepositorySnapshot | null;
    stagePaths: (paths: string[], collapse?: FolderCollapseTarget) => void;
    stashActiveRepository: () => void;
    startDialog: "clone" | "create" | null;
    tabMenu: TabMenuState | null;
    unstagePaths: (paths: string[], collapse?: FolderCollapseTarget) => void;
    wipSelected: boolean;
}

export function useGlobalKeybinds({
    abortActiveOperation,
    activateRepositoryTab,
    activeRepository,
    activeTabId,
    autoResolveActiveConflicts,
    busy,
    centerView,
    chooseRepository,
    closeDiff,
    closeTab,
    commitMenu,
    conflictEditor,
    continueActiveOperation,
    copySha,
    createBranchAtHead,
    cycleRepository,
    diff,
    diffLoading,
    fetchActiveRepository,
    focusCommitMessage,
    keybinds,
    openSearch,
    openStartTab,
    orderedTabIds,
    overviewLoading,
    prompt,
    pullActiveRepository,
    pushActiveRepository,
    refreshActiveRepository,
    reopenClosedRepository,
    runMutation,
    selectWip,
    selectedOid,
    selectedWorktreeFile,
    setBranchMenu,
    setCenterView,
    setCommitMenu,
    setDiffMode,
    setLeftPanelVisible,
    setRightPanelVisible,
    setSettingsOpen,
    setTabMenu,
    settingsOpen,
    showError,
    snapshot,
    stagePaths,
    stashActiveRepository,
    startDialog,
    tabMenu,
    unstagePaths,
    wipSelected,
}: GlobalKeybindsParams): void {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            const editable = isEditableTarget(event.target);
            const matches = (binding: string) => (
                matchesKeybind(event, binding)
                && !(editable && isPlainTypingKeybind(binding))
            );
            if (settingsOpen || conflictEditor || prompt || startDialog || commitMenu || tabMenu) {
                if (Object.values(keybinds).some((binding) => matches(binding))) event.preventDefault();
                return;
            }
            if (matches(keybinds.next_repository)) {
                event.preventDefault();
                if (orderedTabIds.length > 1) cycleRepository(1);
            } else if (matches(keybinds.previous_repository)) {
                event.preventDefault();
                if (orderedTabIds.length > 1) cycleRepository(-1);
            } else if ([
                keybinds.repository_1,
                keybinds.repository_2,
                keybinds.repository_3,
                keybinds.repository_4,
                keybinds.repository_5,
                keybinds.repository_6,
                keybinds.repository_7,
                keybinds.repository_8,
                keybinds.repository_9,
            ].some(matches)) {
                event.preventDefault();
                const directBindings = [
                    keybinds.repository_1,
                    keybinds.repository_2,
                    keybinds.repository_3,
                    keybinds.repository_4,
                    keybinds.repository_5,
                    keybinds.repository_6,
                    keybinds.repository_7,
                    keybinds.repository_8,
                    keybinds.repository_9,
                ];
                activateRepositoryTab(orderedTabIds[directBindings.findIndex(matches)]);
            } else if (matches(keybinds.new_repository_tab)) {
                event.preventDefault();
                openStartTab();
            } else if (matches(keybinds.close_repository)) {
                event.preventDefault();
                if (activeTabId) closeTab(activeTabId);
            } else if (matches(keybinds.reopen_closed_repository)) {
                event.preventDefault();
                if (!busy) void reopenClosedRepository();
            } else if (matches(keybinds.search_commits)) {
                event.preventDefault();
                if (activeRepository) openSearch();
            } else if (matches(keybinds.open_repository)) {
                event.preventDefault();
                if (!busy) void chooseRepository();
            } else if (matches(keybinds.open_repository_folder)) {
                event.preventDefault();
                if (activeRepository) {
                    void gitcatApi.openRepositoryFolder(activeRepository.repository_id)
                        .catch((error) => showError("Could not open repository folder", error));
                }
            } else if (matches(keybinds.open_settings)) {
                event.preventDefault();
                setSettingsOpen(true);
            } else if (matches(keybinds.refresh_repository)) {
                event.preventDefault();
                refreshActiveRepository();
            } else if (matches(keybinds.toggle_left_panel)) {
                event.preventDefault();
                if (activeRepository) setLeftPanelVisible((visible) => !visible);
            } else if (matches(keybinds.toggle_right_panel)) {
                event.preventDefault();
                if (activeRepository) setRightPanelVisible((visible) => !visible);
            } else if (matches(keybinds.fetch)) {
                event.preventDefault();
                if (activeRepository && !busy) fetchActiveRepository();
            } else if (matches(keybinds.pull)) {
                event.preventDefault();
                if (activeRepository && !busy) pullActiveRepository();
            } else if (matches(keybinds.push)) {
                event.preventDefault();
                if (activeRepository && !busy) pushActiveRepository();
            } else if (matches(keybinds.create_branch)) {
                event.preventDefault();
                if (activeRepository && !busy) createBranchAtHead();
            } else if (matches(keybinds.stash)) {
                event.preventDefault();
                if (activeRepository && !busy) stashActiveRepository();
            } else if (matches(keybinds.show_worktree)) {
                event.preventDefault();
                if (activeRepository) {
                    selectWip();
                    setRightPanelVisible(true);
                }
            } else if (matches(keybinds.show_graph)) {
                event.preventDefault();
                if (activeRepository) setCenterView("graph");
            } else if (matches(keybinds.diff_inline)) {
                event.preventDefault();
                if (diff) setDiffMode("inline");
            } else if (matches(keybinds.diff_split)) {
                event.preventDefault();
                if (diff) setDiffMode("split");
            } else if (matches(keybinds.copy_selected_sha)) {
                event.preventDefault();
                if (selectedOid) void copySha(selectedOid);
            } else if (matches(keybinds.continue_operation)) {
                event.preventDefault();
                if (!busy) continueActiveOperation();
            } else if (matches(keybinds.abort_operation)) {
                event.preventDefault();
                if (!busy) abortActiveOperation();
            } else if (
                matches(keybinds.stage_all)
            ) {
                event.preventDefault();
                if (activeRepository && snapshot && wipSelected) {
                    const paths = snapshot.status.entries
                        .filter((entry) => entry.worktree && !entry.conflicted)
                        .map((entry) => entry.path);
                    if (paths.length) stagePaths(paths, "all");
                }
            } else if (
                matches(keybinds.unstage_all)
            ) {
                event.preventDefault();
                if (activeRepository && snapshot && wipSelected) {
                    const paths = snapshot.status.entries.filter((entry) => entry.index && !entry.conflicted).map((entry) => entry.path);
                    if (paths.length) unstagePaths(paths, "all");
                }
            } else if (matches(keybinds.focus_commit_message)) {
                event.preventDefault();
                focusCommitMessage();
            } else if (matches(keybinds.auto_resolve_conflicts)) {
                event.preventDefault();
                if (!busy) autoResolveActiveConflicts();
            } else if (matches(keybinds.commit)) {
                event.preventDefault();
                window.dispatchEvent(new Event("gitcat:commit"));
            } else if (event.key === "Escape") {
                if (centerView === "diff" || diff || diffLoading || selectedWorktreeFile) {
                    event.preventDefault();
                    closeDiff();
                } else {
                    setCommitMenu(null);
                    setTabMenu(null);
                    setBranchMenu(null);
                }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        activeRepository,
        activeTabId,
        abortActiveOperation,
        activateRepositoryTab,
        autoResolveActiveConflicts,
        busy,
        chooseRepository,
        centerView,
        closeDiff,
        closeTab,
        commitMenu,
        conflictEditor,
        continueActiveOperation,
        copySha,
        createBranchAtHead,
        cycleRepository,
        diff,
        diffLoading,
        fetchActiveRepository,
        focusCommitMessage,
        overviewLoading,
        orderedTabIds.length,
        orderedTabIds,
        openSearch,
        openStartTab,
        keybinds,
        prompt,
        pullActiveRepository,
        pushActiveRepository,
        refreshActiveRepository,
        reopenClosedRepository,
        runMutation,
        settingsOpen,
        showError,
        startDialog,
        selectWip,
        selectedWorktreeFile,
        snapshot,
        stagePaths,
        stashActiveRepository,
        tabMenu,
        unstagePaths,
        wipSelected,
    ]);
}
