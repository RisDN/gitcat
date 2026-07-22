use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Stable error codes form part of the UI contract. Git stderr never does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    GitNotFound,
    UnsupportedGitVersion,
    InvalidRepository,
    RepositoryClosed,
    InvalidPath,
    InvalidRequest,
    InvalidRefName,
    InvalidRevision,
    StaleSnapshot,
    RepositoryBusy,
    DirtyWorktree,
    ConflictsPresent,
    OperationInProgress,
    UpstreamMissing,
    AuthenticationRequired,
    NetworkFailed,
    NonFastForward,
    ProtectedOperation,
    UnsupportedOperation,
    Cancelled,
    Timeout,
    OutputTooLarge,
    GitCommandFailed,
    Io,
    InvalidSettings,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryAction {
    pub kind: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Error)]
#[error("{message}")]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recovery_actions: Vec<RecoveryAction>,
}

impl ApiError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
            recovery_actions: Vec::new(),
        }
    }

    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
