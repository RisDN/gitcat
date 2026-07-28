import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { ToastMessage } from "../components/ToastRegion";
import type { CommitDraft } from "../components/worktree";
import { gitcatApi } from "../lib/api";
import { chooseDirectory } from "../lib/platform";
import type {
    CloneOptions,
    OpenedRepository,
    PersistedState,
    RecentRepository,
    RepositoryTab,
} from "../lib/types";
import { RECENT_LIMIT } from "./defaults";
import type { RuntimeRepository } from "./state";
import { makeId, workspaceTabs } from "./workspace";

export interface RepositoryTabsParams {
    addToast: (toast: Omit<ToastMessage, "id">) => void;
    busy: boolean;
    closedTabsRef: RefObject<RepositoryTab[]>;
    runtime: Record<string, RuntimeRepository>;
    setBusy: Dispatch<SetStateAction<boolean>>;
    setCommitDrafts: Dispatch<SetStateAction<Record<string, CommitDraft>>>;
    setPersisted: Dispatch<SetStateAction<PersistedState>>;
    setRuntime: Dispatch<SetStateAction<Record<string, RuntimeRepository>>>;
    setTabErrors: Dispatch<SetStateAction<Record<string, string>>>;
    showError: (title: string, error: unknown) => void;
    workspace: PersistedState["workspace"];
    workspaceRef: RefObject<PersistedState["workspace"]>;
}

export function useRepositoryTabs({
    addToast,
    busy,
    closedTabsRef,
    runtime,
    setBusy,
    setCommitDrafts,
    setPersisted,
    setRuntime,
    setTabErrors,
    showError,
    workspace,
    workspaceRef,
}: RepositoryTabsParams) {
    const adoptRepository = useCallback((opened: OpenedRepository, targetTabId: string | null) => {
        const tabId = targetTabId ?? makeId("tab");
        setRuntime((current) => ({ ...current, [tabId]: opened }));
        setTabErrors((current) => {
            if (!(tabId in current)) return current;
            const next = { ...current };
            delete next[tabId];
            return next;
        });
        setPersisted((current) => {
            const filled = (tab: RepositoryTab): RepositoryTab => (
                tab.id === tabId
                    ? {
                        ...tab,
                        kind: "repository",
                        repository_path: opened.info.root,
                        display_name: opened.info.name,
                    }
                    : tab
            );
            const reused = workspaceTabs(current.workspace).some((tab) => tab.id === tabId);
            const workspace = reused
                ? {
                    ...current.workspace,
                    ungrouped_tabs: current.workspace.ungrouped_tabs.map(filled),
                    groups: current.workspace.groups.map((group) => ({ ...group, tabs: group.tabs.map(filled) })),
                    active_tab_id: tabId,
                }
                : {
                    ...current.workspace,
                    ungrouped_tabs: [
                        ...current.workspace.ungrouped_tabs,
                        {
                            id: tabId,
                            repository_path: opened.info.root,
                            display_name: opened.info.name,
                            order: current.workspace.ungrouped_tabs.length,
                            kind: "repository" as const,
                        },
                    ],
                    active_tab_id: tabId,
                };
            const recent: RecentRepository = {
                path: opened.info.root,
                name: opened.info.name,
                opened_at: Date.now(),
            };
            return {
                ...current,
                workspace,
                recents: [recent, ...current.recents.filter((entry) => entry.path !== recent.path)]
                    .slice(0, RECENT_LIMIT),
            };
        });
    }, []);

    const forgetRecentRepository = useCallback((path: string) => {
        setPersisted((current) => ({
            ...current,
            recents: current.recents.filter((entry) => entry.path !== path),
        }));
    }, []);

    const openRepositoryPath = useCallback(async (path: string, targetTabId: string | null = null) => {
        if (busy) return;
        const existing = workspaceTabs(workspace)
            .find((tab) => tab.kind !== "start" && tab.repository_path === path);
        if (existing) {
            setPersisted((current) => {
                const drop = (tabs: RepositoryTab[]) => tabs.filter((tab) => tab.id !== targetTabId);
                return {
                    ...current,
                    workspace: {
                        ...current.workspace,
                        ungrouped_tabs: drop(current.workspace.ungrouped_tabs),
                        groups: current.workspace.groups.map((group) => ({
                            ...group,
                            collapsed: group.tabs.some((tab) => tab.id === existing.id) ? false : group.collapsed,
                            tabs: drop(group.tabs),
                        })),
                        active_tab_id: existing.id,
                    },
                };
            });
            return;
        }
        setBusy(true);
        try {
            adoptRepository(await gitcatApi.openRepository(path), targetTabId);
        } catch (error) {
            showError("Repository could not be opened", error);
        } finally {
            setBusy(false);
        }
    }, [adoptRepository, busy, workspace, showError]);

    const chooseRepository = useCallback(async (targetTabId: string | null = null) => {
        if (busy) return;
        try {
            let path = "C:\\Users\\demo\\aurora-engine";
            if (gitcatApi.runtime === "tauri") {
                const selected = await chooseDirectory("Open Git repository");
                if (!selected) return;
                path = selected;
            }
            await openRepositoryPath(path, targetTabId);
        } catch (error) {
            showError("Repository could not be opened", error);
        }
    }, [busy, openRepositoryPath, showError]);

    const cloneRepository = useCallback(async (options: CloneOptions, targetTabId: string | null) => {
        if (busy) return;
        setBusy(true);
        try {
            const opened = await gitcatApi.cloneRepository(options);
            adoptRepository(opened, targetTabId);
            addToast({ tone: "success", title: "Repository cloned", detail: opened.info.root });
        } catch (error) {
            showError("Clone failed", error);
        } finally {
            setBusy(false);
        }
    }, [addToast, adoptRepository, busy, showError]);

    const createRepository = useCallback(async (
        path: string,
        defaultBranch: string,
        ignorePatterns: string[],
        targetTabId: string | null,
    ) => {
        if (busy) return;
        setBusy(true);
        try {
            const opened = await gitcatApi.initRepository(path, defaultBranch);
            if (ignorePatterns.length) {
                await gitcatApi.appendGitignore(opened.repository_id, ignorePatterns);
            }
            adoptRepository(opened, targetTabId);
            addToast({ tone: "success", title: "Repository created", detail: opened.info.root });
        } catch (error) {
            showError("Create repository failed", error);
        } finally {
            setBusy(false);
        }
    }, [addToast, adoptRepository, busy, showError]);

    const openStartTab = useCallback(() => {
        if (busy) return;
        const tabId = makeId("tab");
        setPersisted((current) => ({
            ...current,
            workspace: {
                ...current.workspace,
                ungrouped_tabs: [
                    ...current.workspace.ungrouped_tabs,
                    {
                        id: tabId,
                        repository_path: "",
                        display_name: "New Tab",
                        order: current.workspace.ungrouped_tabs.length,
                        kind: "start" as const,
                    },
                ],
                active_tab_id: tabId,
            },
        }));
    }, [busy]);

    const closeTab = useCallback((tabId: string) => {
        if (busy) return;
        const closedTab = workspaceTabs(workspaceRef.current)
            .find((tab) => tab.id === tabId && tab.kind !== "start");
        if (closedTab) {
            closedTabsRef.current = [
                ...closedTabsRef.current.filter((tab) => tab.repository_path !== closedTab.repository_path),
                closedTab,
            ].slice(-20);
        }
        const repository = runtime[tabId];
        if (repository) void gitcatApi.closeRepository(repository.repository_id).catch(() => undefined);
        setRuntime((current) => {
            const next = { ...current };
            delete next[tabId];
            return next;
        });
        setTabErrors((current) => {
            if (!(tabId in current)) return current;
            const next = { ...current };
            delete next[tabId];
            return next;
        });
        setCommitDrafts((current) => {
            if (!(tabId in current)) return current;
            const next = { ...current };
            delete next[tabId];
            return next;
        });
        setPersisted((current) => {
            const groups = current.workspace.groups.map((group) => ({ ...group, tabs: group.tabs.filter((tab) => tab.id !== tabId) }));
            const ungrouped_tabs = current.workspace.ungrouped_tabs.filter((tab) => tab.id !== tabId);
            const remaining = [...ungrouped_tabs, ...groups.flatMap((group) => group.tabs)];
            const active = current.workspace.active_tab_id === tabId ? remaining[0]?.id ?? null : current.workspace.active_tab_id;
            return { ...current, workspace: { ...current.workspace, ungrouped_tabs, groups, active_tab_id: active } };
        });
    }, [busy, runtime]);

    const reopenClosedRepository = useCallback(async () => {
        if (busy) return;
        let restore: RepositoryTab | undefined;
        while (closedTabsRef.current.length) {
            const candidate = closedTabsRef.current[closedTabsRef.current.length - 1];
            closedTabsRef.current = closedTabsRef.current.slice(0, -1);
            if (!workspaceTabs(workspaceRef.current).some((tab) => tab.repository_path === candidate.repository_path)) {
                restore = candidate;
                break;
            }
        }
        if (!restore) return;
        setBusy(true);
        try {
            const opened: OpenedRepository = await gitcatApi.openRepository(restore.repository_path);
            const tab: RepositoryTab = { ...restore, id: makeId("tab"), repository_path: opened.info.root, order: 0 };
            setRuntime((current) => ({ ...current, [tab.id]: opened }));
            setPersisted((current) => {
                const ungrouped_tabs = [
                    ...current.workspace.ungrouped_tabs,
                    { ...tab, order: current.workspace.ungrouped_tabs.length },
                ];
                return { ...current, workspace: { ...current.workspace, ungrouped_tabs, active_tab_id: tab.id } };
            });
        } catch (error) {
            showError("Repository could not be reopened", error);
        } finally {
            setBusy(false);
        }
    }, [busy, showError]);

    const moveRepositoryTab = useCallback((tabId: string, groupId: string | null) => {
        setPersisted((current) => {
            let moved = current.workspace.ungrouped_tabs.find((tab) => tab.id === tabId);
            const ungroupedWithout = current.workspace.ungrouped_tabs.filter((tab) => tab.id !== tabId);
            const groupsWithout = current.workspace.groups.map((group) => ({
                ...group,
                tabs: group.tabs.filter((tab) => {
                    if (tab.id === tabId) moved = tab;
                    return tab.id !== tabId;
                }),
            }));
            const movedTab = moved;
            if (!movedTab) return current;
            if (groupId === null) {
                const ungrouped_tabs = [...ungroupedWithout, { ...movedTab, order: ungroupedWithout.length }];
                return { ...current, workspace: { ...current.workspace, ungrouped_tabs, groups: groupsWithout } };
            }
            const groups = groupsWithout.map((group) => group.id === groupId
                ? { ...group, collapsed: false, tabs: [...group.tabs, { ...movedTab, order: group.tabs.length }] }
                : group);
            return { ...current, workspace: { ...current.workspace, ungrouped_tabs: ungroupedWithout, groups } };
        });
    }, []);

    return {
        adoptRepository,
        chooseRepository,
        cloneRepository,
        closeTab,
        createRepository,
        forgetRecentRepository,
        moveRepositoryTab,
        openRepositoryPath,
        openStartTab,
        reopenClosedRepository,
    };
}
