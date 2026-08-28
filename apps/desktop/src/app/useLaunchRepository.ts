import { useEffect, useRef } from "react";

import { gitcatApi } from "../lib/api";

/** Payload of the `repository:open-request` event the backend emits. */
interface OpenRequest {
    path: string;
}

export interface LaunchRepositoryParams {
    initializing: boolean;
    openRepositoryPath: (path: string, targetTabId?: string | null) => Promise<void>;
}

/**
 * Opens the folder GitCat was asked to open from outside the application.
 *
 * The Windows Explorer context menu, which the installer offers to register,
 * runs GitCat with a folder on the command line. That happens both on a cold
 * start, where the folder waits in the backend until the workspace has been
 * restored, and while GitCat is already running, where a second launch hands
 * its folder to this window and exits.
 */
export function useLaunchRepository({ initializing, openRepositoryPath }: LaunchRepositoryParams) {
    const openRef = useRef(openRepositoryPath);
    useEffect(() => {
        openRef.current = openRepositoryPath;
    }, [openRepositoryPath]);

    // Waiting for the restore keeps the launch folder from racing the tabs that
    // are still opening, which would leave it fighting for the active tab.
    const collected = useRef(false);
    useEffect(() => {
        if (initializing || collected.current) return;
        collected.current = true;
        void (async () => {
            const path = await gitcatApi.launchRepositoryPath().catch(() => null);
            if (path) await openRef.current(path, null);
        })();
    }, [initializing]);

    useEffect(() => {
        if (gitcatApi.runtime !== "tauri") return;
        let unlisten: (() => void) | undefined;
        let disposed = false;
        void (async () => {
            const { listen } = await import("@tauri-apps/api/event");
            const stop = await listen<OpenRequest>(
                "repository:open-request",
                (event) => {
                    void openRef.current(event.payload.path, null);
                },
            );
            if (disposed) stop();
            else unlisten = stop;
        })();
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);
}
