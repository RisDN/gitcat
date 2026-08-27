import { invokeTauri, isTauriEnvironment } from "./platform";
import type {
    DeviceAuthorization,
    ForgeAccount,
    ForgeRepository,
    LoginPoll,
} from "./types";

/**
 * Signing in to a hosting service. The backend owns the flow: it holds the
 * device code, exchanges it for a token, and puts the token in the operating
 * system credential store. Only what the user has to read ever comes back.
 */
export async function startForgeLogin(host: string): Promise<DeviceAuthorization> {
    if (!isTauriEnvironment()) {
        throw new Error("Signing in is only possible in the desktop application.");
    }
    return invokeTauri<DeviceAuthorization>("forge_login_start", { host });
}

/** Asks once whether the user has finished authorising. */
export async function pollForgeLogin(host: string): Promise<LoginPoll> {
    if (!isTauriEnvironment()) return { state: "expired" };
    return invokeTauri<LoginPoll>("forge_login_poll", { host });
}

export async function forgeSignOut(host: string): Promise<void> {
    if (!isTauriEnvironment()) return;
    await invokeTauri<void>("forge_sign_out", { host });
}

/** The account a stored credential belongs to, or null when there is none. */
export async function forgeAccount(host: string): Promise<ForgeAccount | null> {
    if (!isTauriEnvironment()) return null;
    return (await invokeTauri<ForgeAccount | null>("forge_account", { host })) ?? null;
}

/**
 * Every repository the signed-in account can reach. The whole list comes back
 * at once because it is searched in the webview: a request per keystroke would
 * spend the rate limit on typing.
 */
export async function forgeRepositories(
    host: string,
    refresh = false,
): Promise<ForgeRepository[]> {
    if (!isTauriEnvironment()) return [];
    return invokeTauri<ForgeRepository[]>("forge_repositories", { host, refresh });
}
