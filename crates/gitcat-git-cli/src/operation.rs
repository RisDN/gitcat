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
    ) -> ApiResult<(RepositoryOperationState, Option<OperationProgress>)> {
        let git_dir = self.git_dir(path).await?;
        let state = operation_state_from_git_dir(&git_dir);
        let progress = match state {
            RepositoryOperationState::Rebase => operation_progress_from_git_dir(&git_dir),
            _ => None,
        };
        Ok((state, progress))
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
