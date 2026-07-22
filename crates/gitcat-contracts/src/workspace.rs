use serde::{Deserialize, Serialize};

use crate::PullMode;

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
    pub groups: Vec<RepositoryGroup>,
    pub active_tab_id: Option<String>,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            version: 1,
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
