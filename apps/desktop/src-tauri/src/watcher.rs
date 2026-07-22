//! Filesystem watcher for the active repository.
//!
//! GitCat watches one repository at a time — the one the user is looking at —
//! and pushes a `repository:changed` event to the frontend whenever its
//! worktree or `.git` metadata changes. The UI reacts by reloading its
//! overview, so a commit, checkout, or stray editor save made outside the app
//! shows up without a manual refresh.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use gitcat_contracts::RepositoryId;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Event name the frontend subscribes to. Payload is [`RepositoryChangedPayload`].
pub const REPOSITORY_CHANGED_EVENT: &str = "repository:changed";

/// Quiet period the watcher waits for before notifying the UI. Git operations
/// and editor saves land as bursts of filesystem events; debouncing collapses
/// each burst into a single refresh instead of a storm of them.
const DEBOUNCE: Duration = Duration::from_millis(350);

#[derive(Clone, Serialize)]
struct RepositoryChangedPayload {
    repository_id: RepositoryId,
}

/// A live watch on a single repository. Dropping it stops the OS watcher and,
/// because the event handler owns the only channel sender, ends the debounce
/// worker thread.
struct ActiveWatch {
    repository_id: RepositoryId,
    _watcher: RecommendedWatcher,
}

/// Tauri-managed state holding at most one active repository watch.
#[derive(Default)]
pub struct RepositoryWatchState {
    current: Mutex<Option<ActiveWatch>>,
}

impl RepositoryWatchState {
    /// Start watching `root` for `repository_id`, replacing any previous watch.
    pub fn watch(
        &self,
        app: AppHandle,
        repository_id: RepositoryId,
        root: PathBuf,
    ) -> notify::Result<()> {
        // Already watching this repository: nothing to do.
        {
            let current = self.current.lock().unwrap();
            if current
                .as_ref()
                .is_some_and(|active| active.repository_id == repository_id)
            {
                return Ok(());
            }
        }

        let (tx, rx) = mpsc::channel::<()>();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                if paths_are_relevant(&event.paths) {
                    // Sender error only happens once the debounce worker is gone,
                    // which means this watcher is being torn down.
                    let _ = tx.send(());
                }
            }
        })?;
        watcher.watch(&root, RecursiveMode::Recursive)?;

        let worker_repository_id = repository_id.clone();
        std::thread::spawn(move || {
            // Block for the first event of a burst, then coalesce everything that
            // arrives within DEBOUNCE of the previous event into one notification.
            while rx.recv().is_ok() {
                loop {
                    match rx.recv_timeout(DEBOUNCE) {
                        Ok(()) => continue,
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
                let _ = app.emit(
                    REPOSITORY_CHANGED_EVENT,
                    RepositoryChangedPayload {
                        repository_id: worker_repository_id.clone(),
                    },
                );
            }
        });

        // Replacing the previous ActiveWatch drops its watcher, which drops its
        // channel sender and lets the old worker thread exit.
        *self.current.lock().unwrap() = Some(ActiveWatch {
            repository_id,
            _watcher: watcher,
        });
        Ok(())
    }

    /// Stop watching whatever repository is currently watched, if any.
    pub fn unwatch(&self) {
        *self.current.lock().unwrap() = None;
    }
}

/// Whether a filesystem event touches anything worth a refresh. Object and LFS
/// stores under `.git` churn heavily during fetch/gc without changing anything
/// the UI shows on their own — the accompanying ref/index updates (which live
/// elsewhere under `.git`) drive the refresh instead.
fn paths_are_relevant(paths: &[PathBuf]) -> bool {
    // An event with no paths carries no location to filter on; treat it as real.
    paths.is_empty() || paths.iter().any(|path| path_is_relevant(path))
}

fn path_is_relevant(path: &Path) -> bool {
    let mut after_git = false;
    for component in path.components() {
        let name = component.as_os_str();
        if after_git {
            if name == "objects" || name == "lfs" {
                return false;
            }
            after_git = false;
        }
        if name == ".git" {
            after_git = true;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(path: &str) -> PathBuf {
        PathBuf::from(path)
    }

    #[test]
    fn worktree_and_git_metadata_are_relevant() {
        assert!(path_is_relevant(&p("/repo/src/main.rs")));
        assert!(path_is_relevant(&p("/repo/.git/HEAD")));
        assert!(path_is_relevant(&p("/repo/.git/refs/heads/main")));
        assert!(path_is_relevant(&p("/repo/.git/index")));
    }

    #[test]
    fn git_object_and_lfs_stores_are_ignored() {
        assert!(!path_is_relevant(&p("/repo/.git/objects/ab/cdef")));
        assert!(!path_is_relevant(&p("/repo/.git/lfs/objects/12/34")));
    }

    #[test]
    fn a_file_named_objects_outside_git_is_relevant() {
        assert!(path_is_relevant(&p("/repo/objects/data.bin")));
    }

    #[test]
    fn empty_event_is_relevant() {
        assert!(paths_are_relevant(&[]));
    }
}
