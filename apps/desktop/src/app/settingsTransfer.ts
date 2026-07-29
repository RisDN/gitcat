import type { AppSettings } from "../lib/types";
import { isTauriEnvironment, invokeTauri } from "../lib/platform";
import { normalizeAppSettings } from "./workspace";

const SETTINGS_FORMAT = "gitcat-settings";
const SETTINGS_VERSION = 1;
const MAX_BROWSER_IMPORT_BYTES = 4 * 1024 * 1024;

interface SettingsDocument {
    format: typeof SETTINGS_FORMAT;
    version: typeof SETTINGS_VERSION;
    settings: AppSettings;
}

function exportName(): string {
    return `gitcat-settings-${new Date().toISOString().slice(0, 10)}.json`;
}

function makeDocument(settings: AppSettings): SettingsDocument {
    return { format: SETTINGS_FORMAT, version: SETTINGS_VERSION, settings };
}

export async function exportSettings(settings: AppSettings): Promise<string | null> {
    const name = exportName();
    if (isTauriEnvironment()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const destination = await save({
            defaultPath: name,
            filters: [{ name: "GitCat settings", extensions: ["json"] }],
            title: "Export GitCat settings",
        });
        if (!destination) return null;
        await invokeTauri<void>("settings_export", { settings, destination });
        return destination;
    }

    const blob = new Blob([JSON.stringify(makeDocument(settings), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return name;
}

export async function importSettingsFromDialog(): Promise<{ settings: AppSettings; source: string } | null> {
    if (!isTauriEnvironment()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const source = await open({
        directory: false,
        filters: [{ name: "GitCat settings", extensions: ["json"] }],
        multiple: false,
        title: "Import GitCat settings",
    });
    if (typeof source !== "string") return null;
    const settings = await invokeTauri<AppSettings>("settings_import", { source });
    return { settings: normalizeAppSettings(settings), source };
}

export function parseSettingsFile(text: string, size: number): AppSettings {
    if (size > MAX_BROWSER_IMPORT_BYTES) {
        throw new Error("Settings import must be no larger than 4 MiB");
    }
    let document: unknown;
    try {
        document = JSON.parse(text);
    } catch {
        throw new Error("Settings import is not valid JSON");
    }
    if (!document || typeof document !== "object") {
        throw new Error("Settings import has an invalid structure");
    }
    const candidate = document as Record<string, unknown>;
    if ("format" in candidate && candidate.format !== SETTINGS_FORMAT) {
        throw new Error("Settings import format is not supported");
    }
    if ("version" in candidate && candidate.version !== SETTINGS_VERSION) {
        throw new Error("Settings import version is not supported");
    }
    if ("format" in candidate && !("settings" in candidate)) {
        throw new Error("Settings import has an invalid structure");
    }
    return normalizeAppSettings(candidate.settings ?? candidate);
}
