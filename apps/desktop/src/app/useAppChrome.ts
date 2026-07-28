import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import { gitcatApi } from "../lib/api";
import type { AppMetadata, ConflictFileDetails } from "../lib/types";
import type { BranchMenuState, CommitMenuState, ConfirmState, PromptState, RuntimeRepository, TabMenuState } from "./state";

export interface AppChromeParams {
    activeRepository: RuntimeRepository | undefined;
    activeRepositoryIdRef: RefObject<string | null>;
    activeTabId: string | null;
    setBranchMenu: Dispatch<SetStateAction<BranchMenuState | null>>;
    setCommitMenu: Dispatch<SetStateAction<CommitMenuState | null>>;
    setConfirmRequest: Dispatch<SetStateAction<ConfirmState>>;
    setConflictEditor: Dispatch<SetStateAction<ConflictFileDetails | null>>;
    setPrompt: Dispatch<SetStateAction<PromptState>>;
    setStartDialog: Dispatch<SetStateAction<"clone" | "create" | null>>;
    setTabMenu: Dispatch<SetStateAction<TabMenuState | null>>;
}

export function useAppChrome({
    activeRepository,
    activeRepositoryIdRef,
    activeTabId,
    setBranchMenu,
    setCommitMenu,
    setConfirmRequest,
    setConflictEditor,
    setPrompt,
    setStartDialog,
    setTabMenu,
}: AppChromeParams) {
    const [appMetadata, setAppMetadata] = useState<AppMetadata>({ version: "unknown", commit: "unknown" });

    useEffect(() => {
        activeRepositoryIdRef.current = activeRepository?.repository_id ?? null;
    }, [activeRepository]);

    useEffect(() => {
        setPrompt(null);
        setStartDialog(null);
        setConfirmRequest(null);
        setCommitMenu(null);
        setTabMenu(null);
        setBranchMenu(null);
        setConflictEditor(null);
    }, [activeTabId]);

    useEffect(() => {
        const preventNativeContextMenu = (event: MouseEvent) => event.preventDefault();
        document.addEventListener("contextmenu", preventNativeContextMenu, true);
        return () => document.removeEventListener("contextmenu", preventNativeContextMenu, true);
    }, []);

    useEffect(() => {
        void gitcatApi.appMetadata()
            .then(setAppMetadata)
            .catch(() => undefined);
    }, []);

    return appMetadata;
}
