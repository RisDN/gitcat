import { useCallback, useState } from "react";

import type { ToastMessage } from "../components/ToastRegion";
import { getApiError } from "../lib/api";
import { makeId } from "./workspace";

export function useToasts() {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const addToast = useCallback((toast: Omit<ToastMessage, "id">) => {
        const id = makeId("toast");
        setToasts((current) => [...current.slice(-3), { ...toast, id }]);
        window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5000);
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
        addToast({ tone: "error", title, detail });
    }, [addToast]);

    const dismissToast = useCallback((id: string) => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    return { addToast, dismissToast, showError, toasts };
}
