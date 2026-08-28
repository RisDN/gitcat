//! Opening a repository that was chosen outside GitCat.
//!
//! The Windows Explorer context menu the installer offers runs
//! `gitcat-desktop.exe "<folder>"`, so a folder can arrive on the command line
//! both when GitCat starts and while it is already running. The first case is
//! handed to the frontend when it asks for it, because the window is not there
//! to receive an event yet; the second is pushed as `repository:open-request`.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

/// Event name the frontend subscribes to. Payload is [`OpenRequestPayload`].
pub const OPEN_REQUEST_EVENT: &str = "repository:open-request";

#[derive(Clone, Serialize)]
pub struct OpenRequestPayload {
    pub path: String,
}

/// A folder GitCat was launched with, held until the frontend is ready to open
/// it. Taking it clears it: the launch argument opens a repository once, not
/// again on every reload.
#[derive(Default)]
pub struct PendingOpen(Mutex<Option<String>>);

impl PendingOpen {
    pub fn new(path: Option<String>) -> Self {
        Self(Mutex::new(path))
    }

    pub fn take(&self) -> Option<String> {
        self.0.lock().ok().and_then(|mut slot| slot.take())
    }
}

/// Picks the folder to open out of a command line.
///
/// The first argument that names an existing directory wins. Matching on the
/// directory rather than on the position is what keeps the updater's own
/// relaunch switches, and anything else the operating system appends, from
/// being mistaken for a repository.
pub fn repository_argument<I>(args: I) -> Option<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| path.is_dir())
        .map(|path| dunce::canonicalize(&path).unwrap_or(path))
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn takes_the_folder_the_context_menu_passed() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().to_string_lossy().into_owned();
        let found = repository_argument(args(&["gitcat.exe", &path])).unwrap();
        assert_eq!(
            PathBuf::from(found),
            dunce::canonicalize(folder.path()).unwrap()
        );
    }

    #[test]
    fn ignores_the_executable_itself() {
        // argv[0] is an existing path too, and never the repository.
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().to_string_lossy().into_owned();
        assert!(repository_argument(args(&[&path])).is_none());
    }

    #[test]
    fn skips_switches_and_paths_that_are_gone() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().to_string_lossy().into_owned();
        let found =
            repository_argument(args(&["gitcat.exe", "--flag", r"C:\does\not\exist", &path]));
        assert!(found.is_some());
    }

    #[test]
    fn a_plain_launch_asks_for_nothing() {
        assert!(repository_argument(args(&["gitcat.exe"])).is_none());
    }

    #[test]
    fn a_pending_folder_is_handed_out_once() {
        let pending = PendingOpen::new(Some(r"C:\repo".to_owned()));
        assert_eq!(pending.take().as_deref(), Some(r"C:\repo"));
        assert!(pending.take().is_none());
    }
}
