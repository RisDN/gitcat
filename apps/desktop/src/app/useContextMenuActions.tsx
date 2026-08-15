import { Copy, Download, FolderInput, FolderPlus, FolderX, GitBranchPlus, GitCommitHorizontal, GitPullRequestArrow, PackageCheck, PackageOpen, Pencil, RotateCcw, Tag, Trash2, Upload, X, } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction, } from "react";

import type { ContextAction } from "../components/ContextMenu";
import { branchNameWithoutRemote } from "../components/ref-sidebar";
import type { ToastMessage } from "../components/ToastRegion";
import { PULL_LABELS } from "../components/toolbar";
import { gitcatApi } from "../lib/api";
import type {
    BranchInfo,
    CommitActionAvailability,
    PersistedState,
    PullMode,
    RepositorySnapshot,
    ResetMode,
} from "../lib/types";
import { branchAcceptsPull, branchPushTarget } from "./branches";
import { expectedState } from "./snapshot";
import type {
    BranchMenuState,
    CommitMenuState,
    ConfirmState,
    PromptState,
    RunMutation,
    RuntimeRepository,
    TabMenuState,
} from "./state";
import { workspaceTabs } from "./workspace";

export interface ContextMenuActionsParams {
    activateRepositoryTab: (nextId: string | undefined) => void;
    activeRepository: RuntimeRepository | undefined;
    activeRepositoryIdRef: RefObject<string | null>;
    addToast: (toast: Omit<ToastMessage, "id">) => void;
    branchMenu: BranchMenuState | null;
    closeTab: (tabId: string) => void;
    commitActions: CommitActionAvailability[];
    commitMenu: CommitMenuState | null;
    copySha: (oid: string) => Promise<void>;
    defaultPullMode: PullMode;
    detailsOid: string | undefined;
    moveRepositoryTab: (tabId: string, groupId: string | null) => void;
    pullActiveRepository: (mode?: PullMode) => void;
    runMutation: RunMutation;
    setBranchMenu: Dispatch<SetStateAction<BranchMenuState | null>>;
    setCommitMenu: Dispatch<SetStateAction<CommitMenuState | null>>;
    setConfirmRequest: Dispatch<SetStateAction<ConfirmState>>;
    setPersisted: Dispatch<SetStateAction<PersistedState>>;
    setPrompt: Dispatch<SetStateAction<PromptState>>;
    setTabMenu: Dispatch<SetStateAction<TabMenuState | null>>;
    showError: (title: string, error: unknown) => void;
    snapshot: RepositorySnapshot | null;
    tabMenu: TabMenuState | null;
    workspace: PersistedState["workspace"];
}

export interface ContextMenuActions {
    branchContextActions: ContextAction[];
    checkoutRemoteBranch: (branch: BranchInfo) => void;
    contextActions: ContextAction[];
    executeBranchAction: (action: string) => void;
    executeCommitAction: (action: string) => void;
    executeTabAction: (action: string) => void;
    tabContextActions: ContextAction[];
}

export function useContextMenuActions({
    activateRepositoryTab,
    activeRepository,
    activeRepositoryIdRef,
    addToast,
    branchMenu,
    closeTab,
    commitActions,
    commitMenu,
    copySha,
    defaultPullMode,
    detailsOid,
    moveRepositoryTab,
    pullActiveRepository,
    runMutation,
    setBranchMenu,
    setCommitMenu,
    setConfirmRequest,
    setPersisted,
    setPrompt,
    setTabMenu,
    showError,
    snapshot,
    tabMenu,
    workspace,
}: ContextMenuActionsParams): ContextMenuActions {
    const [commitMenuActions, setCommitMenuActions] = useState<{
        oid: string;
        actions: CommitActionAvailability[];
    } | null>(null);
    const commitMenuActionSequence = useRef(0);

    useEffect(() => {
        if (!commitMenu || !activeRepository) {
            ++commitMenuActionSequence.current;
            setCommitMenuActions(null);
            return;
        }

        if (detailsOid === commitMenu.commit.oid) {
            ++commitMenuActionSequence.current;
            setCommitMenuActions({ oid: commitMenu.commit.oid, actions: commitActions });
            return;
        }

        const repositoryId = activeRepository.repository_id;
        const oid = commitMenu.commit.oid;
        const sequence = ++commitMenuActionSequence.current;
        setCommitMenuActions({ oid, actions: [] });
        void gitcatApi.commitActionAvailability(repositoryId, oid)
            .then((actions) => {
                if (
                    sequence !== commitMenuActionSequence.current
                    || activeRepositoryIdRef.current !== repositoryId
                ) return;
                setCommitMenuActions({ oid, actions });
            })
            .catch((error) => {
                if (
                    sequence === commitMenuActionSequence.current
                    && activeRepositoryIdRef.current === repositoryId
                ) showError("Commit actions could not be loaded", error);
            });
    }, [activeRepository, commitActions, commitMenu, detailsOid, showError]);

    const commitMenuActionMap = useMemo(() => {
        if (!commitMenuActions || commitMenuActions.oid !== commitMenu?.commit.oid) return new Map();
        return new Map(commitMenuActions.actions.map((action) => [action.kind, action]));
    }, [commitMenu?.commit.oid, commitMenuActions]);

    const contextActions = useMemo<ContextAction[]>(() => {
        if (!commitMenu) return [];
        if (commitMenu.commit.stash) {
            return [
                { id: "stash_apply", label: "Apply Stash", icon: <PackageOpen size={15} /> },
                { id: "stash_pop", label: "Pop Stash", icon: <PackageCheck size={15} /> },
                { id: "stash_drop", label: "Delete Stash", icon: <Trash2 size={15} />, danger: true, separatorBefore: true },
                { id: "copy", label: "Copy full commit SHA", icon: <Copy size={15} />, separatorBefore: true },
            ];
        }
        const enabled = (kind: CommitActionAvailability["kind"]) => (
            commitMenuActionMap.get(kind)?.enabled ?? false
        );
        const resetTarget = snapshot?.head.kind === "branch" ? snapshot.head.name : "branch";
        return [
            { id: "checkout", label: "Checkout commit (detached)", icon: <GitCommitHorizontal size={15} />, disabled: !enabled("checkout") },
            { id: "branch", label: "Create branch here…", icon: <GitBranchPlus size={15} />, disabled: !enabled("create_branch") },
            { id: "tag", label: "Create tag here…", icon: <Tag size={15} />, disabled: !enabled("create_tag") },
            { id: "cherry_pick", label: "Cherry-pick commit", icon: <GitPullRequestArrow size={15} />, disabled: !enabled("cherry_pick"), separatorBefore: true },
            { id: "revert", label: "Revert commit", icon: <RotateCcw size={15} />, disabled: !enabled("revert") },
            {
                id: "reset",
                label: `Reset ${resetTarget} to this commit`,
                icon: <Trash2 size={15} />,
                disabled: !enabled("reset"),
                separatorBefore: true,
                submenu: [
                    { id: "reset:soft", label: "Soft - keep all changes" },
                    { id: "reset:mixed", label: "Mixed - keep working copy but reset index" },
                    { id: "reset:hard", label: "Hard - discard all changes" },
                ],
            },
            { id: "copy", label: "Copy full commit SHA", icon: <Copy size={15} />, separatorBefore: true },
        ];
    }, [commitMenu, commitMenuActionMap, snapshot?.head]);

    const executeCommitAction = useCallback((action: string) => {
        if (!commitMenu) return;
        const commit = commitMenu.commit;
        setCommitMenu(null);
        switch (action) {
            case "copy":
                void copySha(commit.oid);
                break;
            case "stash_apply":
                if (commit.stash) {
                    const { oid } = commit.stash;
                    void runMutation("Stash applied", (repository) => gitcatApi.stashApply(repository.repository_id, oid, false));
                }
                break;
            case "stash_pop":
                if (commit.stash) {
                    const { oid } = commit.stash;
                    void runMutation("Stash popped", (repository) => gitcatApi.stashApply(repository.repository_id, oid, true));
                }
                break;
            case "stash_drop":
                if (commit.stash) setConfirmRequest({ kind: "delete_stash", oid: commit.stash.oid, selector: commit.stash.selector });
                break;
            case "branch":
                setPrompt({ kind: "create_branch", startOid: commit.oid });
                break;
            case "tag":
                setPrompt({ kind: "create_tag", oid: commit.oid });
                break;
            case "checkout":
                if (window.confirm(`Check out ${commit.short_oid} in detached HEAD state?`)) {
                    void runMutation("Commit checked out", (repository) => gitcatApi.checkoutCommit(repository.repository_id, commit.oid));
                }
                break;
            case "cherry_pick": {
                const mainline = commit.parent_oids.length > 1 ? Number(window.prompt("Mainline parent number", "1")) : null;
                if (commit.parent_oids.length > 1 && (!mainline || mainline < 1)) break;
                void runMutation("Commit cherry-picked", (repository) => gitcatApi.cherryPick(repository.repository_id, commit.oid, mainline));
                break;
            }
            case "revert": {
                const mainline = commit.parent_oids.length > 1 ? Number(window.prompt("Mainline parent number", "1")) : null;
                if (commit.parent_oids.length > 1 && (!mainline || mainline < 1)) break;
                void runMutation("Commit reverted", (repository) => gitcatApi.revertCommit(repository.repository_id, commit.oid, mainline));
                break;
            }
            case "reset:soft":
            case "reset:mixed":
            case "reset:hard": {
                if (!snapshot) break;
                const mode = action.slice("reset:".length) as ResetMode;
                const branchName = snapshot.head.kind === "branch" ? snapshot.head.name : "branch";
                if (
                    mode === "hard"
                    && !window.confirm(`Hard reset ${branchName} to ${commit.short_oid}? This will discard uncommitted changes and cannot be undone.`)
                ) break;
                void runMutation("Branch reset", (repository) => gitcatApi.resetCommit(
                    repository.repository_id,
                    commit.oid,
                    mode,
                    mode === "hard",
                    expectedState(snapshot),
                ));
                break;
            }
        }
    }, [commitMenu, copySha, runMutation, setConfirmRequest, snapshot]);

    const tabContextActions = useMemo<ContextAction[]>(() => {
        if (!tabMenu) return [];
        const orderedTabs = workspaceTabs(workspace);
        const tabIndex = orderedTabs.findIndex((tab) => tab.id === tabMenu.tab.id);
        return [
            { id: "activate", label: "Activate repository", icon: <GitCommitHorizontal size={15} /> },
            {
                id: "move:ungrouped",
                label: tabMenu.groupId === null ? "No folder (current)" : "Move to no folder",
                icon: <FolderX size={15} />,
                disabled: tabMenu.groupId === null,
                separatorBefore: true,
            },
            ...workspace.groups.map((group) => ({
                id: `move:${group.id}`,
                label: group.id === tabMenu.groupId ? `${group.name} (current)` : `Move to ${group.name}`,
                icon: <FolderInput size={15} />,
                disabled: group.id === tabMenu.groupId,
            })),
            { id: "new_folder", label: "Move to new folder…", icon: <FolderPlus size={15} /> },
            { id: "alias", label: "Rename tab…", icon: <Tag size={15} />, separatorBefore: true },
            { id: "copy_path", label: "Copy repository path", icon: <Copy size={15} /> },
            { id: "close_others", label: "Close other repositories", icon: <X size={15} />, disabled: orderedTabs.length <= 1, separatorBefore: true },
            { id: "close_right", label: "Close repositories to the right", icon: <X size={15} />, disabled: tabIndex < 0 || tabIndex === orderedTabs.length - 1 },
            { id: "close", label: "Close repository", icon: <X size={15} /> },
        ];
    }, [workspace.groups, tabMenu]);

    const executeTabAction = useCallback((action: string) => {
        if (!tabMenu) return;
        const selectedTab = tabMenu.tab;
        setTabMenu(null);
        if (action === "activate") {
            setPersisted((current) => ({ ...current, workspace: { ...current.workspace, active_tab_id: selectedTab.id } }));
        } else if (action === "move:ungrouped") {
            moveRepositoryTab(selectedTab.id, null);
        } else if (action.startsWith("move:")) {
            moveRepositoryTab(selectedTab.id, action.slice("move:".length));
        } else if (action === "new_folder") {
            setPrompt({ kind: "create_group", tabId: selectedTab.id });
        } else if (action === "alias") {
            setPrompt({ kind: "alias_tab", tabId: selectedTab.id, current: selectedTab.label });
        } else if (action === "copy_path") {
            void navigator.clipboard.writeText(selectedTab.path)
                .then(() => addToast({ tone: "success", title: "Repository path copied" }))
                .catch((error) => showError("Could not copy repository path", error));
        } else if (action === "close_others") {
            workspaceTabs(workspace)
                .filter((tab) => tab.id !== selectedTab.id)
                .forEach((tab) => closeTab(tab.id));
            activateRepositoryTab(selectedTab.id);
        } else if (action === "close_right") {
            const tabs = workspaceTabs(workspace);
            const index = tabs.findIndex((tab) => tab.id === selectedTab.id);
            tabs.slice(index + 1).forEach((tab) => closeTab(tab.id));
        } else if (action === "close") {
            closeTab(selectedTab.id);
        }
    }, [activateRepositoryTab, addToast, closeTab, moveRepositoryTab, workspace, showError, tabMenu]);

    const checkoutRemoteBranch = useCallback((branch: BranchInfo) => {
        const localName = branchNameWithoutRemote(branch.name);
        void runMutation(`Checked out ${localName}`, (repository) => gitcatApi.checkoutBranch(repository.repository_id, localName));
    }, [runMutation]);

    const branchContextActions = useMemo<ContextAction[]>(() => {
        if (!branchMenu) return [];
        const { branch, scope } = branchMenu;
        const isLocal = scope === "local";
        const displayName = isLocal ? branch.name : branchNameWithoutRemote(branch.name);
        return [
            {
                id: "pull",
                label: PULL_LABELS[defaultPullMode],
                icon: <Download size={15} />,
                disabled: !branchAcceptsPull(snapshot, branch, scope),
            },
            {
                id: "push",
                label: "Push",
                icon: <Upload size={15} />,
                disabled: !branchPushTarget(snapshot, branch, scope),
            },
            { id: "create_branch", label: "Create branch here…", icon: <GitBranchPlus size={15} />, separatorBefore: true },
            { id: "rename", label: `Rename ${displayName}…`, icon: <Pencil size={15} />, disabled: !isLocal, separatorBefore: true },
            {
                id: "delete",
                label: `Delete ${displayName}…`,
                icon: <Trash2 size={15} />,
                danger: true,
                disabled: !isLocal || branch.is_head,
            },
            { id: "copy", label: "Copy branch name", icon: <Copy size={15} />, separatorBefore: true },
        ];
    }, [branchMenu, defaultPullMode, snapshot]);

    const executeBranchAction = useCallback((action: string) => {
        if (!branchMenu) return;
        const { branch, scope } = branchMenu;
        const isLocal = scope === "local";
        const displayName = isLocal ? branch.name : branchNameWithoutRemote(branch.name);
        setBranchMenu(null);
        switch (action) {
            case "pull":
                pullActiveRepository();
                break;
            case "push": {
                const target = branchPushTarget(snapshot, branch, scope);
                if (!target) break;
                void runMutation("Push complete", (repository) => gitcatApi.push(repository.repository_id, {
                    remote: target.remote,
                    branch: target.branch,
                    set_upstream: target.setUpstream,
                }));
                break;
            }
            case "create_branch":
                setPrompt({ kind: "create_branch", startOid: branch.oid });
                break;
            case "rename":
                if (isLocal) setPrompt({ kind: "rename_branch", branch });
                break;
            case "delete":
                if (isLocal) setConfirmRequest({ kind: "delete_branch", name: branch.name, force: false });
                break;
            case "copy":
                void navigator.clipboard.writeText(displayName)
                    .then(() => addToast({ tone: "success", title: "Branch name copied" }))
                    .catch((error) => showError("Could not copy branch name", error));
                break;
        }
    }, [addToast, branchMenu, pullActiveRepository, runMutation, showError, snapshot]);

    return {
        branchContextActions,
        checkoutRemoteBranch,
        contextActions,
        executeBranchAction,
        executeCommitAction,
        executeTabAction,
        tabContextActions,
    };
}
