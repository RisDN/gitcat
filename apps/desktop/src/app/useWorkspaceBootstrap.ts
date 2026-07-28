import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

import { getApiError, gitcatApi } from "../lib/api";
import type { PersistedState } from "../lib/types";
import type { RuntimeRepository } from "./state";
import { applyTheme } from "./theme";
import { normalizePersistedState, workspaceTabs } from "./workspace";

export interface WorkspaceBootstrapParams {
    activeRepository: RuntimeRepository | undefined;
    activeTabId: string | null;
    activeTabKind: "start" | "repository" | undefined;
    activeTabPath: string | undefined;
    hydrated: boolean;
    initializing: boolean;
    openingTabsRef: RefObject<Set<string>>;
    persisted: PersistedState;
    setHydrated: Dispatch<SetStateAction<boolean>>;
    setInitializing: Dispatch<SetStateAction<boolean>>;
    setOpeningTabIds: Dispatch<SetStateAction<string[]>>;
    setPersisted: Dispatch<SetStateAction<PersistedState>>;
    setRuntime: Dispatch<SetStateAction<Record<string, RuntimeRepository>>>;
    setTabErrors: Dispatch<SetStateAction<Record<string, string>>>;
    showError: (title: string, error: unknown) => void;
}

export function useWorkspaceBootstrap({
    activeRepository,
    activeTabId,
    activeTabKind,
    activeTabPath,
    hydrated,
    initializing,
    openingTabsRef,
    persisted,
    setHydrated,
    setInitializing,
    setOpeningTabIds,
    setPersisted,
    setRuntime,
    setTabErrors,
    showError,
}: WorkspaceBootstrapParams) {
    const openStoredRepositories = useCallback(async (state: PersistedState) => {
        const tabs = workspaceTabs(state.workspace).filter((tab) => tab.kind !== "start");
        if (!tabs.length) return;
        const opened = await Promise.all(tabs.map(async (
            tab,
        ): Promise<{ tabId: string; repository?: RuntimeRepository; error?: string }> => {
            try {
                return { tabId: tab.id, repository: await gitcatApi.openRepository(tab.repository_path) };
            } catch (error) {
                return { tabId: tab.id, error: getApiError(error).message };
            }
        }));
        const next: Record<string, RuntimeRepository> = {};
        const failed: Record<string, string> = {};
        for (const result of opened) {
            if (result.repository) next[result.tabId] = result.repository;
            else failed[result.tabId] = result.error ?? "Repository could not be opened";
        }
        setRuntime(next);
        setTabErrors(failed);
        const preferred = state.workspace.active_tab_id;
        const preferredIsStartTab = workspaceTabs(state.workspace)
            .some((tab) => tab.id === preferred && tab.kind === "start");
        if (!preferred || (!next[preferred] && !preferredIsStartTab)) {
            const fallback = Object.keys(next)[0] ?? null;
            setPersisted((current) => ({ ...current, workspace: { ...current.workspace, active_tab_id: fallback } }));
        }
    }, []);

    const openTabRepository = useCallback(async (tabId: string, path: string) => {
        if (openingTabsRef.current.has(tabId)) return;
        openingTabsRef.current.add(tabId);
        setOpeningTabIds((current) => [...current, tabId]);
        try {
            const opened = await gitcatApi.openRepository(path);
            setRuntime((current) => ({ ...current, [tabId]: opened }));
            setTabErrors((current) => {
                if (!(tabId in current)) return current;
                const next = { ...current };
                delete next[tabId];
                return next;
            });
        } catch (error) {
            setTabErrors((current) => ({ ...current, [tabId]: getApiError(error).message }));
            showError("Repository could not be opened", error);
        } finally {
            openingTabsRef.current.delete(tabId);
            setOpeningTabIds((current) => current.filter((id) => id !== tabId));
        }
    }, [showError]);

    useEffect(() => {
        if (initializing || !activeTabId || activeRepository) return;
        if (!activeTabPath || activeTabKind === "start") return;
        void openTabRepository(activeTabId, activeTabPath);
    }, [activeRepository, activeTabId, activeTabKind, activeTabPath, initializing, openTabRepository]);

    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const state = normalizePersistedState(await gitcatApi.loadPersistedState());
                if (!alive) return;
                setPersisted(state);
                applyTheme(state.settings);
                await openStoredRepositories(state);
            } catch (error) {
                if (alive) showError("Could not load preferences", error);
            } finally {
                if (alive) {
                    setHydrated(true);
                    setInitializing(false);
                }
            }
        })();
        return () => { alive = false; };
    }, [openStoredRepositories, showError]);

    useEffect(() => {
        applyTheme(persisted.settings);
        if (!hydrated) return;
        const timer = window.setTimeout(() => {
            void gitcatApi.savePersistedState(persisted).catch((error) => showError("Could not save workspace", error));
        }, 250);
        return () => window.clearTimeout(timer);
    }, [hydrated, persisted, showError]);

    return { openTabRepository };
}
