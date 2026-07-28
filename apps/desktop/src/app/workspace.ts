import { ALL_GRAPH_COLUMNS, GRAPH_COLUMNS, visibleGraphColumns } from "../lib/columns";
import { DEFAULT_KEYBINDS, duplicateKeybinds, keybindValidationError } from "../lib/keybinds";
import type { GraphColumnSettings, KeybindSettings, PersistedState, RepositoryTab } from "../lib/types";
import { DEFAULT_SETTINGS, RECENT_LIMIT } from "./defaults";

export function makeId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
}

export function workspaceTabs(state: PersistedState["workspace"]): RepositoryTab[] {
    return [
        ...(state.ungrouped_tabs ?? []),
        ...state.groups.flatMap((group) => group.tabs),
    ];
}

export function normalizePersistedKeybinds(
    keybinds: Partial<KeybindSettings> | undefined,
): KeybindSettings {
    const actions = Object.keys(DEFAULT_KEYBINDS) as (keyof KeybindSettings)[];
    const normalized = { ...DEFAULT_KEYBINDS };
    for (const action of actions) {
        const candidate = keybinds?.[action];
        normalized[action] = typeof candidate === "string" && !keybindValidationError(candidate)
            ? candidate
            : DEFAULT_KEYBINDS[action];
    }
    for (let pass = 0; pass < actions.length; pass += 1) {
        const duplicates = duplicateKeybinds(normalized);
        if (!duplicates.size) break;
        for (const action of duplicates) normalized[action] = DEFAULT_KEYBINDS[action];
    }
    return normalized;
}

function normalizeGraphColumns(columns: Partial<GraphColumnSettings> | undefined): GraphColumnSettings {
    const normalized = { ...ALL_GRAPH_COLUMNS };
    for (const { key } of GRAPH_COLUMNS) {
        const value = columns?.[key];
        if (typeof value === "boolean") normalized[key] = value;
    }
    return visibleGraphColumns(normalized).length ? normalized : { ...ALL_GRAPH_COLUMNS };
}

export function normalizePersistedState(state: PersistedState): PersistedState {
    const workspace: PersistedState["workspace"] = {
        version: 2,
        active_tab_id: state.workspace?.active_tab_id ?? null,
        groups: state.workspace?.groups ?? [],
        ungrouped_tabs: state.workspace?.ungrouped_tabs ?? [],
    };
    const recents = state.recents?.length
        ? state.recents
        : workspaceTabs(workspace)
            .filter((tab) => tab.kind !== "start")
            .map((tab) => ({ path: tab.repository_path, name: tab.display_name, opened_at: 0 }));
    return {
        settings: {
            ...DEFAULT_SETTINGS,
            ...state.settings,
            graph_columns: normalizeGraphColumns(state.settings?.graph_columns),
            keybinds: normalizePersistedKeybinds(state.settings?.keybinds),
            theme: { ...DEFAULT_SETTINGS.theme, ...state.settings?.theme },
        },
        workspace,
        recents: recents.slice(0, RECENT_LIMIT),
    };
}
