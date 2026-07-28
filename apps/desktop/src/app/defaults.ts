import { ALL_GRAPH_COLUMNS } from "../lib/columns";
import { DEFAULT_KEYBINDS } from "../lib/keybinds";
import type { AppSettings, PersistedState } from "../lib/types";
import type { CommitDraft } from "../components/worktree";

export const DEFAULT_SETTINGS: AppSettings = {
    default_pull_mode: "merge",
    auto_fetch_interval_minutes: 1,
    auto_prune: true,
    history_page_size: 200,
    diff_context_lines: 3,
    diff_max_bytes: 8 * 1024 * 1024,
    file_view_mode: "path",
    diff_view_mode: "hunk",
    graph_columns: ALL_GRAPH_COLUMNS,
    keybinds: DEFAULT_KEYBINDS,
    theme: {
        background: "#17191f",
        surface: "#1d2027",
        panel: "#242832",
        border: "#343946",
        text: "#f2f4f8",
        muted_text: "#9aa3b2",
        accent: "#20b8d8",
        success: "#4dbd74",
        warning: "#f0ad4e",
        danger: "#e05d6f",
        diff_addition: "#244d33",
        diff_deletion: "#562e32",
        graph_palette: ["#15a0bf", "#0669f7", "#8e00c2", "#c517b6", "#d90171", "#cd0101", "#f25d2e", "#f2ca33", "#7bd938", "#2ece9d"],
    },
};

export const EMPTY_STATE: PersistedState = {
    settings: DEFAULT_SETTINGS,
    workspace: { version: 2, ungrouped_tabs: [], groups: [], active_tab_id: null },
    recents: [],
};

export const RECENT_LIMIT = 30;

export const EMPTY_COMMIT_DRAFT: CommitDraft = { message: "", description: "", amend: false, signoff: false };
