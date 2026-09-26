//! Native updater state and lifecycle integration for the desktop frontend.

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use async_trait::async_trait;
use catninth_updater::{
    Config, Error, Event, InstallHooks, Phase, PollingHandle, Release, Repository, Updater,
    tauri::TauriInstaller,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const REPOSITORY: &str = "RisDN/gitcat";
const CHECK_INTERVAL_MINUTES: u64 = 360;
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(4);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateStatus {
    Idle,
    Checking,
    Available,
    Downloading,
    Installing,
    Ready,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    status: UpdateStatus,
    version: Option<String>,
    notes: Option<String>,
    progress: Option<u8>,
    error: Option<String>,
}

impl From<catninth_updater::UpdateState> for UpdateState {
    fn from(state: catninth_updater::UpdateState) -> Self {
        let baseline = state.applied_version.as_ref().unwrap_or(&state.current);
        let available = state
            .latest
            .filter(|release| release.version.cmp_precedence(baseline).is_gt());
        Self {
            status: match state.phase {
                Phase::Idle | Phase::Latest => UpdateStatus::Idle,
                Phase::Checking => UpdateStatus::Checking,
                Phase::Available => UpdateStatus::Available,
                Phase::Downloading => UpdateStatus::Downloading,
                Phase::Installing => UpdateStatus::Installing,
                Phase::Installed => UpdateStatus::Ready,
                Phase::Error => UpdateStatus::Error,
            },
            version: available
                .as_ref()
                .map(|release| release.version.to_string()),
            notes: available.and_then(|release| release.notes),
            progress: state.progress.and_then(|progress| progress.percent),
            error: state.error,
        }
    }
}

struct DesktopUpdater {
    updater: Updater,
    _polling: PollingHandle,
}

pub fn setup(app: &AppHandle) -> catninth_updater::Result<()> {
    let repository = Repository::parse(REPOSITORY)?;
    let config = Config::new(
        repository.clone(),
        &app.package_info().version.to_string(),
        CHECK_INTERVAL_MINUTES,
    )?
    .with_first_check_delay(FIRST_CHECK_DELAY)?;
    let public_key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| Error::InvalidConfig("missing updater public key".into()))?;
    let exit_app = app.clone();
    let installer = TauriInstaller::new(app.clone(), repository, public_key)?
        .with_timeout(config.request_timeout())?
        .on_before_exit(move || tauri_plugin_single_instance::destroy(&exit_app));
    let event_app = app.clone();
    let last_state = Mutex::new(None);
    let updater = Updater::builder(config)
        .installer(Arc::new(installer))
        .hooks(Arc::new(DesktopHooks(app.clone())))
        .on_event(move |event| {
            if let Event::StateChanged(state) = event {
                let state = UpdateState::from(state.clone());
                // Do not send every byte-level progress update across IPC.
                let mut last = last_state.lock().unwrap();
                if last.as_ref() != Some(&state) {
                    *last = Some(state.clone());
                    drop(last);
                    let _ = event_app.emit("app-update", state);
                }
            }
        })
        .build()?;
    let polling = tauri::async_runtime::block_on(async { updater.start() })?;
    app.manage(DesktopUpdater {
        updater,
        _polling: polling,
    });
    Ok(())
}

struct DesktopHooks(AppHandle);

#[async_trait]
impl InstallHooks for DesktopHooks {
    async fn after_install(&self, _release: &Release) -> catninth_updater::Result<()> {
        // Linux/macOS installation returns. Release the single-instance lock
        // before the replacement process starts. Windows uses on_before_exit.
        crate::app_relaunch(self.0.clone());
        Ok(())
    }
}

#[tauri::command]
pub fn get_update_state(app: AppHandle) -> UpdateState {
    app.state::<DesktopUpdater>().updater.state().into()
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<(), String> {
    let updater = app.state::<DesktopUpdater>().updater.clone();
    match updater.fetch_version().await {
        Ok(_) | Err(Error::Busy) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.state::<DesktopUpdater>().updater.clone();
    match updater.install().await {
        Ok(()) | Err(Error::Busy) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catninth_updater::DownloadProgress;

    fn snapshot(phase: Phase, version: &str) -> catninth_updater::UpdateState {
        catninth_updater::UpdateState {
            phase,
            current: "1.0.0".parse().unwrap(),
            latest: Some(Release {
                version: version.parse().unwrap(),
                tag: format!("v{version}"),
                notes: Some("Release notes".into()),
                published_at: None,
            }),
            progress: None,
            error: None,
            applied_version: None,
        }
    }

    #[test]
    fn all_native_phases_have_a_frontend_status() {
        for (phase, status) in [
            (Phase::Idle, "idle"),
            (Phase::Checking, "checking"),
            (Phase::Latest, "idle"),
            (Phase::Available, "available"),
            (Phase::Downloading, "downloading"),
            (Phase::Installing, "installing"),
            (Phase::Installed, "ready"),
            (Phase::Error, "error"),
        ] {
            let state = UpdateState::from(snapshot(phase, "1.1.0"));
            assert_eq!(serde_json::to_value(state).unwrap()["status"], status);
        }
    }

    #[test]
    fn current_older_and_already_applied_versions_are_not_installable() {
        for version in ["0.9.0", "1.0.0", "1.0.0+build.2"] {
            let state = UpdateState::from(snapshot(Phase::Latest, version));
            assert!(state.version.is_none());
            assert!(state.notes.is_none());
        }
        let mut state = snapshot(Phase::Installed, "1.1.0");
        state.applied_version = Some("1.1.0".parse().unwrap());
        let state = UpdateState::from(state);
        assert!(state.version.is_none());
        assert_eq!(state.status, UpdateStatus::Ready);
    }

    #[test]
    fn progress_handles_unknown_sizes_and_errors_keep_release_notes() {
        let mut state = snapshot(Phase::Downloading, "1.1.0");
        state.progress = Some(DownloadProgress::new(40, Some(100)));
        assert_eq!(UpdateState::from(state.clone()).progress, Some(40));
        state.progress = Some(DownloadProgress::new(40, None));
        assert!(UpdateState::from(state.clone()).progress.is_none());
        state.phase = Phase::Error;
        state.error = Some("Download failed".into());
        let state = UpdateState::from(state);
        assert_eq!(state.version.as_deref(), Some("1.1.0"));
        assert_eq!(state.notes.as_deref(), Some("Release notes"));
        assert_eq!(state.error.as_deref(), Some("Download failed"));
    }
}
