use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{WebviewWindow, Window};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(default)]
struct StoredWindowMode {
    maximized: bool,
}

#[derive(Debug)]
pub struct WindowModeStore {
    path: PathBuf,
    maximized: AtomicBool,
}

impl WindowModeStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        let path = path.as_ref().to_path_buf();
        let maximized = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<StoredWindowMode>(&bytes).ok())
            .unwrap_or_default()
            .maximized;
        Self {
            path,
            maximized: AtomicBool::new(maximized),
        }
    }

    pub fn restore(&self, window: &WebviewWindow) {
        if self.maximized.load(Ordering::Relaxed) {
            let _ = window.maximize();
        }
    }

    pub fn remember(&self, window: &Window) {
        let Ok(maximized) = window.is_maximized() else {
            return;
        };
        if window.is_minimized().unwrap_or(false) {
            return;
        }
        if self.maximized.swap(maximized, Ordering::Relaxed) == maximized {
            return;
        }
        self.persist(maximized);
    }

    fn persist(&self, maximized: bool) {
        if let Some(parent) = self.path.parent() {
            if fs::create_dir_all(parent).is_err() {
                return;
            }
        }
        if let Ok(encoded) = serde_json::to_vec(&StoredWindowMode { maximized }) {
            let _ = fs::write(&self.path, encoded);
        }
    }
}
