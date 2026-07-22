use serde::{Deserialize, Serialize};

use crate::PullMode;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct KeybindSettings {
    pub next_repository: String,
    pub previous_repository: String,
    pub repository_1: String,
    pub repository_2: String,
    pub repository_3: String,
    pub repository_4: String,
    pub repository_5: String,
    pub repository_6: String,
    pub repository_7: String,
    pub repository_8: String,
    pub repository_9: String,
    pub new_repository_tab: String,
    pub close_repository: String,
    pub open_repository: String,
    pub search_commits: String,
    pub open_settings: String,
    pub refresh_repository: String,
    pub toggle_left_panel: String,
    pub toggle_right_panel: String,
    pub fetch: String,
    pub pull: String,
    pub push: String,
    pub create_branch: String,
    pub stash: String,
    pub show_worktree: String,
    pub show_graph: String,
    pub diff_inline: String,
    pub diff_split: String,
    pub copy_selected_sha: String,
    pub continue_operation: String,
    pub abort_operation: String,
    pub stage_all: String,
    pub unstage_all: String,
    pub focus_commit_message: String,
    pub auto_resolve_conflicts: String,
    pub commit: String,
}

impl Default for KeybindSettings {
    fn default() -> Self {
        Self {
            next_repository: "Ctrl+Tab".into(),
            previous_repository: "Ctrl+Shift+Tab".into(),
            repository_1: "Ctrl+1".into(),
            repository_2: "Ctrl+2".into(),
            repository_3: "Ctrl+3".into(),
            repository_4: "Ctrl+4".into(),
            repository_5: "Ctrl+5".into(),
            repository_6: "Ctrl+6".into(),
            repository_7: "Ctrl+7".into(),
            repository_8: "Ctrl+8".into(),
            repository_9: "Ctrl+9".into(),
            new_repository_tab: "Ctrl+T".into(),
            close_repository: "Ctrl+W".into(),
            open_repository: "Ctrl+Shift+O".into(),
            search_commits: "Ctrl+F".into(),
            open_settings: "Ctrl+,".into(),
            refresh_repository: "F5".into(),
            toggle_left_panel: "Ctrl+J".into(),
            toggle_right_panel: "Ctrl+K".into(),
            fetch: "Ctrl+L".into(),
            pull: "Ctrl+Alt+P".into(),
            push: "Ctrl+Shift+P".into(),
            create_branch: "Ctrl+B".into(),
            stash: "Ctrl+Alt+S".into(),
            show_worktree: "Ctrl+Shift+W".into(),
            show_graph: "Alt+Left".into(),
            diff_inline: "Alt+1".into(),
            diff_split: "Alt+2".into(),
            copy_selected_sha: "Ctrl+Shift+C".into(),
            continue_operation: "Ctrl+Alt+Enter".into(),
            abort_operation: "Ctrl+Shift+Backspace".into(),
            stage_all: "Ctrl+Shift+S".into(),
            unstage_all: "Ctrl+Shift+U".into(),
            focus_commit_message: "Ctrl+Shift+M".into(),
            auto_resolve_conflicts: "Ctrl+Alt+R".into(),
            commit: "Ctrl+Enter".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeColors {
    pub background: String,
    pub surface: String,
    pub panel: String,
    pub border: String,
    pub text: String,
    pub muted_text: String,
    pub accent: String,
    pub success: String,
    pub warning: String,
    pub danger: String,
    pub diff_addition: String,
    pub diff_deletion: String,
    pub graph_palette: Vec<String>,
}

impl Default for ThemeColors {
    fn default() -> Self {
        Self {
            background: "#17191f".into(),
            surface: "#1d2027".into(),
            panel: "#242832".into(),
            border: "#343946".into(),
            text: "#f2f4f8".into(),
            muted_text: "#9aa3b2".into(),
            accent: "#20b8d8".into(),
            success: "#4dbd74".into(),
            warning: "#f0ad4e".into(),
            danger: "#e05d6f".into(),
            diff_addition: "#244d33".into(),
            diff_deletion: "#562e32".into(),
            graph_palette: vec![
                "#17b8d4".into(),
                "#7c4dff".into(),
                "#c42df0".into(),
                "#ff9f43".into(),
                "#4dbd74".into(),
                "#ef5b8c".into(),
            ],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub default_pull_mode: PullMode,
    pub auto_fetch_interval_minutes: u16,
    pub auto_prune: bool,
    pub history_page_size: usize,
    pub diff_context_lines: u16,
    pub diff_max_bytes: usize,
    pub keybinds: KeybindSettings,
    pub theme: ThemeColors,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_pull_mode: PullMode::Merge,
            auto_fetch_interval_minutes: 0,
            auto_prune: true,
            history_page_size: 200,
            diff_context_lines: 3,
            diff_max_bytes: 8 * 1024 * 1024,
            keybinds: KeybindSettings::default(),
            theme: ThemeColors::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepositoryTab {
    pub id: String,
    pub repository_path: String,
    pub display_name: String,
    pub order: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict_target: Option<String>,
    #[serde(default)]
    pub conflict_target_disabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepositoryGroup {
    pub id: String,
    pub name: String,
    pub collapsed: bool,
    pub order: i32,
    pub tabs: Vec<RepositoryTab>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspaceState {
    pub version: u32,
    pub ungrouped_tabs: Vec<RepositoryTab>,
    pub groups: Vec<RepositoryGroup>,
    pub active_tab_id: Option<String>,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            version: 2,
            ungrouped_tabs: Vec::new(),
            groups: Vec::new(),
            active_tab_id: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PersistedState {
    pub settings: AppSettings,
    pub workspace: WorkspaceState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppMetadata {
    pub version: String,
    pub commit: String,
}
