mod watcher;

use std::sync::Arc;

use gitcat_contracts::{
    ApiError, ApiResult, AppMetadata, CloneOptions, CommitActionAvailability, CommitDetails,
    CommitOptions, CommitSearchQuery, CommitSearchResult, ConflictExpectedState,
    ConflictFileDetails, ConflictLineEndingPolicy, ConflictPreflightResult, ConflictResolution,
    ContinueOperation, DiffRequest, ErrorCode, ExpectedState, FetchOptions, FileDiff, GitVersion,
    HistoryPage, HistoryQuery, MutationResult, PersistedState, PullOptions, PushOptions,
    RepositoryId, RepositoryInfo, RepositorySnapshot, ResetMode, StashEntry,
};
use gitcat_core::{CoreApi, JsonStateStore};
use gitcat_git_cli::GitCliBackend;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio_util::sync::CancellationToken;

use crate::watcher::RepositoryWatchState;

#[derive(Debug, Serialize)]
pub struct OpenedRepository {
    pub repository_id: RepositoryId,
    pub info: RepositoryInfo,
}

impl From<(RepositoryId, RepositoryInfo)> for OpenedRepository {
    fn from((repository_id, info): (RepositoryId, RepositoryInfo)) -> Self {
        Self {
            repository_id,
            info,
        }
    }
}

#[tauri::command]
fn app_metadata() -> AppMetadata {
    AppMetadata {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        commit: option_env!("GITCAT_BUILD_COMMIT")
            .unwrap_or("unknown")
            .to_owned(),
    }
}

#[tauri::command]
async fn git_probe(core: State<'_, Arc<CoreApi>>) -> ApiResult<GitVersion> {
    core.probe().await
}

#[tauri::command]
async fn repository_open(
    core: State<'_, Arc<CoreApi>>,
    path: String,
) -> ApiResult<OpenedRepository> {
    core.open(path).await.map(Into::into)
}

#[tauri::command]
async fn repository_init(
    core: State<'_, Arc<CoreApi>>,
    path: String,
    default_branch: String,
) -> ApiResult<OpenedRepository> {
    core.init(path, &default_branch).await.map(Into::into)
}

#[tauri::command]
async fn repository_clone(
    core: State<'_, Arc<CoreApi>>,
    options: CloneOptions,
) -> ApiResult<OpenedRepository> {
    core.clone_repository(&options, CancellationToken::new())
        .await
        .map(Into::into)
}

#[tauri::command]
async fn repository_close(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
) -> ApiResult<()> {
    core.close(&repository_id).await
}

#[tauri::command]
async fn repository_snapshot(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
) -> ApiResult<RepositorySnapshot> {
    core.snapshot(&repository_id).await
}

#[tauri::command]
async fn repository_watch(
    core: State<'_, Arc<CoreApi>>,
    watchers: State<'_, RepositoryWatchState>,
    app: AppHandle,
    repository_id: RepositoryId,
) -> ApiResult<()> {
    let root = core.repository_root(&repository_id).await?;
    watchers.watch(app, repository_id, root).map_err(|error| {
        ApiError::new(ErrorCode::Internal, "could not start repository watcher")
            .with_details(error.to_string())
    })
}

#[tauri::command]
fn repository_unwatch(watchers: State<'_, RepositoryWatchState>) {
    watchers.unwatch();
}

fn resolve_inside_root(root: &std::path::Path, relative: &str) -> ApiResult<std::path::PathBuf> {
    let normalized = relative.replace('\\', "/");
    let invalid = || ApiError::new(ErrorCode::InvalidPath, "invalid folder path");
    if normalized.trim().is_empty() {
        return Err(invalid());
    }
    let mut target = root.to_path_buf();
    for segment in normalized.split('/').filter(|segment| !segment.is_empty()) {
        if segment == "." || segment == ".." || segment.contains(':') {
            return Err(invalid());
        }
        target.push(segment);
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|_| ApiError::new(ErrorCode::Internal, "could not resolve repository root"))?;
    let canonical_target = target
        .canonicalize()
        .map_err(|_| ApiError::new(ErrorCode::InvalidPath, "folder does not exist"))?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(invalid());
    }
    if !canonical_target.is_dir() {
        return Err(invalid());
    }
    Ok(canonical_target)
}

#[tauri::command]
async fn repository_reveal(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    path: Option<String>,
) -> ApiResult<()> {
    let worktree = core.repository_root(&repository_id).await?;
    let root = match path.as_deref() {
        Some(relative) => resolve_inside_root(std::path::Path::new(&worktree), relative)?,
        None => std::path::PathBuf::from(&worktree),
    };
    // Single-purpose file-manager launch for a known, open repository root.
    // No shell and no caller-supplied arguments: only the resolved worktree path.
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(&root);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(&root);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(&root);
        command
    };
    // `explorer` exits non-zero even on success, so spawn without inspecting status.
    command.spawn().map(|_| ()).map_err(|error| {
        ApiError::new(ErrorCode::Internal, "could not open repository folder")
            .with_details(error.to_string())
    })
}

#[tauri::command]
async fn history_page(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    query: HistoryQuery,
) -> ApiResult<HistoryPage> {
    core.history(&repository_id, &query).await
}

#[tauri::command]
async fn history_search(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    query: CommitSearchQuery,
) -> ApiResult<CommitSearchResult> {
    core.search(&repository_id, &query).await
}

#[tauri::command]
async fn commit_details(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    oid: String,
    parent_index: usize,
) -> ApiResult<CommitDetails> {
    core.details(&repository_id, &oid, parent_index).await
}

#[tauri::command]
async fn file_diff(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    request: DiffRequest,
) -> ApiResult<FileDiff> {
    core.diff(&repository_id, &request).await
}

#[tauri::command]
async fn conflicts_preflight(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    target: String,
) -> ApiResult<ConflictPreflightResult> {
    core.conflict_preflight(&repository_id, &target).await
}

#[tauri::command]
async fn conflict_details(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    path: String,
) -> ApiResult<ConflictFileDetails> {
    core.conflict_details(&repository_id, &path).await
}

#[tauri::command]
async fn paths_stage(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    paths: Vec<String>,
) -> ApiResult<MutationResult> {
    core.stage(&repository_id, &paths).await
}

#[tauri::command]
async fn paths_unstage(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    paths: Vec<String>,
) -> ApiResult<MutationResult> {
    core.unstage(&repository_id, &paths).await
}

#[tauri::command]
async fn paths_discard(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    paths: Vec<String>,
) -> ApiResult<MutationResult> {
    core.discard(&repository_id, &paths).await
}

#[tauri::command]
async fn path_stash(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    paths: Vec<String>,
    message: Option<String>,
) -> ApiResult<MutationResult> {
    core.stash_file(&repository_id, &paths, message.as_deref())
        .await
}

#[tauri::command]
async fn gitignore_append(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    patterns: Vec<String>,
) -> ApiResult<MutationResult> {
    core.append_gitignore(&repository_id, &patterns).await
}

#[tauri::command]
async fn file_patch_save(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    paths: Vec<String>,
    staged: bool,
    destination: String,
) -> ApiResult<()> {
    let patch = core.create_patch(&repository_id, &paths, staged).await?;
    std::fs::write(&destination, patch).map_err(|error| {
        ApiError::new(ErrorCode::Internal, "could not write patch file")
            .with_details(error.to_string())
    })
}

#[tauri::command]
async fn conflict_resolve(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    path: String,
    resolution: ConflictResolution,
    expected_state: ConflictExpectedState,
) -> ApiResult<MutationResult> {
    core.resolve_conflict(&repository_id, &path, resolution, &expected_state)
        .await
}

#[tauri::command]
async fn conflict_save_edited(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    path: String,
    text: String,
    line_ending: ConflictLineEndingPolicy,
    expected_state: ConflictExpectedState,
) -> ApiResult<MutationResult> {
    core.save_conflict_result(&repository_id, &path, &text, line_ending, &expected_state)
        .await
}

#[tauri::command]
async fn conflicts_auto_resolve(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
) -> ApiResult<MutationResult> {
    core.auto_resolve_conflicts(&repository_id).await
}

#[tauri::command]
async fn create_commit(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    options: CommitOptions,
) -> ApiResult<MutationResult> {
    core.commit(&repository_id, &options).await
}

#[tauri::command]
async fn commit_reword(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    oid: String,
    message: String,
    expected: ExpectedState,
) -> ApiResult<MutationResult> {
    core.reword_commit(&repository_id, &oid, &message, &expected)
        .await
}

#[tauri::command]
async fn branch_create(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    name: String,
    start_oid: String,
    checkout: bool,
) -> ApiResult<MutationResult> {
    core.create_branch(&repository_id, &name, &start_oid, checkout)
        .await
}

#[tauri::command]
async fn branch_checkout(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    name: String,
) -> ApiResult<MutationResult> {
    core.checkout_branch(&repository_id, &name).await
}

#[tauri::command]
async fn branch_rename(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    old_name: String,
    new_name: String,
) -> ApiResult<MutationResult> {
    core.rename_branch(&repository_id, &old_name, &new_name)
        .await
}

#[tauri::command]
async fn branch_delete(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    name: String,
    force: bool,
    confirmed: bool,
    expected: ExpectedState,
) -> ApiResult<MutationResult> {
    core.delete_branch(&repository_id, &name, force, confirmed, &expected)
        .await
}

#[tauri::command]
async fn branch_set_upstream(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    branch: String,
    upstream: String,
) -> ApiResult<MutationResult> {
    core.set_upstream(&repository_id, &branch, &upstream).await
}

#[tauri::command]
async fn branch_merge(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    branch: String,
) -> ApiResult<MutationResult> {
    core.merge_branch(&repository_id, &branch).await
}

#[tauri::command]
async fn remote_fetch(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    options: FetchOptions,
) -> ApiResult<MutationResult> {
    core.fetch(&repository_id, &options, CancellationToken::new())
        .await
}

#[tauri::command]
async fn remote_pull(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    options: PullOptions,
) -> ApiResult<MutationResult> {
    core.pull(&repository_id, &options, CancellationToken::new())
        .await
}

#[tauri::command]
async fn remote_push(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    options: PushOptions,
) -> ApiResult<MutationResult> {
    core.push(&repository_id, &options, CancellationToken::new())
        .await
}

#[tauri::command]
async fn commit_checkout(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    oid: String,
) -> ApiResult<MutationResult> {
    core.checkout_commit(&repository_id, &oid).await
}

#[tauri::command]
async fn tag_create(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    name: String,
    oid: String,
    message: Option<String>,
) -> ApiResult<MutationResult> {
    core.create_tag(&repository_id, &name, &oid, message.as_deref())
        .await
}

#[tauri::command]
async fn commit_cherry_pick(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    oid: String,
    mainline_parent: Option<u32>,
) -> ApiResult<MutationResult> {
    core.cherry_pick(&repository_id, &oid, mainline_parent)
        .await
}

#[tauri::command]
async fn commit_revert(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    oid: String,
    mainline_parent: Option<u32>,
) -> ApiResult<MutationResult> {
    core.revert_commit(&repository_id, &oid, mainline_parent)
        .await
}

#[tauri::command]
async fn commit_reset(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    oid: String,
    mode: ResetMode,
    confirmed: bool,
    expected: ExpectedState,
) -> ApiResult<MutationResult> {
    core.reset_to_commit(&repository_id, &oid, mode, confirmed, &expected)
        .await
}

#[tauri::command]
async fn commit_action_availability(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    oid: String,
) -> ApiResult<Vec<CommitActionAvailability>> {
    core.commit_action_availability(&repository_id, &oid).await
}

#[tauri::command]
async fn operation_continue(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    operation: ContinueOperation,
) -> ApiResult<MutationResult> {
    core.continue_operation(&repository_id, operation).await
}

#[tauri::command]
async fn operation_abort(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    operation: ContinueOperation,
) -> ApiResult<MutationResult> {
    core.abort_operation(&repository_id, operation).await
}

#[tauri::command]
async fn stash_list(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
) -> ApiResult<Vec<StashEntry>> {
    core.stash_list(&repository_id).await
}

#[tauri::command]
async fn stash_push(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    message: Option<String>,
    include_untracked: bool,
) -> ApiResult<MutationResult> {
    core.stash_push(&repository_id, message.as_deref(), include_untracked)
        .await
}

#[tauri::command]
async fn stash_apply(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    index: usize,
    pop: bool,
) -> ApiResult<MutationResult> {
    core.stash_apply(&repository_id, index, pop).await
}

#[tauri::command]
async fn stash_drop(
    core: State<'_, Arc<CoreApi>>,
    repository_id: RepositoryId,
    index: usize,
    confirmed: bool,
    expected: ExpectedState,
) -> ApiResult<MutationResult> {
    core.stash_drop(&repository_id, index, confirmed, &expected)
        .await
}

#[tauri::command]
async fn persisted_state_load(store: State<'_, JsonStateStore>) -> ApiResult<PersistedState> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.load())
        .await
        .map_err(task_join_error)?
}

#[tauri::command]
async fn persisted_state_save(
    store: State<'_, JsonStateStore>,
    state: PersistedState,
) -> ApiResult<()> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.save(&state))
        .await
        .map_err(task_join_error)?
}

fn task_join_error(error: impl std::fmt::Display) -> ApiError {
    ApiError::new(
        gitcat_contracts::ErrorCode::Internal,
        "background state task failed",
    )
    .with_details(error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state_path = app.path().app_data_dir()?.join("state.json");
            let backend = Arc::new(GitCliBackend::default());
            app.manage(Arc::new(CoreApi::new(backend)));
            app.manage(JsonStateStore::new(state_path));
            app.manage(RepositoryWatchState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_metadata,
            git_probe,
            repository_open,
            repository_init,
            repository_clone,
            repository_close,
            repository_snapshot,
            repository_watch,
            repository_unwatch,
            repository_reveal,
            history_page,
            history_search,
            commit_details,
            file_diff,
            conflicts_preflight,
            conflict_details,
            paths_stage,
            paths_unstage,
            paths_discard,
            path_stash,
            gitignore_append,
            file_patch_save,
            conflict_resolve,
            conflict_save_edited,
            conflicts_auto_resolve,
            create_commit,
            commit_reword,
            branch_create,
            branch_checkout,
            branch_rename,
            branch_delete,
            branch_set_upstream,
            branch_merge,
            remote_fetch,
            remote_pull,
            remote_push,
            commit_checkout,
            tag_create,
            commit_cherry_pick,
            commit_revert,
            commit_reset,
            commit_action_availability,
            operation_continue,
            operation_abort,
            stash_list,
            stash_push,
            stash_apply,
            stash_drop,
            persisted_state_load,
            persisted_state_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitCat");
}
