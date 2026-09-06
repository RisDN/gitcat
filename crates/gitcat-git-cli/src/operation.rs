use std::{
    fs,
    path::{Path, PathBuf},
};

use gitcat_contracts::*;

use crate::{
    backend::{GitCliBackend, canonical_or_absolute},
    runner::os_args,
};

impl GitCliBackend {
    pub(crate) async fn git_dir(&self, path: &Path) -> ApiResult<PathBuf> {
        let output = self
            .read(Some(path), os_args(&["rev-parse", "--absolute-git-dir"]))
            .await?;
        canonical_or_absolute(path, output.stdout_lossy().trim())
    }

    pub(crate) async fn operation_state(&self, path: &Path) -> ApiResult<RepositoryOperationState> {
        let git_dir = self.git_dir(path).await?;
        Ok(operation_state_from_git_dir(&git_dir))
    }

    pub(crate) async fn operation_status(
        &self,
        path: &Path,
    ) -> ApiResult<(
        RepositoryOperationState,
        Option<OperationProgress>,
        Option<OperationSource>,
    )> {
        let git_dir = self.git_dir(path).await?;
        let state = operation_state_from_git_dir(&git_dir);
        let progress = match state {
            RepositoryOperationState::Rebase => operation_progress_from_git_dir(&git_dir),
            _ => None,
        };
        let source = operation_source_from_git_dir(&git_dir, state);
        Ok((state, progress, source))
    }
}

pub(crate) fn operation_state_from_git_dir(git_dir: &Path) -> RepositoryOperationState {
    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        RepositoryOperationState::Rebase
    } else if git_dir.join("MERGE_HEAD").exists() {
        RepositoryOperationState::Merge
    } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
        RepositoryOperationState::CherryPick
    } else if git_dir.join("REVERT_HEAD").exists() {
        RepositoryOperationState::Revert
    } else if git_dir.join("BISECT_LOG").exists() {
        RepositoryOperationState::Bisect
    } else {
        RepositoryOperationState::Normal
    }
}

/// The side an interrupted operation is bringing in, as Git recorded it: a branch
/// name where the operation kept one, otherwise a full object id. `snapshot` is
/// what turns an id into a ref name or shortens it for display.
pub(crate) fn operation_source_from_git_dir(
    git_dir: &Path,
    state: RepositoryOperationState,
) -> Option<OperationSource> {
    match state {
        RepositoryOperationState::Merge => Some(OperationSource {
            incoming: merged_ref_name(git_dir).or_else(|| read_oid(git_dir, "MERGE_HEAD"))?,
            onto: None,
            incoming_oid: read_oid(git_dir, "MERGE_HEAD"),
        }),
        RepositoryOperationState::CherryPick => Some(OperationSource {
            incoming: read_oid(git_dir, "CHERRY_PICK_HEAD")?,
            onto: None,
            incoming_oid: read_oid(git_dir, "CHERRY_PICK_HEAD"),
        }),
        RepositoryOperationState::Revert => Some(OperationSource {
            incoming: read_oid(git_dir, "REVERT_HEAD")?,
            onto: None,
            incoming_oid: read_oid(git_dir, "REVERT_HEAD"),
        }),
        RepositoryOperationState::Rebase => rebase_source(git_dir),
        RepositoryOperationState::Bisect | RepositoryOperationState::Normal => None,
    }
}

fn rebase_source(git_dir: &Path) -> Option<OperationSource> {
    let state_dir = ["rebase-merge", "rebase-apply"]
        .into_iter()
        .map(|name| git_dir.join(name))
        .find(|dir| dir.exists())?;
    let incoming = read_line(&state_dir.join("head-name"))
        .and_then(|name| {
            name.strip_prefix("refs/heads/")
                .map(str::to_owned)
                .or(Some(name.clone()))
        })
        .filter(|name| name != "detached HEAD")
        .or_else(|| read_line(&state_dir.join("orig-head")))?;
    // A rebase replays commits onto the target, so there is no second parent
    // for the working copy to be drawn from.
    Some(OperationSource {
        incoming,
        onto: read_line(&state_dir.join("onto")),
        incoming_oid: None,
    })
}

fn read_line(file: &Path) -> Option<String> {
    let text = fs::read_to_string(file).ok()?;
    let line = text.lines().next()?.trim().to_owned();
    (!line.is_empty()).then_some(line)
}

fn read_oid(git_dir: &Path, file: &str) -> Option<String> {
    read_line(&git_dir.join(file))
        .and_then(|line| line.split_whitespace().next().map(str::to_owned))
}

/// `Merge branch 'feature' into main` -- the first quoted name is the side being
/// merged, and Git writes the same shape for a remote-tracking branch or a tag.
fn merged_ref_name(git_dir: &Path) -> Option<String> {
    let message = fs::read_to_string(git_dir.join("MERGE_MSG")).ok()?;
    let line = message.lines().find(|line| !line.trim().is_empty())?;
    let (_, rest) = line.split_once('\'')?;
    let (name, _) = rest.split_once('\'')?;
    (!name.is_empty()).then(|| name.to_owned())
}

pub(crate) fn operation_progress_from_git_dir(git_dir: &Path) -> Option<OperationProgress> {
    let read_count = |file: &Path| {
        fs::read_to_string(file)
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok())
    };
    let merge_dir = git_dir.join("rebase-merge");
    let (current, total, message_file) = if merge_dir.exists() {
        (
            read_count(&merge_dir.join("msgnum"))?,
            read_count(&merge_dir.join("end"))?,
            merge_dir.join("message"),
        )
    } else {
        let apply_dir = git_dir.join("rebase-apply");
        (
            read_count(&apply_dir.join("next"))?,
            read_count(&apply_dir.join("last"))?,
            apply_dir.join("msg-clean"),
        )
    };
    if total == 0 {
        return None;
    }
    let subject = fs::read_to_string(message_file).ok().and_then(|message| {
        message
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty() && !line.starts_with('#'))
            .map(str::to_owned)
    });
    Some(OperationProgress {
        current: current.min(total),
        total,
        subject,
    })
}

pub(crate) fn ensure_operation(
    actual: RepositoryOperationState,
    requested: ContinueOperation,
) -> ApiResult<()> {
    let matches = matches!(
        (actual, requested),
        (RepositoryOperationState::Merge, ContinueOperation::Merge)
            | (RepositoryOperationState::Rebase, ContinueOperation::Rebase)
            | (
                RepositoryOperationState::CherryPick,
                ContinueOperation::CherryPick
            )
            | (RepositoryOperationState::Revert, ContinueOperation::Revert)
    );
    if matches {
        Ok(())
    } else {
        Err(ApiError::new(
            ErrorCode::OperationInProgress,
            "Requested Git operation is not currently active",
        ))
    }
}
