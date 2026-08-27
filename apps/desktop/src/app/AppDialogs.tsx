import type { Dispatch, SetStateAction } from "react";

import { ConflictResolverDialog } from "../components/conflict";
import { ContextMenu, type ContextAction } from "../components/ContextMenu";
import { PromptDialog } from "../components/PromptDialog";
import { SettingsDialog } from "../components/settings";
import { CloneDialog, CreateDialog } from "../components/start-page";
import { ToastRegion, type ToastMessage } from "../components/ToastRegion";
import { gitcatApi } from "../lib/api";
import type { AppSettings, CloneOptions, ConflictFileDetails, ForgeKind, NewRepository, PersistedState, RepositorySnapshot, RepositoryTab } from "../lib/types";
import { currentBranch } from "./branches";
import { DEFAULT_SETTINGS } from "./defaults";
import type { BranchMenuState, CommitMenuState, PromptState, RunMutation, TabMenuState } from "./state";

export interface AppDialogsProps {
    activeTab: RepositoryTab | undefined;
    branchContextActions: ContextAction[];
    branchMenu: BranchMenuState | null;
    busy: boolean;
    cloneRepository: (options: CloneOptions, targetTabId: string | null) => Promise<void>;
    commitMenu: CommitMenuState | null;
    conflictEditor: ConflictFileDetails | null;
    contextActions: ContextAction[];
    createRepository: (path: string, defaultBranch: string, ignorePatterns: string[], remote: NewRepository | null, targetTabId: string | null) => Promise<void>;
    dismissToast: (id: string) => void;
    executeBranchAction: (action: string) => void;
    executeCommitAction: (action: string) => void;
    executeTabAction: (action: string) => void;
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
    runMutation: RunMutation;
    setBranchMenu: Dispatch<SetStateAction<BranchMenuState | null>>;
    setCommitMenu: Dispatch<SetStateAction<CommitMenuState | null>>;
    setConflictEditor: Dispatch<SetStateAction<ConflictFileDetails | null>>;
    setPersisted: Dispatch<SetStateAction<PersistedState>>;
    setPrompt: Dispatch<SetStateAction<PromptState>>;
    setSettingsOpen: Dispatch<SetStateAction<boolean>>;
    setStartDialog: Dispatch<SetStateAction<"clone" | "create" | null>>;
    setTabMenu: Dispatch<SetStateAction<TabMenuState | null>>;
    settings: AppSettings;
    settingsOpen: boolean;
    snapshot: RepositorySnapshot | null;
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
    conflictEditor,
    contextActions,
    createRepository,
    dismissToast,
    executeBranchAction,
    executeCommitAction,
    executeTabAction,
    prompt,
    promptConfig,
    runMutation,
    setBranchMenu,
    setCommitMenu,
    setConflictEditor,
    setPersisted,
    setPrompt,
    setSettingsOpen,
    setStartDialog,
    setTabMenu,
    settings,
    settingsOpen,
    snapshot,
    startDialog,
    submitPrompt,
    tabContextActions,
    tabMenu,
    toasts,
}: AppDialogsProps) {
    // Naming a self-hosted install is what tells the rest of GitCat which
    // service answers there, so a host named while cloning or initializing is
    // saved straight away rather than only inside the preferences draft.
    const nameHost = (host: string, forge: ForgeKind) => {
        setPersisted((current) => ({
            ...current,
            settings: {
                ...current.settings,
                forge_overrides: { ...current.settings.forge_overrides, [host]: forge },
            },
        }));
    };

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
                    onClose={() => { if (!busy) setStartDialog(null); }}
                    onNameHost={nameHost}
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
                    onClose={() => { if (!busy) setStartDialog(null); }}
                    onNameHost={nameHost}
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
            {conflictEditor && snapshot ? (
                <ConflictResolverDialog
                    branchName={currentBranch(snapshot)}
                    busy={busy}
                    details={conflictEditor}
                    onClose={() => { if (!busy) setConflictEditor(null); }}
                    onResolve={(resolution) => {
                        const current = conflictEditor;
                        void runMutation("Conflict resolved", (repository) => gitcatApi.resolveConflict(
                            repository.repository_id,
                            current.path,
                            resolution,
                            current.expected_state,
                        )).then((success) => { if (success) setConflictEditor(null); });
                    }}
                    onSave={(text, lineEnding) => {
                        const current = conflictEditor;
                        void runMutation("Conflict result saved", (repository) => gitcatApi.saveConflictResult(
                            repository.repository_id,
                            current.path,
                            text,
                            lineEnding,
                            current.expected_state,
                        )).then((success) => { if (success) setConflictEditor(null); });
                    }}
                    operation={snapshot.operation_state}
                />
            ) : null}
            {commitMenu ? <ContextMenu actions={contextActions} onAction={executeCommitAction} onClose={() => setCommitMenu(null)} x={commitMenu.x} y={commitMenu.y} /> : null}
            {tabMenu ? <ContextMenu actions={tabContextActions} onAction={executeTabAction} onClose={() => setTabMenu(null)} x={tabMenu.x} y={tabMenu.y} /> : null}
            {branchMenu ? <ContextMenu actions={branchContextActions} onAction={executeBranchAction} onClose={() => setBranchMenu(null)} x={branchMenu.x} y={branchMenu.y} /> : null}
            <ToastRegion onDismiss={dismissToast} toasts={toasts} />
        </>
    );
}
