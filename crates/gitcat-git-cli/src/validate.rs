use std::path::{Component, Path};

use gitcat_contracts::*;

use crate::{backend::GitCliBackend, limits::MAX_COMMIT_MESSAGE_BYTES};

impl GitCliBackend {
    pub(crate) async fn validate_branch_name(&self, name: &str) -> ApiResult<()> {
        if name.is_empty() || name.contains(['\0', '\n', '\r']) {
            return Err(invalid_ref());
        }
        let output = self
            .read_allow_failure(
                None,
                vec!["check-ref-format".into(), "--branch".into(), name.into()],
            )
            .await?;
        if output.success() {
            Ok(())
        } else {
            Err(invalid_ref())
        }
    }

    pub(crate) async fn validate_tag_name(&self, name: &str) -> ApiResult<()> {
        if name.is_empty() || name.contains(['\0', '\n', '\r']) {
            return Err(invalid_ref());
        }
        let full_name = format!("refs/tags/{name}");
        let output = self
            .read_allow_failure(None, vec!["check-ref-format".into(), full_name.into()])
            .await?;
        if output.success() {
            Ok(())
        } else {
            Err(invalid_ref())
        }
    }
}

pub(crate) fn validate_relative_path(path: &str) -> ApiResult<()> {
    if path.is_empty() || path.contains('\0') {
        return Err(ApiError::new(
            ErrorCode::InvalidPath,
            "Repository path is empty or malformed",
        ));
    }
    let path = Path::new(path);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(ApiError::new(
            ErrorCode::InvalidPath,
            "File path must stay inside the repository",
        ));
    }
    Ok(())
}

pub(crate) fn validate_paths(paths: &[String]) -> ApiResult<()> {
    for path in paths {
        validate_relative_path(path)?;
    }
    Ok(())
}

pub(crate) fn validate_message(message: &str) -> ApiResult<()> {
    if message.trim().is_empty() {
        return Err(ApiError::new(
            ErrorCode::InvalidSettings,
            "Commit message is empty",
        ));
    }
    if message.len() > MAX_COMMIT_MESSAGE_BYTES || message.contains('\0') {
        return Err(ApiError::new(
            ErrorCode::InvalidSettings,
            "Commit message is too large or contains a NUL byte",
        ));
    }
    Ok(())
}

pub(crate) fn validate_mainline_parent(
    parent_count: usize,
    mainline_parent: Option<u32>,
) -> ApiResult<()> {
    match (parent_count, mainline_parent) {
        (count, None) if count > 1 => Err(ApiError::new(
            ErrorCode::InvalidRequest,
            "Merge commits require a mainline parent",
        )),
        (count, Some(parent)) if parent == 0 || parent as usize > count => Err(ApiError::new(
            ErrorCode::InvalidRequest,
            "Mainline parent is outside the commit parent range",
        )),
        (0 | 1, Some(_)) => Err(ApiError::new(
            ErrorCode::InvalidRequest,
            "Mainline parent is only valid for a merge commit",
        )),
        _ => Ok(()),
    }
}

pub(crate) fn validate_remote_name(name: &str) -> ApiResult<()> {
    let safe = !name.is_empty()
        && !name.starts_with('-')
        && name.len() <= 255
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/'));
    if safe {
        Ok(())
    } else {
        Err(ApiError::new(
            ErrorCode::ProtectedOperation,
            "Remote name cannot be passed safely to Git",
        ))
    }
}

pub(crate) fn validate_remote_url(url: &str) -> ApiResult<()> {
    let trimmed = url.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('-')
        || url.chars().any(char::is_control)
        || trimmed.contains("::")
    {
        return Err(ApiError::new(
            ErrorCode::ProtectedOperation,
            "Remote URL cannot be passed safely to Git",
        ));
    }
    Ok(())
}

pub(crate) fn is_full_oid(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn invalid_ref() -> ApiError {
    ApiError::new(ErrorCode::InvalidRefName, "Git reference name is invalid")
}
