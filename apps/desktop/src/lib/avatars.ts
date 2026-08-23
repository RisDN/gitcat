import { invokeTauri, isTauriEnvironment } from "./platform";
import type {
    AvatarEntry,
    AvatarLookup,
    AvatarSettings,
    ForgeCredential,
    RemoteInfo,
} from "./types";

// Only the hosting services with a client behind them. Anything else keeps its
// drawn initial, so there is no point paying for a round trip.
export function remoteSupportsAvatars(remote: RemoteInfo | null | undefined): boolean {
    return remote?.forge === "github" && Boolean(remote.url?.owner && remote.url.repo);
}

export function avatarLookupFor(
    remote: RemoteInfo,
    emails: readonly string[],
    tipOid?: string | null,
): AvatarLookup | null {
    const { host, owner, repo } = remote.url ?? {};
    if (!host || !owner || !repo) return null;
    return {
        host,
        owner,
        repo,
        forge: remote.forge,
        ...(tipOid ? { tip_oid: tipOid } : {}),
        emails: [...emails],
    };
}

/**
 * Resolves author avatars through the backend, which owns the network access,
 * the credential and the cache. Outside Tauri there is no backend to ask.
 */
export async function resolveAvatars(
    lookup: AvatarLookup,
    settings: AvatarSettings,
): Promise<AvatarEntry[]> {
    if (!isTauriEnvironment() || !settings.enabled) return [];
    return invokeTauri<AvatarEntry[]>("avatars_resolve", { lookup, settings });
}

/** Which hosts hold a token. The token itself never comes back. */
export async function forgeCredentials(): Promise<ForgeCredential[]> {
    if (!isTauriEnvironment()) return [];
    return invokeTauri<ForgeCredential[]>("forge_credentials");
}

/** Stores a token for one host, or clears it when `token` is null. */
export async function setForgeToken(host: string, token: string | null): Promise<void> {
    if (!isTauriEnvironment()) return;
    await invokeTauri<void>("forge_token_set", { host, token });
}
