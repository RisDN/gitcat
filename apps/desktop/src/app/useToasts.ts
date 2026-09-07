import { useCallback, useRef, useState } from "react";

import type { ToastMessage } from "../components/ToastRegion";
import { getApiError } from "../lib/api";
import { makeId } from "./workspace";

// What each recovery action a failure can carry actually does. The handlers
// come from the repository commands, which are built further down the tree
// than the toasts they report into, so they are registered rather than passed.
export type RecoveryHandlers = Record<string, (() => void) | undefined>;

export function useToasts() {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const recoveryHandlers = useRef<RecoveryHandlers>({});

    const addToast = useCallback((toast: Omit<ToastMessage, "id">) => {
        const id = makeId("toast");
        setToasts((current) => [...current.slice(-3), { ...toast, id }]);
        // A toast offering a next step waits for the user to take it or dismiss
        // it; only a toast that is purely a report expires on its own.
        if (!toast.actions?.length) {
            window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5000);
        }
    }, []);

    const registerRecoveryHandlers = useCallback((handlers: RecoveryHandlers) => {
        recoveryHandlers.current = handlers;
    }, []);

    const showError = useCallback((title: string, error: unknown) => {
        const apiError = getApiError(error);
        const details = apiError.details?.replace(/^(exit code \d+|terminated):\s*/i, "");
        const fileRemovalBusy = apiError.message === "Some files could not be removed because another process is using them";
        const detail = fileRemovalBusy
            ? apiError.message
            : apiError.details
            ? `${apiError.message}\n${details}`
            : apiError.message;
        // An action whose kind nothing here handles is dropped: a button that
        // does nothing is worse than no button.
        const actions = (apiError.recovery_actions ?? [])
            .map((action) => {
                const run = recoveryHandlers.current[action.kind];
                return run ? { label: action.label, run } : null;
            })
            .filter((action) => action !== null);
        addToast({ tone: "error", title, detail, actions });
    }, [addToast]);

    const dismissToast = useCallback((id: string) => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    return { addToast, dismissToast, registerRecoveryHandlers, showError, toasts };
}
