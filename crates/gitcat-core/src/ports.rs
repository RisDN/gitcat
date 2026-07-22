use std::path::Path;

use async_trait::async_trait;
use gitcat_contracts::*;
use tokio_util::sync::CancellationToken;

#[async_trait]
pub trait GitBackend: Send + Sync {
    async fn probe(&self) -> ApiResult<GitVersion>;
    async fn open_repository(&self, path: &Path) -> ApiResult<RepositoryInfo>;
    async fn init_repository(&self, path: &Path, default_branch: &str)
    -> ApiResult<RepositoryInfo>;
    async fn clone_repository(
        &self,
        options: &CloneOptions,
        cancellation: CancellationToken,
    ) -> ApiResult<RepositoryInfo>;

    async fn snapshot(&self, path: &Path) -> ApiResult<RepositorySnapshot>;
    async fn history(&self, path: &Path, query: &HistoryQuery) -> ApiResult<HistoryPage>;
    async fn search_commits(
        &self,
        path: &Path,
        query: &CommitSearchQuery,
    ) -> ApiResult<CommitSearchResult>;
    async fn commit_details(
        &self,
        path: &Path,
        oid: &str,
        parent_index: usize,
    ) -> ApiResult<CommitDetails>;
    async fn diff(&self, path: &Path, request: &DiffRequest) -> ApiResult<FileDiff>;

    async fn stage_paths(&self, path: &Path, paths: &[String]) -> ApiResult<MutationResult>;
    async fn unstage_paths(&self, path: &Path, paths: &[String]) -> ApiResult<MutationResult>;
    async fn create_commit(
        &self,
        path: &Path,
        options: &CommitOptions,
    ) -> ApiResult<MutationResult>;

    async fn create_branch(
        &self,
        path: &Path,
        name: &str,
        start_oid: &str,
        checkout: bool,
    ) -> ApiResult<MutationResult>;
    async fn checkout_branch(&self, path: &Path, name: &str) -> ApiResult<MutationResult>;
    async fn rename_branch(
        &self,
        path: &Path,
        old_name: &str,
        new_name: &str,
    ) -> ApiResult<MutationResult>;
    async fn delete_branch(
        &self,
        path: &Path,
        name: &str,
        force: bool,
        confirmed: bool,
    ) -> ApiResult<MutationResult>;
    async fn set_upstream(
        &self,
        path: &Path,
        branch: &str,
        upstream: &str,
    ) -> ApiResult<MutationResult>;
    async fn merge_branch(&self, path: &Path, branch: &str) -> ApiResult<MutationResult>;

    async fn fetch(
        &self,
        path: &Path,
        options: &FetchOptions,
        cancellation: CancellationToken,
    ) -> ApiResult<MutationResult>;
    async fn pull(
        &self,
        path: &Path,
        options: &PullOptions,
        cancellation: CancellationToken,
    ) -> ApiResult<MutationResult>;
    async fn push(
        &self,
        path: &Path,
        options: &PushOptions,
        cancellation: CancellationToken,
    ) -> ApiResult<MutationResult>;

    async fn checkout_commit(&self, path: &Path, oid: &str) -> ApiResult<MutationResult>;
    async fn create_tag(
        &self,
        path: &Path,
        name: &str,
        oid: &str,
        message: Option<&str>,
    ) -> ApiResult<MutationResult>;
    async fn cherry_pick(
        &self,
        path: &Path,
        oid: &str,
        mainline_parent: Option<u32>,
    ) -> ApiResult<MutationResult>;
    async fn revert_commit(
        &self,
        path: &Path,
        oid: &str,
        mainline_parent: Option<u32>,
    ) -> ApiResult<MutationResult>;
    async fn reset_to_commit(
        &self,
        path: &Path,
        oid: &str,
        mode: ResetMode,
        confirmed: bool,
    ) -> ApiResult<MutationResult>;
    async fn commit_action_availability(
        &self,
        path: &Path,
        oid: &str,
    ) -> ApiResult<Vec<CommitActionAvailability>>;

    async fn continue_operation(
        &self,
        path: &Path,
        operation: ContinueOperation,
    ) -> ApiResult<MutationResult>;
    async fn abort_operation(
        &self,
        path: &Path,
        operation: ContinueOperation,
    ) -> ApiResult<MutationResult>;

    async fn stash_list(&self, path: &Path) -> ApiResult<Vec<StashEntry>>;
    async fn stash_push(
        &self,
        path: &Path,
        message: Option<&str>,
        include_untracked: bool,
    ) -> ApiResult<MutationResult>;
    async fn stash_apply(&self, path: &Path, index: usize, pop: bool) -> ApiResult<MutationResult>;
    async fn stash_drop(
        &self,
        path: &Path,
        index: usize,
        confirmed: bool,
    ) -> ApiResult<MutationResult>;
}
