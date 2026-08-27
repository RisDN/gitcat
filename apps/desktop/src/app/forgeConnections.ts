import { useEffect, useSyncExternalStore } from "react";

import { forgeCredentials, setForgeToken } from "../lib/avatars";
import { forgeSignOut, pollForgeLogin, startForgeLogin } from "../lib/forgeAuth";
import { isTauriEnvironment, openExternal } from "../lib/platform";
import type { DeviceAuthorization, ForgeCredential } from "../lib/types";

export interface ForgeNotice {
    host: string;
    tone: "success" | "error";
    message: string;
}

export interface ForgeConnections {
    credentials: readonly ForgeCredential[];
    /** A device-flow sign-in waiting for the user, or `null`. */
    pending: DeviceAuthorization | null;
    notice: ForgeNotice | null;
    loaded: boolean;
}

/**
 * Which hosting services are connected, and the sign-in in flight.
 *
 * This lives outside the React tree on purpose. A device-flow sign-in takes as
 * long as the user takes on the service's own page, and it used to be owned by
 * the preferences dialog: closing the dialog dropped the polling and the
 * granted token was never collected. The store keeps polling regardless of
 * which dialog is open, or whether any is.
 */
let state: ForgeConnections = { credentials: [], pending: null, notice: null, loaded: false };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function publish(next: Partial<ForgeConnections>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Reads the stored credentials again. An unreadable store reads as none. */
export async function reloadForgeConnections(): Promise<void> {
    if (!isTauriEnvironment()) {
        publish({ loaded: true });
        return;
    }
    try {
        publish({ credentials: await forgeCredentials(), loaded: true });
    } catch {
        publish({ loaded: true });
    }
}

/**
 * Starts a device-flow sign-in and follows it to its end.
 *
 * Only one runs at a time: the code has to be typed somewhere before it is
 * worth showing another.
 */
export async function connectForge(host: string): Promise<void> {
    const target = host.trim().toLowerCase();
    if (!target || state.pending) return;
    publish({ notice: null });

    let authorization: DeviceAuthorization;
    try {
        authorization = await startForgeLogin(target);
    } catch (error) {
        publish({ notice: { host: target, tone: "error", message: message(error) } });
        return;
    }

    publish({ pending: authorization });
    // The code is useless without the page it goes into, so the page opens
    // with it. It stays on screen either way: a browser may refuse to open,
    // and the user may want to finish on another device.
    void openExternal(authorization.verification_uri).catch(() => undefined);
    await follow(authorization);
}

/** Polls at the interval the service asked for until it answers or expires. */
async function follow(authorization: DeviceAuthorization): Promise<void> {
    const deadline = Date.now() + authorization.expires_in_seconds * 1000;
    const wait = Math.max(authorization.interval_seconds, 1) * 1000;
    const abandoned = () => state.pending !== authorization;

    while (!abandoned() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        if (abandoned()) return;

        let poll;
        try {
            poll = await pollForgeLogin(authorization.host);
        } catch (error) {
            publish({ pending: null, notice: { host: authorization.host, tone: "error", message: message(error) } });
            return;
        }
        if (abandoned()) return;

        if (poll.state === "complete") {
            publish({
                pending: null,
                notice: {
                    host: authorization.host,
                    tone: "success",
                    message: poll.account
                        ? `Connected to ${authorization.host} as ${poll.account.login}.`
                        : `Connected to ${authorization.host}.`,
                },
            });
            await reloadForgeConnections();
            return;
        }
        if (poll.state === "denied" || poll.state === "expired") {
            publish({
                pending: null,
                notice: {
                    host: authorization.host,
                    tone: "error",
                    message: poll.state === "denied"
                        ? "The sign-in was refused on the verification page."
                        : "The code expired before it was entered. Start again.",
                },
            });
            return;
        }
        // Still pending: the backend raises the interval when the service asks
        // it to, so a slow answer is not an error.
    }

    if (!abandoned()) {
        publish({ pending: null, notice: { host: authorization.host, tone: "error", message: "The code expired. Start again." } });
    }
}

/** Drops a sign-in the user gave up on. The code expires on its own. */
export function cancelForgeSignIn(): void {
    if (state.pending) publish({ pending: null });
}

export async function disconnectForge(host: string): Promise<void> {
    try {
        await forgeSignOut(host);
        await reloadForgeConnections();
        publish({ notice: { host, tone: "success", message: `Disconnected from ${host}.` } });
    } catch (error) {
        publish({ notice: { host, tone: "error", message: message(error) } });
    }
}

/** Stores a token for one host, or clears it when `token` is null. */
export async function storeForgeToken(host: string, token: string | null): Promise<void> {
    try {
        await setForgeToken(host, token);
        await reloadForgeConnections();
        publish({
            notice: {
                host,
                tone: "success",
                message: token ? `Connected to ${host} with a token.` : `Token removed for ${host}.`,
            },
        });
    } catch (error) {
        publish({ notice: { host, tone: "error", message: message(error) } });
    }
}

export function dismissForgeNotice(): void {
    if (state.notice) publish({ notice: null });
}

/**
 * The connection state, loaded on first use. Every component reads the same
 * store, so connecting in one dialog shows up in the others straight away.
 */
export function useForgeConnections(): ForgeConnections {
    const connections = useSyncExternalStore(subscribe, () => state);
    useEffect(() => {
        if (state.loaded || loading) return;
        loading = reloadForgeConnections().finally(() => { loading = null; });
    }, []);
    return connections;
}

/** The credential held for one host, if there is one. */
export function credentialFor(
    connections: ForgeConnections,
    host: string,
): ForgeCredential | undefined {
    const target = host.trim().toLowerCase();
    return connections.credentials.find((credential) => credential.host.toLowerCase() === target);
}
