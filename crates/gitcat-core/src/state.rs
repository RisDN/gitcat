use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use gitcat_contracts::{ApiError, ApiResult, AppSettings, ErrorCode, PersistedState, ThemeColors};
use uuid::Uuid;

const MAX_AUTO_FETCH_INTERVAL_MINUTES: u16 = 60;
const MAX_HISTORY_PAGE_SIZE: usize = 500;
const MAX_DIFF_CONTEXT_LINES: u16 = 100;
const MAX_DIFF_BYTES: usize = 128 * 1024 * 1024;
const MAX_GRAPH_PALETTE_COLORS: usize = 64;

#[derive(Debug, Clone)]
pub struct JsonStateStore {
    path: PathBuf,
    transaction_lock: Arc<Mutex<()>>,
}

impl JsonStateStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
            transaction_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn load(&self) -> ApiResult<PersistedState> {
        let _guard = self.lock()?;
        self.load_unlocked()
    }

    pub fn save(&self, state: &PersistedState) -> ApiResult<()> {
        let _guard = self.lock()?;
        self.save_unlocked(state)
    }

    /// Atomically reads, changes, validates, and replaces state under one store lock.
    pub fn update(
        &self,
        mutate: impl FnOnce(&mut PersistedState) -> ApiResult<()>,
    ) -> ApiResult<PersistedState> {
        let _guard = self.lock()?;
        let mut state = self.load_unlocked()?;
        mutate(&mut state)?;
        self.save_unlocked(&state)?;
        Ok(state)
    }

    fn load_unlocked(&self) -> ApiResult<PersistedState> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(PersistedState::default());
            }
            Err(error) => return Err(io_error("read state", &self.path, error)),
        };

        let state: PersistedState = serde_json::from_slice(&bytes).map_err(|error| {
            invalid_settings("persisted state is not valid JSON").with_details(error.to_string())
        })?;
        validate_settings(&state.settings)?;
        Ok(state)
    }

    fn save_unlocked(&self, state: &PersistedState) -> ApiResult<()> {
        validate_settings(&state.settings)?;

        let parent = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty());
        if let Some(parent) = parent {
            fs::create_dir_all(parent)
                .map_err(|error| io_error("create state directory", parent, error))?;
        }

        let file_name = self
            .path
            .file_name()
            .ok_or_else(|| ApiError::new(ErrorCode::InvalidPath, "state path has no file name"))?;
        let temp_name = format!(".{}.{}.tmp", file_name.to_string_lossy(), Uuid::new_v4());
        let temp_path = self.path.with_file_name(temp_name);
        let encoded = serde_json::to_vec_pretty(state).map_err(|error| {
            ApiError::new(ErrorCode::Internal, "failed to serialize persisted state")
                .with_details(error.to_string())
        })?;

        let result = (|| -> ApiResult<()> {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temp_path)
                .map_err(|error| io_error("create temporary state", &temp_path, error))?;
            file.write_all(&encoded)
                .map_err(|error| io_error("write temporary state", &temp_path, error))?;
            file.sync_all()
                .map_err(|error| io_error("sync temporary state", &temp_path, error))?;
            drop(file);

            fs::rename(&temp_path, &self.path)
                .map_err(|error| io_error("replace persisted state", &self.path, error))?;
            Ok(())
        })();

        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }
        result
    }

    fn lock(&self) -> ApiResult<MutexGuard<'_, ()>> {
        self.transaction_lock.lock().map_err(|_| {
            ApiError::new(
                ErrorCode::Internal,
                "persisted state transaction lock was poisoned",
            )
        })
    }
}

pub fn validate_settings(settings: &AppSettings) -> ApiResult<()> {
    if settings.auto_fetch_interval_minutes > MAX_AUTO_FETCH_INTERVAL_MINUTES {
        return Err(invalid_settings(
            "auto-fetch interval must be between 0 and 60 minutes",
        ));
    }
    if !(1..=MAX_HISTORY_PAGE_SIZE).contains(&settings.history_page_size) {
        return Err(invalid_settings(
            "history page size must be between 1 and 500",
        ));
    }
    if settings.diff_context_lines > MAX_DIFF_CONTEXT_LINES {
        return Err(invalid_settings(
            "diff context lines must be between 0 and 100",
        ));
    }
    if !(1..=MAX_DIFF_BYTES).contains(&settings.diff_max_bytes) {
        return Err(invalid_settings(
            "diff byte limit must be between 1 and 134217728",
        ));
    }

    let keybinds = &settings.keybinds;
    let bindings = [
        keybinds.next_repository.as_str(),
        keybinds.previous_repository.as_str(),
        keybinds.repository_1.as_str(),
        keybinds.repository_2.as_str(),
        keybinds.repository_3.as_str(),
        keybinds.repository_4.as_str(),
        keybinds.repository_5.as_str(),
        keybinds.repository_6.as_str(),
        keybinds.repository_7.as_str(),
        keybinds.repository_8.as_str(),
        keybinds.repository_9.as_str(),
        keybinds.new_repository_tab.as_str(),
        keybinds.close_repository.as_str(),
        keybinds.open_repository.as_str(),
        keybinds.open_repository_folder.as_str(),
        keybinds.search_commits.as_str(),
        keybinds.open_settings.as_str(),
        keybinds.refresh_repository.as_str(),
        keybinds.toggle_left_panel.as_str(),
        keybinds.toggle_right_panel.as_str(),
        keybinds.fetch.as_str(),
        keybinds.pull.as_str(),
        keybinds.push.as_str(),
        keybinds.create_branch.as_str(),
        keybinds.stash.as_str(),
        keybinds.show_worktree.as_str(),
        keybinds.show_graph.as_str(),
        keybinds.diff_inline.as_str(),
        keybinds.diff_split.as_str(),
        keybinds.copy_selected_sha.as_str(),
        keybinds.continue_operation.as_str(),
        keybinds.abort_operation.as_str(),
        keybinds.stage_all.as_str(),
        keybinds.unstage_all.as_str(),
        keybinds.focus_commit_message.as_str(),
        keybinds.auto_resolve_conflicts.as_str(),
        keybinds.commit.as_str(),
    ];
    let mut unique = HashSet::with_capacity(bindings.len());
    for binding in bindings {
        if binding.is_empty() {
            continue;
        }
        if binding.len() > 64 || binding.chars().any(char::is_control) {
            return Err(invalid_settings(
                "keybinds must contain a printable key combination up to 64 characters",
            ));
        }
        if is_reserved_keybind(binding) {
            return Err(invalid_settings(
                "keybinds cannot replace operating-system or unmodified navigation shortcuts",
            ));
        }
        if !unique.insert(binding.to_ascii_lowercase()) {
            return Err(invalid_settings("keybinds must be unique"));
        }
    }

    validate_theme(&settings.theme)
}

fn is_reserved_keybind(binding: &str) -> bool {
    let normalized = binding.to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "alt+f4" | "ctrl+alt+delete" | "ctrl+shift+escape" | "meta+q" | "meta+alt+escape"
    ) {
        return true;
    }

    let mut parts = normalized.split('+').collect::<Vec<_>>();
    let Some(key) = parts.pop() else {
        return false;
    };
    let interaction_key = matches!(
        key,
        "tab"
            | "enter"
            | "space"
            | "escape"
            | "backspace"
            | "delete"
            | "arrowup"
            | "arrowdown"
            | "arrowleft"
            | "arrowright"
            | "home"
            | "end"
            | "pageup"
            | "pagedown"
    );
    interaction_key && parts.iter().all(|modifier| *modifier == "shift")
}

pub fn validate_theme(theme: &ThemeColors) -> ApiResult<()> {
    let colors = [
        ("background", theme.background.as_str()),
        ("surface", theme.surface.as_str()),
        ("panel", theme.panel.as_str()),
        ("border", theme.border.as_str()),
        ("text", theme.text.as_str()),
        ("muted_text", theme.muted_text.as_str()),
        ("accent", theme.accent.as_str()),
        ("success", theme.success.as_str()),
        ("warning", theme.warning.as_str()),
        ("danger", theme.danger.as_str()),
        ("diff_addition", theme.diff_addition.as_str()),
        ("diff_deletion", theme.diff_deletion.as_str()),
    ];

    for (name, color) in colors {
        if !is_hex_color(color) {
            return Err(invalid_settings(format!(
                "theme color {name} must use #RRGGBB or #RRGGBBAA format"
            )));
        }
    }

    if theme.graph_palette.is_empty() || theme.graph_palette.len() > MAX_GRAPH_PALETTE_COLORS {
        return Err(invalid_settings(
            "graph palette must contain between 1 and 64 colors",
        ));
    }
    for color in &theme.graph_palette {
        if !is_hex_color(color) {
            return Err(invalid_settings(
                "graph palette colors must use #RRGGBB or #RRGGBBAA format",
            ));
        }
    }

    Ok(())
}

fn is_hex_color(color: &str) -> bool {
    matches!(color.len(), 7 | 9)
        && color.starts_with('#')
        && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn invalid_settings(message: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::InvalidSettings, message)
}

fn io_error(action: &str, path: &Path, error: io::Error) -> ApiError {
    ApiError::new(ErrorCode::Io, format!("failed to {action}"))
        .with_details(format!("{}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::{Arc, Barrier};

    use gitcat_contracts::{ErrorCode, PersistedState, PullMode};
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn missing_file_loads_defaults() {
        let directory = tempdir().unwrap();
        let store = JsonStateStore::new(directory.path().join("state.json"));

        assert_eq!(store.load().unwrap(), PersistedState::default());
    }

    #[test]
    fn save_creates_parent_and_round_trips_state() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("nested").join("state.json");
        let store = JsonStateStore::new(&path);
        let mut state = PersistedState::default();
        state.settings.default_pull_mode = PullMode::Rebase;
        state.workspace.version = 2;

        store.save(&state).unwrap();

        assert_eq!(store.load().unwrap(), state);
        let entries: Vec<_> = fs::read_dir(path.parent().unwrap()).unwrap().collect();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn repeated_save_atomically_replaces_previous_state() {
        let directory = tempdir().unwrap();
        let store = JsonStateStore::new(directory.path().join("state.json"));
        let first = PersistedState::default();
        store.save(&first).unwrap();

        let mut second = first;
        second.settings.auto_prune = false;
        store.save(&second).unwrap();

        assert_eq!(store.load().unwrap(), second);
    }

    #[test]
    fn invalid_color_is_rejected_without_replacing_valid_state() {
        let directory = tempdir().unwrap();
        let store = JsonStateStore::new(directory.path().join("state.json"));
        let valid = PersistedState::default();
        store.save(&valid).unwrap();

        let mut invalid = valid.clone();
        invalid.settings.theme.accent = "red; background: url(x)".into();
        let error = store.save(&invalid).unwrap_err();

        assert_eq!(error.code, ErrorCode::InvalidSettings);
        assert_eq!(store.load().unwrap(), valid);
    }

    #[test]
    fn invalid_limits_use_stable_settings_error() {
        let mut settings = AppSettings {
            history_page_size: 0,
            ..AppSettings::default()
        };
        assert_eq!(
            validate_settings(&settings).unwrap_err().code,
            ErrorCode::InvalidSettings
        );

        settings.history_page_size = MAX_HISTORY_PAGE_SIZE + 1;
        assert_eq!(
            validate_settings(&settings).unwrap_err().code,
            ErrorCode::InvalidSettings
        );

        settings.history_page_size = AppSettings::default().history_page_size;
        settings.diff_max_bytes = 0;
        assert_eq!(
            validate_settings(&settings).unwrap_err().code,
            ErrorCode::InvalidSettings
        );
    }

    #[test]
    fn invalid_json_is_an_invalid_settings_error() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.json");
        fs::write(&path, b"not-json").unwrap();

        let error = JsonStateStore::new(path).load().unwrap_err();

        assert_eq!(error.code, ErrorCode::InvalidSettings);
    }

    #[test]
    fn older_state_files_fill_new_fields_from_defaults() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.json");
        fs::write(
            &path,
            r#"{"settings":{"default_pull_mode":"rebase"},"workspace":{}}"#,
        )
        .unwrap();

        let state = JsonStateStore::new(path).load().unwrap();
        assert_eq!(state.settings.default_pull_mode, PullMode::Rebase);
        assert_eq!(state.settings.history_page_size, 200);
        assert_eq!(state.workspace.version, 2);
        assert_eq!(state.settings.keybinds.next_repository, "Ctrl+Tab");
        assert!(state.workspace.ungrouped_tabs.is_empty());
    }

    #[test]
    fn cloned_store_updates_do_not_lose_each_other() {
        let directory = tempdir().unwrap();
        let store = JsonStateStore::new(directory.path().join("state.json"));
        store.save(&PersistedState::default()).unwrap();
        let first = store.clone();
        let second = store.clone();
        let barrier = Arc::new(Barrier::new(3));

        let first_barrier = barrier.clone();
        let first_thread = std::thread::spawn(move || {
            first_barrier.wait();
            first
                .update(|state| {
                    state.settings.auto_prune = false;
                    Ok(())
                })
                .unwrap();
        });
        let second_barrier = barrier.clone();
        let second_thread = std::thread::spawn(move || {
            second_barrier.wait();
            second
                .update(|state| {
                    state.settings.default_pull_mode = PullMode::Rebase;
                    Ok(())
                })
                .unwrap();
        });

        barrier.wait();
        first_thread.join().unwrap();
        second_thread.join().unwrap();
        let state = store.load().unwrap();
        assert!(!state.settings.auto_prune);
        assert_eq!(state.settings.default_pull_mode, PullMode::Rebase);
    }

    #[test]
    fn rgba_colors_are_accepted_and_empty_palette_is_rejected() {
        let mut settings = AppSettings::default();
        settings.theme.accent = "#aabbcc80".into();
        validate_settings(&settings).unwrap();

        settings.theme.graph_palette.clear();
        assert_eq!(
            validate_settings(&settings).unwrap_err().code,
            ErrorCode::InvalidSettings
        );
    }

    #[test]
    fn duplicate_and_reserved_keybinds_are_rejected_but_unassigned_is_valid() {
        let mut settings = AppSettings::default();
        settings.keybinds.previous_repository = settings.keybinds.next_repository.clone();
        assert_eq!(
            validate_settings(&settings).unwrap_err().code,
            ErrorCode::InvalidSettings
        );

        settings = AppSettings::default();
        settings.keybinds.commit.clear();
        validate_settings(&settings).unwrap();

        settings.keybinds.commit = "Tab".into();
        assert_eq!(
            validate_settings(&settings).unwrap_err().code,
            ErrorCode::InvalidSettings
        );

        settings.keybinds.commit = "Alt+F4".into();
        assert_eq!(
            validate_settings(&settings).unwrap_err().code,
            ErrorCode::InvalidSettings
        );
    }
}
