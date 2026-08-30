import type { Dispatch, SetStateAction } from "react";

import { ContextMenu, type ContextAction } from "../components/ContextMenu";
import { PromptDialog } from "../components/PromptDialog";
import { SettingsDialog } from "../components/settings";
import { CloneDialog, CreateDialog } from "../components/start-page";
import { ToastRegion, type ToastMessage } from "../components/ToastRegion";
import type { AppSettings, CloneOptions, NewRepository, PersistedState, RepositoryTab } from "../lib/types";
import { DEFAULT_SETTINGS } from "./defaults";
import type { BranchMenuState, CommitMenuState, PromptState, TabMenuState } from "./state";

export interface AppDialogsProps {
    activeTab: RepositoryTab | undefined;
    branchContextActions: ContextAction[];
    branchMenu: BranchMenuState | null;
    busy: boolean;
    cloneRepository: (options: CloneOptions, targetTabId: string | null) => Promise<void>;
    commitMenu: CommitMenuState | null;
    contextActions: ContextAction[];
    createRepository: (path: string, defaultBranch: string, ignorePatterns: string[], remote: NewRepository | null, targetTabId: string | null) => Promise<void>;
    dismissToast: (id: string) => void;
    executeBranchAction: (action: string) => void;
    executeCommitAction: (action: string) => void;
    executeTabAction: (action: string) => void;
    lastDirectory: string | null;
    prompt: PromptState;
    promptConfig: {
        title: string;
        label: string;
        placeholder?: string;
        initialValue?: string;
        secondaryLabel?: string;
        secondaryPlaceholder?: string;
        secondaryRequired?: boolean;
        confirmLabel: string;
    } | null | undefined;
    setBranchMenu: Dispatch<SetStateAction<BranchMenuState | null>>;
    setCommitMenu: Dispatch<SetStateAction<CommitMenuState | null>>;
    setPersisted: Dispatch<SetStateAction<PersistedState>>;
    setPrompt: Dispatch<SetStateAction<PromptState>>;
    setSettingsOpen: Dispatch<SetStateAction<boolean>>;
    setStartDialog: Dispatch<SetStateAction<"clone" | "create" | null>>;
    setTabMenu: Dispatch<SetStateAction<TabMenuState | null>>;
    settings: AppSettings;
    settingsOpen: boolean;
    startDialog: "clone" | "create" | null;
    submitPrompt: (value: string, secondaryValue?: string) => void;
    tabContextActions: ContextAction[];
    tabMenu: TabMenuState | null;
    toasts: ToastMessage[];
}

export function AppDialogs({
    activeTab,
    branchContextActions,
    branchMenu,
    busy,
    cloneRepository,
    commitMenu,
    contextActions,
    createRepository,
    dismissToast,
    executeBranchAction,
    executeCommitAction,
    executeTabAction,
    lastDirectory,
    prompt,
    promptConfig,
    setBranchMenu,
    setCommitMenu,
    setPersisted,
    setPrompt,
    setSettingsOpen,
    setStartDialog,
    setTabMenu,
    settings,
    settingsOpen,
    startDialog,
    submitPrompt,
    tabContextActions,
    tabMenu,
    toasts,
}: AppDialogsProps) {
    return (
        <>
            {settingsOpen ? (
                <SettingsDialog
                    defaults={DEFAULT_SETTINGS}
                    onClose={() => setSettingsOpen(false)}
                    onSave={(settings) => { setPersisted((current) => ({ ...current, settings })); setSettingsOpen(false); }}
                    settings={settings}
                />
            ) : null}
            {prompt && promptConfig ? <PromptDialog {...promptConfig} onClose={() => setPrompt(null)} onConfirm={submitPrompt} /> : null}
            {startDialog === "clone" ? (
                <CloneDialog
                    busy={busy}
                    lastDirectory={lastDirectory}
                    onClose={() => { if (!busy) setStartDialog(null); }}
                    overrides={settings.forge_overrides}
                    onSubmit={(options) => {
                        setStartDialog(null);
                        void cloneRepository(options, activeTab?.kind === "start" ? activeTab.id : null);
                    }}
                />
            ) : null}
            {startDialog === "create" ? (
                <CreateDialog
                    busy={busy}
                    lastDirectory={lastDirectory}
                    onClose={() => { if (!busy) setStartDialog(null); }}
                    onSubmit={(path, defaultBranch, ignorePatterns, remote) => {
                        setStartDialog(null);
                        void createRepository(
                            path,
                            defaultBranch,
                            ignorePatterns,
                            remote,
                            activeTab?.kind === "start" ? activeTab.id : null,
                        );
                    }}
                    overrides={settings.forge_overrides}
                />
            ) : null}
            {commitMenu ? <ContextMenu actions={contextActions} onAction={executeCommitAction} onClose={() => setCommitMenu(null)} x={commitMenu.x} y={commitMenu.y} /> : null}
            {tabMenu ? <ContextMenu actions={tabContextActions} onAction={executeTabAction} onClose={() => setTabMenu(null)} x={tabMenu.x} y={tabMenu.y} /> : null}
            {branchMenu ? <ContextMenu actions={branchContextActions} onAction={executeBranchAction} onClose={() => setBranchMenu(null)} x={branchMenu.x} y={branchMenu.y} /> : null}
            <ToastRegion onDismiss={dismissToast} toasts={toasts} />
        </>
    );
}
