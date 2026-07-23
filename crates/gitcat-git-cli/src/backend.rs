use std::{
    collections::{HashMap, hash_map::DefaultHasher},
    ffi::OsString,
    fs,
    hash::{Hash, Hasher},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use async_trait::async_trait;
use gitcat_contracts::*;
use gitcat_core::{GitBackend, layout_commits};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use tokio_util::sync::CancellationToken;

use crate::{
    parse::{
        DETAIL_FORMAT, LOG_FORMAT, ParsedStatus, REF_FORMAT, STASH_FORMAT, STASH_GRAPH_FORMAT,
        StashGraph, parse_changed_files, parse_commit_details, parse_file_diff, parse_git_version,
        parse_line_stats, parse_log, parse_refs, parse_search_hits, parse_stash_graph,
        parse_stashes, parse_status,
    },
    runner::{GitCommandOutput, GitRunOptions, GitRunner, os_args, redact_sensitive},
};

const READ_OUTPUT_CAP: usize = 32 * 1024 * 1024;
const NETWORK_OUTPUT_CAP: usize = 4 * 1024 * 1024;
const MAX_HISTORY_PAGE: usize = 500;
const MAX_SEARCH_RESULTS: usize = 10_000;
const MAX_DIFF_BYTES: usize = 128 * 1024 * 1024;
const MAX_COMMIT_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_CONFLICT_TEXT_BYTES: usize = 1024 * 1024;
const MAX_UNTRACKED_STAT_BYTES: u64 = 1024 * 1024;
const MAX_UNTRACKED_STAT_FILES: usize = 2000;

#[derive(Debug, Clone, PartialEq, Eq)]
struct UnmergedIndexEntry {
    mode: String,
    oid: String,
    stage: u8,
}

#[derive(Debug)]
struct InspectedConflictResult {
    content: ConflictFileContent,
    identity: ConflictWorktreeIdentity,
}

#[derive(Debug, Clone)]
struct CommitAuthor {
    name: String,
    email: String,
    date: String,
}

impl CommitAuthor {
    fn into_env(self) -> Vec<(OsString, OsString)> {
        vec![
            ("GIT_AUTHOR_NAME".into(), self.name.into()),
            ("GIT_AUTHOR_EMAIL".into(), self.email.into()),
            ("GIT_AUTHOR_DATE".into(), self.date.into()),
        ]
    }
}

#[derive(Debug, Clone, Default)]
pub struct GitCliBackend {
    runner: GitRunner,
}

impl GitCliBackend {
    pub fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            runner: GitRunner::new(executable),
        }
    }

    async fn read(&self, path: Option<&Path>, args: Vec<OsString>) -> ApiResult<GitCommandOutput> {
        self.runner
            .run(
                path,
                &args,
                None,
                CancellationToken::new(),
                GitRunOptions::read_only(READ_OUTPUT_CAP),
            )
            .await
    }

    async fn read_allow_failure(
        &self,
        path: Option<&Path>,
        args: Vec<OsString>,
    ) -> ApiResult<GitCommandOutput> {
        let mut options = GitRunOptions::read_only(READ_OUTPUT_CAP);
        options.allow_failure = true;
        self.runner
            .run(path, &args, None, CancellationToken::new(), options)
            .await
    }

    async fn is_untracked_file(&self, path: &Path, relative: &str) -> ApiResult<bool> {
        if !path.join(relative).is_file() {
            return Ok(false);
        }
        let args = vec![
            "ls-files".into(),
            "-z".into(),
            "--".into(),
            OsString::from(relative),
        ];
        let listed = self.read(Some(path), args).await?;
        Ok(listed.stdout.iter().all(|byte| *byte == 0))
    }

    async fn untracked_diff(&self, path: &Path, request: &DiffRequest) -> ApiResult<FileDiff> {
        let mut args = os_args(&[
            "diff",
            "--no-index",
            "--patch",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
        ]);
        args.push(format!("--unified={}", request.context_lines.min(100)).into());
        if request.ignore_whitespace {
            args.push("--ignore-all-space".into());
        }
        args.push("--".into());
        args.push("/dev/null".into());
        args.push(request.path.as_str().into());
        let mut options = GitRunOptions::read_only(request.max_bytes.clamp(1, MAX_DIFF_BYTES));
        options.allow_stdout_truncation = true;
        options.allow_failure = true;
        options.timeout = Some(Duration::from_secs(60));
        let output = self
            .runner
            .run(Some(path), &args, None, CancellationToken::new(), options)
            .await?;
        if !matches!(output.status.code(), Some(0 | 1)) {
            return Err(self.runner.failure_error(&output));
        }
        parse_file_diff(&output.stdout, &request.path, output.stdout_truncated)
    }

    async fn inspect_repository(&self, path: &Path) -> ApiResult<RepositoryInfo> {
        let selected = dunce::canonicalize(path).map_err(|error| {
            ApiError::new(
                ErrorCode::InvalidPath,
                "Repository path could not be resolved",
            )
            .with_details(format!("{}: {error}", path.display()))
        })?;
        if !selected.is_dir() {
            return Err(ApiError::new(
                ErrorCode::InvalidPath,
                "Repository path must be a directory",
            ));
        }

        let bare = self
            .read(
                Some(&selected),
                os_args(&["rev-parse", "--is-bare-repository"]),
            )
            .await?
            .stdout_lossy()
            .trim()
            == "true";
        if bare {
            return Err(ApiError::new(
                ErrorCode::UnsupportedOperation,
                "Bare repositories are not supported by the desktop worktree API",
            ));
        }
        let root = if bare {
            selected.clone()
        } else {
            let output = self
                .read(Some(&selected), os_args(&["rev-parse", "--show-toplevel"]))
                .await?;
            dunce::canonicalize(output.stdout_lossy().trim()).map_err(|error| {
                ApiError::new(
                    ErrorCode::InvalidRepository,
                    "Repository root could not be resolved",
                )
                .with_details(error.to_string())
            })?
        };

        let git_dir_output = self
            .read(
                Some(&selected),
                os_args(&["rev-parse", "--absolute-git-dir"]),
            )
            .await?;
        let git_dir = canonical_or_absolute(&selected, git_dir_output.stdout_lossy().trim())?;
        let common_output = self
            .read(
                Some(&selected),
                os_args(&["rev-parse", "--path-format=absolute", "--git-common-dir"]),
            )
            .await?;
        let common_dir = canonical_or_absolute(&selected, common_output.stdout_lossy().trim())?;

        let format_output = self
            .read_allow_failure(
                Some(&selected),
                os_args(&["rev-parse", "--show-object-format"]),
            )
            .await?;
        let object_format = if format_output.success() {
            match format_output.stdout_lossy().trim() {
                "sha1" => ObjectFormat::Sha1,
                "sha256" => ObjectFormat::Sha256,
                _ => ObjectFormat::Unknown,
            }
        } else {
            ObjectFormat::Sha1
        };
        let name = root
            .file_name()
            .unwrap_or(root.as_os_str())
            .to_string_lossy()
            .into_owned();
        Ok(RepositoryInfo {
            root: root.to_string_lossy().into_owned(),
            git_dir: git_dir.to_string_lossy().into_owned(),
            common_dir: common_dir.to_string_lossy().into_owned(),
            name,
            is_bare: bare,
            object_format,
        })
    }

    async fn status_output(&self, path: &Path) -> ApiResult<GitCommandOutput> {
        self.read(
            Some(path),
            os_args(&[
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--show-stash",
                "--untracked-files=all",
            ]),
        )
        .await
    }

    async fn line_stats(&self, path: &Path, cached: bool) -> ApiResult<HashMap<String, LineStats>> {
        let mut args = os_args(&[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "-M",
            "--numstat",
            "-z",
        ]);
        if cached {
            args.push("--cached".into());
        }
        let output = self.read_allow_failure(Some(path), args).await?;
        if !output.success() {
            return Ok(HashMap::new());
        }
        parse_line_stats(&output.stdout)
    }

    // Untracked files never reach `git diff --numstat`, so their additions come
    // from counting the lines on disk. Large or binary files stay unmeasured.
    async fn untracked_line_stats(
        &self,
        path: &Path,
        paths: Vec<String>,
    ) -> ApiResult<HashMap<String, LineStats>> {
        if paths.is_empty() {
            return Ok(HashMap::new());
        }
        let root = path.to_path_buf();
        tokio::task::spawn_blocking(move || {
            let mut stats = HashMap::new();
            for relative in paths.into_iter().take(MAX_UNTRACKED_STAT_FILES) {
                let file = root.join(&relative);
                let Ok(metadata) = fs::metadata(&file) else {
                    continue;
                };
                if !metadata.is_file() || metadata.len() > MAX_UNTRACKED_STAT_BYTES {
                    continue;
                }
                let Ok(bytes) = fs::read(&file) else {
                    continue;
                };
                if bytes.contains(&0) {
                    continue;
                }
                let lines = bytes.iter().filter(|byte| **byte == b'\n').count() as u64
                    + u64::from(!bytes.is_empty() && !bytes.ends_with(b"\n"));
                stats.insert(
                    relative,
                    LineStats {
                        additions: lines,
                        deletions: 0,
                    },
                );
            }
            stats
        })
        .await
        .map_err(blocking_line_stats_task_error)
    }

    async fn apply_line_stats(&self, path: &Path, status: &mut WorktreeStatus) -> ApiResult<()> {
        if status.entries.is_empty() {
            return Ok(());
        }
        let untracked: Vec<String> = status
            .entries
            .iter()
            .filter(|entry| {
                matches!(entry.worktree, Some(ChangeKind::Untracked)) && !entry.submodule
            })
            .map(|entry| entry.path.clone())
            .collect();
        let (worktree, index, new_files) = tokio::try_join!(
            self.line_stats(path, false),
            self.line_stats(path, true),
            self.untracked_line_stats(path, untracked)
        )?;
        for entry in &mut status.entries {
            entry.index_stats = index.get(&entry.path).copied();
            entry.worktree_stats = if matches!(entry.worktree, Some(ChangeKind::Untracked)) {
                new_files.get(&entry.path).copied()
            } else {
                worktree.get(&entry.path).copied()
            };
        }
        Ok(())
    }

    async fn refs_output(&self, path: &Path) -> ApiResult<GitCommandOutput> {
        let mut args = os_args(&["for-each-ref"]);
        args.push(format!("--format={REF_FORMAT}").into());
        args.extend(os_args(&["refs/heads", "refs/remotes", "refs/tags"]));
        self.read(Some(path), args).await
    }

    async fn generation_and_refs(&self, path: &Path) -> ApiResult<(String, Vec<u8>, ParsedStatus)> {
        let (status, refs) = tokio::try_join!(self.status_output(path), self.refs_output(path))?;
        let parsed = parse_status(&status.stdout)?;
        let mut hasher = DefaultHasher::new();
        status.stdout.hash(&mut hasher);
        refs.stdout.hash(&mut hasher);
        Ok((format!("{:016x}", hasher.finish()), refs.stdout, parsed))
    }

    async fn history_generation_and_refs(&self, path: &Path) -> ApiResult<(String, Vec<u8>)> {
        let (refs, head) = tokio::try_join!(
            self.refs_output(path),
            self.read_allow_failure(
                Some(path),
                os_args(&["rev-parse", "--verify", "--end-of-options", "HEAD"]),
            )
        )?;
        let refs = refs.stdout;
        let mut hasher = DefaultHasher::new();
        refs.hash(&mut hasher);
        head.status.code().hash(&mut hasher);
        head.stdout.hash(&mut hasher);
        Ok((format!("{:016x}", hasher.finish()), refs))
    }

    async fn head_oid(&self, path: &Path) -> ApiResult<Option<String>> {
        let output = self
            .read_allow_failure(
                Some(path),
                os_args(&["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"]),
            )
            .await?;
        if output.success() {
            Ok(Some(output.stdout_lossy().trim().to_owned()))
        } else {
            Ok(None)
        }
    }

    async fn resolve_commit(&self, path: &Path, revision: &str) -> ApiResult<String> {
        if revision.is_empty() || revision.contains(['\0', '\n', '\r']) {
            return Err(ApiError::new(
                ErrorCode::InvalidRevision,
                "Git revision is empty or malformed",
            ));
        }
        let expression = format!("{revision}^{{commit}}");
        let output = self
            .read(
                Some(path),
                vec![
                    "rev-parse".into(),
                    "--verify".into(),
                    "--end-of-options".into(),
                    expression.into(),
                ],
            )
            .await
            .map_err(|error| {
                if matches!(
                    error.code,
                    ErrorCode::GitCommandFailed | ErrorCode::InvalidRevision
                ) {
                    ApiError::new(
                        ErrorCode::InvalidRevision,
                        "Git revision could not be resolved",
                    )
                } else {
                    error
                }
            })?;
        let oid = output.stdout_lossy().trim().to_owned();
        if !is_full_oid(&oid) {
            return Err(ApiError::new(
                ErrorCode::InvalidRevision,
                "Git did not resolve the revision to a full object ID",
            ));
        }
        Ok(oid)
    }

    async fn commit_parent_oids(&self, path: &Path, oid: &str) -> ApiResult<Vec<String>> {
        let output = self
            .read(
                Some(path),
                vec![
                    "show".into(),
                    "-s".into(),
                    "--format=%P".into(),
                    oid.into(),
                    "--".into(),
                ],
            )
            .await?;
        Ok(output
            .stdout_lossy()
            .split_whitespace()
            .map(str::to_owned)
            .collect())
    }

    async fn is_ancestor(&self, path: &Path, ancestor: &str, descendant: &str) -> ApiResult<bool> {
        let output = self
            .read_allow_failure(
                Some(path),
                vec![
                    "merge-base".into(),
                    "--is-ancestor".into(),
                    ancestor.into(),
                    descendant.into(),
                ],
            )
            .await?;
        Ok(output.success())
    }

    async fn range_has_merge(&self, path: &Path, base: &str, head: &str) -> ApiResult<bool> {
        // Merges strictly after `base` would be linearized by a plain rebase,
        // so callers reject rewording when any exist.
        let output = self
            .read(
                Some(path),
                vec![
                    "rev-list".into(),
                    "--merges".into(),
                    "--max-count=1".into(),
                    format!("{base}..{head}").into(),
                    "--".into(),
                ],
            )
            .await?;
        Ok(!output.stdout_lossy().trim().is_empty())
    }

    async fn read_commit_author(&self, path: &Path, oid: &str) -> ApiResult<CommitAuthor> {
        let output = self
            .read(
                Some(path),
                vec![
                    "show".into(),
                    "-s".into(),
                    "--date=raw".into(),
                    "--format=%an%x00%ae%x00%ad".into(),
                    oid.into(),
                    "--".into(),
                ],
            )
            .await?;
        let raw = output.stdout_lossy();
        let mut parts = raw.trim_end_matches(['\n', '\r']).splitn(3, '\0');
        Ok(CommitAuthor {
            name: parts.next().unwrap_or_default().to_owned(),
            email: parts.next().unwrap_or_default().to_owned(),
            date: parts.next().unwrap_or_default().to_owned(),
        })
    }

    /// Rebuilds `oid` with `message`, preserving its tree, parents and
    /// authorship, and returns the new (dangling) commit object id.
    async fn rebuild_commit_message(
        &self,
        path: &Path,
        oid: &str,
        message: &str,
    ) -> ApiResult<String> {
        let tree = self
            .read(
                Some(path),
                vec![
                    "rev-parse".into(),
                    "--verify".into(),
                    "--end-of-options".into(),
                    format!("{oid}^{{tree}}").into(),
                ],
            )
            .await?
            .stdout_lossy()
            .trim()
            .to_owned();
        if !is_full_oid(&tree) {
            return Err(ApiError::new(
                ErrorCode::GitCommandFailed,
                "Git did not resolve the commit tree",
            ));
        }
        let parents = self.commit_parent_oids(path, oid).await?;
        let author = self.read_commit_author(path, oid).await?;

        let mut args: Vec<OsString> = vec!["commit-tree".into(), tree.into()];
        for parent in parents {
            args.push("-p".into());
            args.push(parent.into());
        }
        args.push("-F".into());
        args.push("-".into());

        let mut options = GitRunOptions::mutation(READ_OUTPUT_CAP);
        options.extra_env = author.into_env();
        let output = self
            .runner
            .run(
                Some(path),
                &args,
                Some(message.as_bytes()),
                CancellationToken::new(),
                options,
            )
            .await?;
        let new_oid = output.stdout_lossy().trim().to_owned();
        if !is_full_oid(&new_oid) {
            return Err(ApiError::new(
                ErrorCode::GitCommandFailed,
                "Git did not return a rewritten commit object",
            ));
        }
        Ok(new_oid)
    }

    async fn validate_branch_name(&self, name: &str) -> ApiResult<()> {
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

    async fn validate_tag_name(&self, name: &str) -> ApiResult<()> {
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

    async fn git_dir(&self, path: &Path) -> ApiResult<PathBuf> {
        let output = self
            .read(Some(path), os_args(&["rev-parse", "--absolute-git-dir"]))
            .await?;
        canonical_or_absolute(path, output.stdout_lossy().trim())
    }

    async fn operation_state(&self, path: &Path) -> ApiResult<RepositoryOperationState> {
        let git_dir = self.git_dir(path).await?;
        Ok(operation_state_from_git_dir(&git_dir))
    }

    async fn remotes(&self, path: &Path) -> ApiResult<Vec<RemoteInfo>> {
        let output = self.read(Some(path), os_args(&["remote"])).await?;
        let mut remotes = Vec::new();
        for name in output
            .stdout_lossy()
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
        {
            validate_remote_name(name)?;
            let fetch = self
                .read(
                    Some(path),
                    vec!["remote".into(), "get-url".into(), name.into()],
                )
                .await?;
            let fetch_url = fetch.stdout_lossy().trim().to_owned();
            validate_remote_url(&fetch_url)?;
            let mut push_options = GitRunOptions::read_only(READ_OUTPUT_CAP);
            push_options.allow_failure = true;
            let push = self
                .runner
                .run(
                    Some(path),
                    &[
                        "remote".into(),
                        "get-url".into(),
                        "--push".into(),
                        name.into(),
                    ],
                    None,
                    CancellationToken::new(),
                    push_options,
                )
                .await?;
            let push_url = if push.success() {
                push.stdout_lossy().trim().to_owned()
            } else {
                fetch_url.clone()
            };
            validate_remote_url(&push_url)?;
            remotes.push(RemoteInfo {
                name: name.to_owned(),
                fetch_url: redact_sensitive(&fetch_url),
                push_url: redact_sensitive(&push_url),
            });
        }
        Ok(remotes)
    }

    async fn validate_remote_selection(&self, path: &Path, remote: Option<&str>) -> ApiResult<()> {
        let remotes = self.remotes(path).await?;
        if let Some(remote) = remote {
            validate_remote_name(remote)?;
            if !remotes.iter().any(|entry| entry.name == remote) {
                return Err(ApiError::new(
                    ErrorCode::InvalidSettings,
                    "Selected remote does not exist",
                ));
            }
        } else if remotes.is_empty() {
            return Err(ApiError::new(
                ErrorCode::UpstreamMissing,
                "Repository has no configured remote",
            ));
        }
        Ok(())
    }

    async fn mutation_result(
        &self,
        path: &Path,
        before_oid: Option<String>,
    ) -> ApiResult<MutationResult> {
        let after_oid = self.head_oid(path).await?;
        let (generation, _, parsed_status) = self.generation_and_refs(path).await?;
        let conflicts: Vec<_> = parsed_status
            .status
            .entries
            .iter()
            .filter(|entry| entry.conflicted)
            .cloned()
            .collect();
        let needs_user_action = !conflicts.is_empty()
            || self.operation_state(path).await? != RepositoryOperationState::Normal;
        Ok(MutationResult {
            before_oid,
            after_oid,
            generation,
            conflicts,
            needs_user_action,
        })
    }

    async fn mutate(
        &self,
        path: &Path,
        args: Vec<OsString>,
        stdin: Option<&[u8]>,
        cancellation: CancellationToken,
        network: bool,
    ) -> ApiResult<MutationResult> {
        let before_oid = self.head_oid(path).await?;
        let mut options = if network {
            GitRunOptions::network(NETWORK_OUTPUT_CAP)
        } else {
            GitRunOptions::mutation(READ_OUTPUT_CAP)
        };
        options.allow_failure = true;
        let output = self
            .runner
            .run(Some(path), &args, stdin, cancellation, options)
            .await?;
        if output.success() {
            return self.mutation_result(path, before_oid).await;
        }
        let result = self.mutation_result(path, before_oid).await?;
        let failure = self.runner.failure_error(&output);
        if result.needs_user_action && failure.code == ErrorCode::ConflictsPresent {
            Ok(result)
        } else {
            Err(failure)
        }
    }

    async fn ensure_conflicted_path(&self, path: &Path, conflict_path: &str) -> ApiResult<()> {
        validate_relative_path(conflict_path)?;
        let output = self.status_output(path).await?;
        let status = parse_status(&output.stdout)?.status;
        if status
            .entries
            .iter()
            .any(|entry| entry.conflicted && entry.path == conflict_path)
        {
            Ok(())
        } else {
            Err(ApiError::new(
                ErrorCode::InvalidRequest,
                "Selected path is not currently conflicted",
            )
            .with_details(conflict_path.to_owned()))
        }
    }

    async fn unmerged_index_entries(
        &self,
        path: &Path,
        conflict_path: &str,
    ) -> ApiResult<Vec<UnmergedIndexEntry>> {
        validate_relative_path(conflict_path)?;
        let mut args = os_args(&[
            "--literal-pathspecs",
            "ls-files",
            "--unmerged",
            "--stage",
            "-z",
            "--",
        ]);
        args.push(conflict_path.into());
        let output = self.read(Some(path), args).await?;
        parse_unmerged_index_entries(&output.stdout, conflict_path)
    }

    async fn ensure_expected_conflict(
        &self,
        path: &Path,
        conflict_path: &str,
        expected_state: &ConflictExpectedState,
    ) -> ApiResult<Vec<UnmergedIndexEntry>> {
        if let Err(error) = self.ensure_conflicted_path(path, conflict_path).await {
            let had_expected_stages = expected_state.base.is_some()
                || expected_state.ours.is_some()
                || expected_state.theirs.is_some();
            if error.code == ErrorCode::InvalidRequest && had_expected_stages {
                return Err(ApiError::new(
                    ErrorCode::StaleSnapshot,
                    "Conflict changed after the editor was opened",
                )
                .with_details(conflict_path.to_owned()));
            }
            return Err(error);
        }
        let entries = self.unmerged_index_entries(path, conflict_path).await?;
        let worktree = self
            .inspect_conflict_result_async(path, conflict_path)
            .await?;
        let actual = conflict_expected_state(&entries, worktree.identity);
        if actual != *expected_state {
            return Err(ApiError::new(
                ErrorCode::StaleSnapshot,
                "Conflict changed after the editor was opened",
            )
            .with_details(conflict_path.to_owned()));
        }
        Ok(entries)
    }

    async fn conflict_blob_content(
        &self,
        path: &Path,
        oid: &str,
        mode: &str,
    ) -> ApiResult<ConflictFileContent> {
        if !is_full_oid(oid) {
            return Err(ApiError::new(
                ErrorCode::GitCommandFailed,
                "Conflict index contains an invalid object ID",
            ));
        }
        let size_output = self
            .read(Some(path), vec!["cat-file".into(), "-s".into(), oid.into()])
            .await?;
        let size = size_output
            .stdout_lossy()
            .trim()
            .parse::<u64>()
            .map_err(|error| {
                ApiError::new(
                    ErrorCode::GitCommandFailed,
                    "Git returned an invalid conflict blob size",
                )
                .with_details(error.to_string())
            })?;
        if !matches!(mode, "100644" | "100755") {
            return Ok(ConflictFileContent {
                kind: ConflictContentKind::Binary,
                size: Some(size),
                text: None,
                line_ending: None,
            });
        }
        if size > MAX_CONFLICT_TEXT_BYTES as u64 {
            return Ok(ConflictFileContent {
                kind: ConflictContentKind::TooLarge,
                size: Some(size),
                text: None,
                line_ending: None,
            });
        }

        let content = self
            .read(
                Some(path),
                vec!["cat-file".into(), "blob".into(), oid.into()],
            )
            .await?
            .stdout;
        Ok(classify_conflict_content(content, size))
    }

    async fn conflict_index_version(
        &self,
        path: &Path,
        entry: &UnmergedIndexEntry,
    ) -> ApiResult<ConflictIndexVersion> {
        Ok(ConflictIndexVersion {
            oid: entry.oid.clone(),
            mode: entry.mode.clone(),
            content: self
                .conflict_blob_content(path, &entry.oid, &entry.mode)
                .await?,
        })
    }

    fn inspect_conflict_result(
        &self,
        path: &Path,
        conflict_path: &str,
    ) -> ApiResult<InspectedConflictResult> {
        let target = checked_worktree_target(path, conflict_path, false)?;
        let metadata = match fs::symlink_metadata(&target) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(InspectedConflictResult {
                    content: ConflictFileContent {
                        kind: ConflictContentKind::Missing,
                        size: None,
                        text: None,
                        line_ending: None,
                    },
                    identity: missing_worktree_identity(),
                });
            }
            Err(error) => {
                return Err(ApiError::new(
                    ErrorCode::Io,
                    "Conflict result metadata could not be read",
                )
                .with_details(error.to_string()));
            }
        };
        if metadata.file_type().is_symlink() {
            let link = fs::read_link(&target).map_err(|error| {
                ApiError::new(ErrorCode::Io, "Conflict symlink target could not be read")
                    .with_details(error.to_string())
            })?;
            let link_bytes = os_string_bytes(link.as_os_str());
            let size = link_bytes.len() as u64;
            return Ok(InspectedConflictResult {
                content: ConflictFileContent {
                    kind: ConflictContentKind::Binary,
                    size: Some(size),
                    text: None,
                    line_ending: None,
                },
                identity: ConflictWorktreeIdentity {
                    kind: ConflictWorktreeKind::Symlink,
                    size: Some(size),
                    sha256: Some(sha256_hex(&link_bytes)),
                    line_ending: None,
                    mode: None,
                },
            });
        }
        if !metadata.is_file() {
            return Err(ApiError::new(
                ErrorCode::InvalidPath,
                "Conflict result path is not a regular file or symbolic link",
            ));
        }
        let mut file = fs::File::open(&target).map_err(|error| {
            ApiError::new(ErrorCode::Io, "Conflict result could not be opened")
                .with_details(error.to_string())
        })?;
        let mut hasher = Sha256::new();
        let mut preview = Vec::with_capacity(MAX_CONFLICT_TEXT_BYTES + 1);
        let mut buffer = [0_u8; 64 * 1024];
        let mut size = 0_u64;
        loop {
            let read = file.read(&mut buffer).map_err(|error| {
                ApiError::new(ErrorCode::Io, "Conflict result could not be read")
                    .with_details(error.to_string())
            })?;
            if read == 0 {
                break;
            }
            size = size.checked_add(read as u64).ok_or_else(|| {
                ApiError::new(ErrorCode::OutputTooLarge, "Conflict result size overflowed")
            })?;
            hasher.update(&buffer[..read]);
            if preview.len() <= MAX_CONFLICT_TEXT_BYTES {
                let remaining = MAX_CONFLICT_TEXT_BYTES + 1 - preview.len();
                preview.extend_from_slice(&buffer[..read.min(remaining)]);
            }
        }
        let content = if size > MAX_CONFLICT_TEXT_BYTES as u64 {
            ConflictFileContent {
                kind: ConflictContentKind::TooLarge,
                size: Some(size),
                text: None,
                line_ending: None,
            }
        } else {
            classify_conflict_content(preview, size)
        };
        Ok(InspectedConflictResult {
            identity: ConflictWorktreeIdentity {
                kind: ConflictWorktreeKind::Regular,
                size: Some(size),
                sha256: Some(format!("{:x}", hasher.finalize())),
                line_ending: content.line_ending,
                mode: conflict_file_mode(&metadata),
            },
            content,
        })
    }

    async fn inspect_conflict_result_async(
        &self,
        path: &Path,
        conflict_path: &str,
    ) -> ApiResult<InspectedConflictResult> {
        let backend = self.clone();
        let path = path.to_path_buf();
        let conflict_path = conflict_path.to_owned();
        tokio::task::spawn_blocking(move || backend.inspect_conflict_result(&path, &conflict_path))
            .await
            .map_err(blocking_conflict_task_error)?
    }

    fn write_conflict_result(
        &self,
        path: &Path,
        conflict_path: &str,
        text: &str,
        line_ending: ConflictLineEndingPolicy,
        expected_result: &ConflictWorktreeIdentity,
        desired_mode: &str,
    ) -> ApiResult<()> {
        let current = self.inspect_conflict_result(path, conflict_path)?;
        if current.identity != *expected_result {
            return Err(ApiError::new(
                ErrorCode::StaleSnapshot,
                "Conflict result changed after the editor was opened",
            )
            .with_details(conflict_path.to_owned()));
        }
        let bytes = encode_edited_conflict_text(text, line_ending, &current.content)?;
        if bytes.len() > MAX_CONFLICT_TEXT_BYTES {
            return Err(ApiError::new(
                ErrorCode::OutputTooLarge,
                "Edited conflict result exceeds the safe editor limit",
            )
            .with_details(format!(
                "maximum={} bytes, actual={} bytes",
                MAX_CONFLICT_TEXT_BYTES,
                bytes.len()
            )));
        }
        let target = checked_worktree_target(path, conflict_path, true)?;
        let parent = target.parent().ok_or_else(|| {
            ApiError::new(ErrorCode::InvalidPath, "Conflict result parent is missing")
        })?;
        let original_permissions = fs::symlink_metadata(&target)
            .ok()
            .filter(|metadata| metadata.is_file())
            .map(|metadata| metadata.permissions());
        let mut temporary = new_conflict_temporary(
            parent,
            original_permissions.is_none().then_some(desired_mode),
        )?;
        if let Some(permissions) = original_permissions {
            temporary
                .as_file()
                .set_permissions(permissions)
                .map_err(|error| {
                    ApiError::new(
                        ErrorCode::Io,
                        "Conflict result permissions could not be preserved",
                    )
                    .with_details(error.to_string())
                })?;
        }
        temporary.write_all(&bytes).map_err(|error| {
            ApiError::new(ErrorCode::Io, "Edited conflict result could not be written")
                .with_details(error.to_string())
        })?;
        temporary.flush().map_err(|error| {
            ApiError::new(ErrorCode::Io, "Edited conflict result could not be flushed")
                .with_details(error.to_string())
        })?;
        temporary.as_file().sync_all().map_err(|error| {
            ApiError::new(ErrorCode::Io, "Edited conflict result could not be synced")
                .with_details(error.to_string())
        })?;

        checked_worktree_target(path, conflict_path, true)?;
        let immediately_before_replace = self.inspect_conflict_result(path, conflict_path)?;
        if immediately_before_replace.identity != *expected_result {
            return Err(ApiError::new(
                ErrorCode::StaleSnapshot,
                "Conflict result changed while the edited result was being saved",
            )
            .with_details(conflict_path.to_owned()));
        }
        temporary.persist(&target).map_err(|error| {
            ApiError::new(
                ErrorCode::Io,
                "Edited conflict result could not atomically replace the working file",
            )
            .with_details(error.error.to_string())
        })?;
        Ok(())
    }

    async fn write_conflict_result_async(
        &self,
        path: &Path,
        conflict_path: &str,
        text: &str,
        line_ending: ConflictLineEndingPolicy,
        expected_result: &ConflictWorktreeIdentity,
        desired_mode: &str,
    ) -> ApiResult<()> {
        let backend = self.clone();
        let path = path.to_path_buf();
        let conflict_path = conflict_path.to_owned();
        let text = text.to_owned();
        let expected_result = expected_result.clone();
        let desired_mode = desired_mode.to_owned();
        tokio::task::spawn_blocking(move || {
            backend.write_conflict_result(
                &path,
                &conflict_path,
                &text,
                line_ending,
                &expected_result,
                &desired_mode,
            )
        })
        .await
        .map_err(blocking_conflict_task_error)?
    }

    async fn stage_conflict_path(
        &self,
        path: &Path,
        conflict_path: &str,
    ) -> ApiResult<MutationResult> {
        let mut args = os_args(&["--literal-pathspecs", "add", "--"]);
        args.push(conflict_path.into());
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn changed_files_for_commit(
        &self,
        path: &Path,
        oid: &str,
        parents: &[String],
        parent_index: usize,
    ) -> ApiResult<Vec<ChangedFile>> {
        let (name_args, stat_args) = if parents.is_empty() {
            if parent_index != 0 {
                return Err(ApiError::new(
                    ErrorCode::InvalidRevision,
                    "Root commit has no selected parent",
                ));
            }
            (
                vec![
                    "diff-tree".into(),
                    "--root".into(),
                    "--no-commit-id".into(),
                    "-r".into(),
                    "-M".into(),
                    "--name-status".into(),
                    "-z".into(),
                    oid.into(),
                ],
                vec![
                    "diff-tree".into(),
                    "--root".into(),
                    "--no-commit-id".into(),
                    "-r".into(),
                    "-M".into(),
                    "--numstat".into(),
                    "-z".into(),
                    oid.into(),
                ],
            )
        } else {
            let parent = parents.get(parent_index).ok_or_else(|| {
                ApiError::new(
                    ErrorCode::InvalidRevision,
                    "Commit parent index is out of range",
                )
            })?;
            (
                vec![
                    "diff".into(),
                    "--no-ext-diff".into(),
                    "--no-textconv".into(),
                    "-M".into(),
                    "--name-status".into(),
                    "-z".into(),
                    parent.into(),
                    oid.into(),
                    "--".into(),
                ],
                vec![
                    "diff".into(),
                    "--no-ext-diff".into(),
                    "--no-textconv".into(),
                    "-M".into(),
                    "--numstat".into(),
                    "-z".into(),
                    parent.into(),
                    oid.into(),
                    "--".into(),
                ],
            )
        };
        let (names, stats) = tokio::try_join!(
            self.read(Some(path), name_args),
            self.read(Some(path), stat_args)
        )?;
        parse_changed_files(&names.stdout, &stats.stdout)
    }

    async fn stash_graph(&self, path: &Path) -> ApiResult<StashGraph> {
        let mut args = os_args(&["stash", "list"]);
        args.push(format!("--format={STASH_GRAPH_FORMAT}").into());
        let output = self.read_allow_failure(Some(path), args).await?;
        if !output.success() {
            return Ok(StashGraph::default());
        }
        parse_stash_graph(&output.stdout)
    }

    async fn history_revision(&self, path: &Path, scope: &HistoryScope) -> ApiResult<OsString> {
        match scope {
            HistoryScope::CurrentBranch => Ok("HEAD".into()),
            HistoryScope::AllRefs => Ok("--all".into()),
            HistoryScope::Ref(reference) => Ok(self.resolve_commit(path, reference).await?.into()),
        }
    }
}

#[async_trait]
impl GitBackend for GitCliBackend {
    async fn probe(&self) -> ApiResult<GitVersion> {
        let output = self.read(None, os_args(&["version"])).await?;
        let (major, minor, patch, raw) = parse_git_version(&output.stdout)?;
        if major < 2 || (major == 2 && minor < 31) {
            return Err(ApiError::new(
                ErrorCode::UnsupportedGitVersion,
                "Git 2.31 or newer is required",
            )
            .with_details(raw));
        }
        Ok(GitVersion {
            major,
            minor,
            patch,
            raw,
        })
    }

    async fn open_repository(&self, path: &Path) -> ApiResult<RepositoryInfo> {
        self.inspect_repository(path).await
    }

    async fn init_repository(
        &self,
        path: &Path,
        default_branch: &str,
    ) -> ApiResult<RepositoryInfo> {
        self.validate_branch_name(default_branch).await?;
        let args = vec![
            "init".into(),
            format!("--initial-branch={default_branch}").into(),
            "--".into(),
            path.as_os_str().to_owned(),
        ];
        self.runner
            .run(
                None,
                &args,
                None,
                CancellationToken::new(),
                GitRunOptions::mutation(READ_OUTPUT_CAP),
            )
            .await?;
        self.inspect_repository(path).await
    }

    async fn clone_repository(
        &self,
        options: &CloneOptions,
        cancellation: CancellationToken,
    ) -> ApiResult<RepositoryInfo> {
        validate_remote_url(&options.url)?;
        let destination = PathBuf::from(&options.destination);
        if destination.as_os_str().is_empty() {
            return Err(ApiError::new(
                ErrorCode::InvalidPath,
                "Clone destination is empty",
            ));
        }
        let mut args = os_args(&["clone", "--progress"]);
        if let Some(branch) = &options.branch {
            self.validate_branch_name(branch).await?;
            args.push("--branch".into());
            args.push(branch.into());
        }
        if let Some(depth) = options.depth {
            if depth == 0 {
                return Err(ApiError::new(
                    ErrorCode::InvalidSettings,
                    "Clone depth must be greater than zero",
                ));
            }
            args.push(format!("--depth={depth}").into());
        }
        if options.filter_blob_none {
            args.push("--filter=blob:none".into());
        }
        args.push("--".into());
        args.push(options.url.as_str().into());
        args.push(destination.as_os_str().to_owned());
        self.runner
            .run(
                None,
                &args,
                None,
                cancellation,
                GitRunOptions::network(NETWORK_OUTPUT_CAP),
            )
            .await?;
        self.inspect_repository(&destination).await
    }

    async fn snapshot(&self, path: &Path) -> ApiResult<RepositorySnapshot> {
        let (generation, refs_output, mut parsed_status) = self.generation_and_refs(path).await?;
        self.apply_line_stats(path, &mut parsed_status.status)
            .await?;
        let refs = parse_refs(&refs_output)?;
        let mut local_branches = Vec::new();
        let mut remote_branches = Vec::new();
        let mut symbolic_remote_targets = Vec::new();
        let mut tags = Vec::new();
        for parsed_ref in refs {
            match parsed_ref.label.kind {
                RefKind::LocalBranch => {
                    if let Some(branch) = parsed_ref.branch {
                        local_branches.push(branch);
                    }
                }
                RefKind::RemoteBranch if parsed_ref.symbolic_target.is_none() => {
                    if let Some(branch) = parsed_ref.branch {
                        remote_branches.push(branch);
                    }
                }
                RefKind::Tag => tags.push(parsed_ref.label),
                RefKind::RemoteBranch => {
                    if let Some(target) = parsed_ref.symbolic_target {
                        symbolic_remote_targets.push((parsed_ref.label.full_name, target));
                    }
                }
            }
        }
        local_branches.sort_by(|left, right| left.name.cmp(&right.name));
        remote_branches.sort_by(|left, right| left.name.cmp(&right.name));
        tags.sort_by(|left, right| left.name.cmp(&right.name));
        symbolic_remote_targets.sort_by(|left, right| left.0.cmp(&right.0));
        let remote_exists = |name: &str| remote_branches.iter().any(|branch| branch.name == name);
        let default_conflict_target = local_branches
            .iter()
            .find(|branch| branch.is_head)
            .and_then(|branch| branch.upstream.clone())
            .filter(|upstream| remote_exists(upstream))
            .or_else(|| {
                let resolve_target = |target: &str| {
                    target
                        .strip_prefix("refs/remotes/")
                        .filter(|target| remote_exists(target))
                        .map(str::to_owned)
                };
                let origin_default = symbolic_remote_targets
                    .iter()
                    .find(|(symbolic, _)| symbolic == "refs/remotes/origin/HEAD")
                    .and_then(|(_, target)| resolve_target(target));
                origin_default.or_else(|| {
                    symbolic_remote_targets
                        .iter()
                        .find_map(|(_, target)| resolve_target(target))
                })
            });

        let info = self.inspect_repository(path).await?;
        let shallow = self
            .read_allow_failure(
                Some(path),
                os_args(&["rev-parse", "--is-shallow-repository"]),
            )
            .await?
            .stdout_lossy()
            .trim()
            == "true";
        let partial_clone = self
            .read_allow_failure(
                Some(path),
                os_args(&["config", "--get-regexp", r"^remote\..*\.promisor$"]),
            )
            .await?
            .success();
        let sparse_checkout = self
            .read_allow_failure(
                Some(path),
                os_args(&["config", "--bool", "core.sparseCheckout"]),
            )
            .await?
            .stdout_lossy()
            .trim()
            == "true";
        let operation_state = self.operation_state(path).await?;
        let remotes = self.remotes(path).await?;
        Ok(RepositorySnapshot {
            generation,
            head: parsed_status.head,
            operation_state,
            status: parsed_status.status,
            local_branches,
            remote_branches,
            default_conflict_target,
            tags,
            remotes,
            capabilities: RepositoryCapabilities {
                shallow,
                partial_clone,
                sparse_checkout,
                worktree: info.git_dir != info.common_dir,
            },
        })
    }

    async fn history(&self, path: &Path, query: &HistoryQuery) -> ApiResult<HistoryPage> {
        let (generation, refs_output) = self.history_generation_and_refs(path).await?;
        if let Some(cursor) = &query.cursor {
            if cursor.generation != generation {
                return Err(ApiError::new(
                    ErrorCode::StaleSnapshot,
                    "Repository changed while commit history was paged",
                ));
            }
        }
        if matches!(query.scope, HistoryScope::CurrentBranch)
            && self.head_oid(path).await?.is_none()
        {
            return Ok(HistoryPage {
                generation,
                commits: Vec::new(),
                next_cursor: None,
                has_more: false,
            });
        }
        let limit = query.limit.clamp(1, MAX_HISTORY_PAGE);
        let offset = query.cursor.as_ref().map_or(0, |cursor| cursor.offset);
        if offset > 10_000_000 {
            return Err(ApiError::new(
                ErrorCode::InvalidSettings,
                "History cursor offset is outside the supported range",
            ));
        }
        let stashes = self.stash_graph(path).await?;
        let mut args = os_args(&[
            "log",
            "--topo-order",
            "--date-order",
            "--no-show-signature",
            "--encoding=UTF-8",
        ]);
        args.push(format!("--format={LOG_FORMAT}").into());
        args.push(format!("--skip={offset}").into());
        args.push(format!("--max-count={}", limit + 1).into());
        args.push(self.history_revision(path, &query.scope).await?);
        if matches!(query.scope, HistoryScope::AllRefs) {
            let mut stash_tips: Vec<&String> = stashes.commits.keys().collect();
            stash_tips.sort_unstable();
            args.extend(stash_tips.into_iter().map(OsString::from));
        }
        args.push("--".into());
        let output = self.read(Some(path), args).await?;
        let (generation_after, _) = self.history_generation_and_refs(path).await?;
        if generation_after != generation {
            return Err(ApiError::new(
                ErrorCode::StaleSnapshot,
                "Repository changed while commit history was read",
            ));
        }
        let mut commits = parse_log(&output.stdout)?;
        let has_more = commits.len() > limit;
        commits.truncate(limit);
        let walked = commits.len();
        apply_stash_view(&mut commits, &stashes);

        let mut labels: HashMap<String, Vec<RefLabel>> = HashMap::new();
        for parsed_ref in parse_refs(&refs_output)? {
            if matches!(parsed_ref.label.kind, RefKind::RemoteBranch) && parsed_ref.symbolic_target.is_some() {
                continue;
            }
            labels
                .entry(parsed_ref.oid)
                .or_default()
                .push(parsed_ref.label);
        }
        for commit in &mut commits {
            commit.decorations = labels.remove(&commit.oid).unwrap_or_default();
        }
        let mut lanes = query
            .cursor
            .as_ref()
            .map(|cursor| cursor.lanes.clone())
            .unwrap_or(LaneState { heads: Vec::new() });
        let head_oid = self.head_oid(path).await?;
        layout_commits(&mut commits, &mut lanes, head_oid.as_deref());
        let next_cursor = has_more.then(|| HistoryCursor {
            generation: generation.clone(),
            offset: offset + walked,
            lanes,
        });
        Ok(HistoryPage {
            generation,
            commits,
            next_cursor,
            has_more,
        })
    }

    async fn search_commits(
        &self,
        path: &Path,
        query: &CommitSearchQuery,
    ) -> ApiResult<CommitSearchResult> {
        let needle = query.query.trim();
        if needle.is_empty() {
            return Ok(CommitSearchResult {
                total: 0,
                truncated: false,
                hits: Vec::new(),
            });
        }
        if needle.chars().count() > 256 || needle.contains('\0') {
            return Err(ApiError::new(
                ErrorCode::InvalidSettings,
                "Commit search query must contain at most 256 characters",
            ));
        }
        if matches!(query.scope, HistoryScope::CurrentBranch)
            && self.head_oid(path).await?.is_none()
        {
            return Ok(CommitSearchResult {
                total: 0,
                truncated: false,
                hits: Vec::new(),
            });
        }
        let limit = query.limit.clamp(1, MAX_SEARCH_RESULTS);
        let revision = self.history_revision(path, &query.scope).await?;
        let grep = format!("--grep={needle}");
        let mut count_args = os_args(&[
            "rev-list",
            "--count",
            "--fixed-strings",
            "--regexp-ignore-case",
        ]);
        count_args.push(grep.clone().into());
        count_args.push(revision.clone());
        count_args.push("--".into());
        let count_output = self.read(Some(path), count_args).await?;
        let total = count_output
            .stdout_lossy()
            .trim()
            .parse::<usize>()
            .map_err(|_| {
                ApiError::new(
                    ErrorCode::GitCommandFailed,
                    "Git returned an invalid search count",
                )
            })?;

        let mut log_args = os_args(&[
            "log",
            "--topo-order",
            "--date-order",
            "--fixed-strings",
            "--regexp-ignore-case",
            "--encoding=UTF-8",
        ]);
        log_args.push(grep.into());
        log_args.push(format!("--format={LOG_FORMAT}").into());
        log_args.push(format!("--max-count={limit}").into());
        log_args.push(revision);
        log_args.push("--".into());
        let output = self.read(Some(path), log_args).await?;
        let hits = parse_search_hits(&output.stdout, needle)?;
        Ok(CommitSearchResult {
            total,
            truncated: total > hits.len(),
            hits,
        })
    }

    async fn commit_details(
        &self,
        path: &Path,
        oid: &str,
        parent_index: usize,
    ) -> ApiResult<CommitDetails> {
        let oid = self.resolve_commit(path, oid).await?;
        let mut args = os_args(&["show", "-s", "--no-show-signature", "--encoding=UTF-8"]);
        args.push(format!("--format={DETAIL_FORMAT}").into());
        args.push(oid.as_str().into());
        args.push("--".into());
        let output = self.read(Some(path), args).await?;
        let mut details = parse_commit_details(&output.stdout)?.details;
        if details.parent_oids.len() > 1 {
            if let Some(stash) = self.stash_graph(path).await?.commits.get(&oid) {
                details.subject = stash.label.clone();
            }
        }
        let files = self
            .changed_files_for_commit(path, &oid, &details.parent_oids, parent_index)
            .await?;
        details.stats = DiffStats {
            files: files.len().try_into().unwrap_or(u32::MAX),
            additions: files.iter().filter_map(|file| file.additions).sum(),
            deletions: files.iter().filter_map(|file| file.deletions).sum(),
        };
        details.files = files;
        Ok(details)
    }

    async fn diff(&self, path: &Path, request: &DiffRequest) -> ApiResult<FileDiff> {
        validate_relative_path(&request.path)?;
        if matches!(
            request.target,
            DiffTarget::Worktree | DiffTarget::HeadToWorktree
        ) && self.is_untracked_file(path, &request.path).await?
        {
            return self.untracked_diff(path, request).await;
        }
        let mut args = match &request.target {
            DiffTarget::Worktree => os_args(&["diff"]),
            DiffTarget::Staged => os_args(&["diff", "--cached"]),
            DiffTarget::HeadToWorktree => {
                if let Some(head) = self.head_oid(path).await? {
                    vec!["diff".into(), head.into()]
                } else {
                    os_args(&["diff", "--cached"])
                }
            }
            DiffTarget::Commit { oid, parent_index } => {
                let oid = self.resolve_commit(path, oid).await?;
                let details = self.commit_details(path, &oid, *parent_index).await?;
                if details.parent_oids.is_empty() {
                    vec![
                        "show".into(),
                        "--format=".into(),
                        "--root".into(),
                        oid.into(),
                    ]
                } else {
                    vec![
                        "diff".into(),
                        details.parent_oids[*parent_index].clone().into(),
                        oid.into(),
                    ]
                }
            }
            DiffTarget::Between { base_oid, head_oid } => vec![
                "diff".into(),
                self.resolve_commit(path, base_oid).await?.into(),
                self.resolve_commit(path, head_oid).await?.into(),
            ],
        };
        let mut name_args = args.clone();
        name_args.extend(os_args(&[
            "--name-only",
            "-z",
            "--no-ext-diff",
            "--no-textconv",
            "--",
        ]));
        name_args.push(request.path.as_str().into());
        let names = self.read(Some(path), name_args).await?;
        let resolved_paths: Vec<_> = names
            .stdout
            .split(|byte| *byte == 0)
            .filter(|value| !value.is_empty())
            .map(|value| String::from_utf8_lossy(value).into_owned())
            .collect();
        if resolved_paths.len() > 1
            || resolved_paths
                .first()
                .is_some_and(|resolved| resolved != &request.path)
        {
            return Err(ApiError::new(
                ErrorCode::InvalidRequest,
                "Diff request must select exactly one changed file",
            ));
        }
        args.extend(os_args(&[
            "--patch",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
        ]));
        args.push(format!("--unified={}", request.context_lines.min(100)).into());
        if request.ignore_whitespace {
            args.push("--ignore-all-space".into());
        }
        args.push("--".into());
        args.push(request.path.as_str().into());
        let mut options = GitRunOptions::read_only(request.max_bytes.clamp(1, MAX_DIFF_BYTES));
        options.allow_stdout_truncation = true;
        options.timeout = Some(Duration::from_secs(60));
        let output = self
            .runner
            .run(Some(path), &args, None, CancellationToken::new(), options)
            .await?;
        parse_file_diff(&output.stdout, &request.path, output.stdout_truncated)
    }

    async fn conflict_preflight(
        &self,
        path: &Path,
        target: &str,
    ) -> ApiResult<ConflictPreflightResult> {
        // Resolve caller input before feature detection or merge simulation. The
        // merge-tree command receives only full object IDs, never an option-like ref.
        let target_oid = self.resolve_commit(path, target).await?;
        let version = self.probe().await?;
        if !supports_merge_tree_preflight(&version) {
            return Ok(ConflictPreflightResult {
                target: target.to_owned(),
                target_oid,
                state: ConflictPreflightState::Unavailable,
                conflicting_paths: Vec::new(),
                unavailable_reason: Some(
                    "Conflict preflight requires Git 2.38 or newer".to_owned(),
                ),
            });
        }

        let head_oid = self.resolve_commit(path, "HEAD").await?;
        let output = self
            .read_allow_failure(
                Some(path),
                vec![
                    "merge-tree".into(),
                    "--write-tree".into(),
                    "--name-only".into(),
                    "-z".into(),
                    "--no-messages".into(),
                    head_oid.into(),
                    target_oid.as_str().into(),
                ],
            )
            .await?;

        let exit_code = output.status.code();
        if !matches!(exit_code, Some(0 | 1)) {
            if merge_tree_preflight_unavailable(&output) {
                return Ok(ConflictPreflightResult {
                    target: target.to_owned(),
                    target_oid,
                    state: ConflictPreflightState::Unavailable,
                    conflicting_paths: Vec::new(),
                    unavailable_reason: Some(
                        "This Git build does not support conflict preflight".to_owned(),
                    ),
                });
            }
            return Err(self.runner.failure_error(&output));
        }

        let conflicting_paths = parse_merge_tree_paths(&output.stdout)?;
        let state = match exit_code {
            Some(0) if conflicting_paths.is_empty() => ConflictPreflightState::Clean,
            Some(1) if !conflicting_paths.is_empty() => ConflictPreflightState::Conflicting,
            _ => {
                return Err(ApiError::new(
                    ErrorCode::GitCommandFailed,
                    "Git conflict preflight returned an inconsistent result",
                ));
            }
        };

        Ok(ConflictPreflightResult {
            target: target.to_owned(),
            target_oid,
            state,
            conflicting_paths,
            unavailable_reason: None,
        })
    }

    async fn conflict_details(
        &self,
        path: &Path,
        conflict_path: &str,
    ) -> ApiResult<ConflictFileDetails> {
        self.ensure_conflicted_path(path, conflict_path).await?;
        let entries = self.unmerged_index_entries(path, conflict_path).await?;
        let base = match entry_at_stage(&entries, 1) {
            Some(entry) => Some(self.conflict_index_version(path, entry).await?),
            None => None,
        };
        let ours = match entry_at_stage(&entries, 2) {
            Some(entry) => Some(self.conflict_index_version(path, entry).await?),
            None => None,
        };
        let theirs = match entry_at_stage(&entries, 3) {
            Some(entry) => Some(self.conflict_index_version(path, entry).await?),
            None => None,
        };
        let worktree = self
            .inspect_conflict_result_async(path, conflict_path)
            .await?;

        Ok(ConflictFileDetails {
            path: conflict_path.to_owned(),
            expected_state: conflict_expected_state(&entries, worktree.identity),
            base,
            ours,
            theirs,
            result: worktree.content,
        })
    }

    async fn stage_paths(&self, path: &Path, paths: &[String]) -> ApiResult<MutationResult> {
        if paths.is_empty() {
            return self.mutation_result(path, self.head_oid(path).await?).await;
        }
        validate_paths(paths)?;
        let mut args = os_args(&["add", "--"]);
        args.extend(paths.iter().map(OsString::from));
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn unstage_paths(&self, path: &Path, paths: &[String]) -> ApiResult<MutationResult> {
        if paths.is_empty() {
            return self.mutation_result(path, self.head_oid(path).await?).await;
        }
        validate_paths(paths)?;
        let mut args = if self.head_oid(path).await?.is_some() {
            os_args(&["restore", "--staged", "--"])
        } else {
            os_args(&["rm", "--cached", "--force", "--ignore-unmatch", "--"])
        };
        args.extend(paths.iter().map(OsString::from));
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn discard_paths(&self, path: &Path, paths: &[String]) -> ApiResult<MutationResult> {
        if paths.is_empty() {
            return self.mutation_result(path, self.head_oid(path).await?).await;
        }
        validate_paths(paths)?;
        let before = self.head_oid(path).await?;

        let mut ls_args = os_args(&["ls-files", "-z", "--"]);
        ls_args.extend(paths.iter().map(OsString::from));
        let listed = self.read(Some(path), ls_args).await?;
        let listed_text = listed.stdout_lossy();
        let tracked: std::collections::HashSet<&str> = listed_text
            .split('\0')
            .filter(|entry| !entry.is_empty())
            .collect();
        let tracked_paths: Vec<&String> = paths.iter().filter(|p| tracked.contains(p.as_str())).collect();
        let untracked_paths: Vec<&String> = paths.iter().filter(|p| !tracked.contains(p.as_str())).collect();

        if !tracked_paths.is_empty() {
            let mut args = if self.head_oid(path).await?.is_some() {
                os_args(&["restore", "--staged", "--worktree", "--source=HEAD", "--"])
            } else {
                os_args(&["rm", "--cached", "--force", "--ignore-unmatch", "--"])
            };
            args.extend(tracked_paths.iter().map(|p| OsString::from(p.as_str())));
            let output = self
                .runner
                .run(Some(path), &args, None, CancellationToken::new(), {
                    let mut options = GitRunOptions::mutation(READ_OUTPUT_CAP);
                    options.allow_failure = true;
                    options
                })
                .await?;
            if !output.success() {
                return Err(self.runner.failure_error(&output));
            }
        }

        if !untracked_paths.is_empty() {
            let mut args = os_args(&["clean", "--force", "-d", "--"]);
            args.extend(untracked_paths.iter().map(|p| OsString::from(p.as_str())));
            let output = self
                .runner
                .run(Some(path), &args, None, CancellationToken::new(), {
                    let mut options = GitRunOptions::mutation(READ_OUTPUT_CAP);
                    options.allow_failure = true;
                    options
                })
                .await?;
            if !output.success() {
                return Err(self.runner.failure_error(&output));
            }
        }

        self.mutation_result(path, before).await
    }

    async fn stash_paths(
        &self,
        path: &Path,
        paths: &[String],
        message: Option<&str>,
    ) -> ApiResult<MutationResult> {
        validate_paths(paths)?;
        if paths.is_empty() {
            return self.mutation_result(path, self.head_oid(path).await?).await;
        }
        let mut args = os_args(&["stash", "push", "--include-untracked"]);
        if let Some(message) = message {
            if message.len() > MAX_COMMIT_MESSAGE_BYTES || message.contains('\0') {
                return Err(ApiError::new(
                    ErrorCode::InvalidSettings,
                    "Stash message is too large",
                ));
            }
            args.push("--message".into());
            args.push(message.into());
        }
        args.push("--".into());
        args.extend(paths.iter().map(OsString::from));
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn append_gitignore(
        &self,
        path: &Path,
        patterns: &[String],
    ) -> ApiResult<MutationResult> {
        let before = self.head_oid(path).await?;
        let cleaned: Vec<String> = patterns
            .iter()
            .map(|pattern| pattern.trim().to_owned())
            .filter(|pattern| !pattern.is_empty())
            .collect();
        for pattern in &cleaned {
            if pattern.contains('\0') || pattern.contains('\n') {
                return Err(ApiError::new(
                    ErrorCode::InvalidRequest,
                    "Ignore pattern contains an invalid character",
                ));
            }
        }
        if cleaned.is_empty() {
            return self.mutation_result(path, before).await;
        }

        let gitignore = path.join(".gitignore");
        let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
        let present: std::collections::HashSet<&str> =
            existing.lines().map(|line| line.trim()).collect();
        let additions: Vec<&String> = cleaned
            .iter()
            .filter(|pattern| !present.contains(pattern.as_str()))
            .collect();
        if additions.is_empty() {
            return self.mutation_result(path, before).await;
        }

        let mut next = existing;
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        for pattern in additions {
            next.push_str(pattern);
            next.push('\n');
        }
        std::fs::write(&gitignore, next).map_err(|error| {
            ApiError::new(ErrorCode::Internal, "Could not update .gitignore")
                .with_details(error.to_string())
        })?;
        self.mutation_result(path, before).await
    }

    async fn create_patch(
        &self,
        path: &Path,
        paths: &[String],
        staged: bool,
    ) -> ApiResult<String> {
        validate_paths(paths)?;
        let mut args = if staged {
            os_args(&["diff", "--cached", "--"])
        } else {
            os_args(&["diff", "--"])
        };
        args.extend(paths.iter().map(OsString::from));
        let output = self.read(Some(path), args).await?;
        Ok(output.stdout_lossy())
    }

    async fn resolve_conflict(
        &self,
        path: &Path,
        conflict_path: &str,
        resolution: ConflictResolution,
        expected_state: &ConflictExpectedState,
    ) -> ApiResult<MutationResult> {
        let entries = self
            .ensure_expected_conflict(path, conflict_path, expected_state)
            .await?;

        let checkout_side = match resolution {
            ConflictResolution::Ours => Some(("--ours", 2, "ours")),
            ConflictResolution::Theirs => Some(("--theirs", 3, "theirs")),
            ConflictResolution::MarkResolved | ConflictResolution::Delete => None,
        };

        if let Some((checkout_flag, stage, side_name)) = checkout_side {
            if entry_at_stage(&entries, stage).is_none() {
                return Err(ApiError::new(
                    ErrorCode::UnsupportedOperation,
                    format!("The {side_name} side has no file content for this conflict"),
                )
                .with_details(format!(
                    "{conflict_path}: the selected index stage is absent; use the explicit delete resolution if deletion is intended."
                )));
            }

            let mut args = os_args(&["--literal-pathspecs", "checkout", checkout_flag, "--"]);
            args.push(conflict_path.into());
            self.mutate(path, args, None, CancellationToken::new(), false)
                .await?;
        }

        if resolution == ConflictResolution::Delete {
            let mut args = os_args(&[
                "--literal-pathspecs",
                "rm",
                "--force",
                "--ignore-unmatch",
                "--",
            ]);
            args.push(conflict_path.into());
            return self
                .mutate(path, args, None, CancellationToken::new(), false)
                .await;
        }

        self.stage_conflict_path(path, conflict_path).await
    }

    async fn save_conflict_result(
        &self,
        path: &Path,
        conflict_path: &str,
        text: &str,
        line_ending: ConflictLineEndingPolicy,
        expected_state: &ConflictExpectedState,
    ) -> ApiResult<MutationResult> {
        let entries = self
            .ensure_expected_conflict(path, conflict_path, expected_state)
            .await?;
        let desired_mode = [2, 3, 1]
            .into_iter()
            .filter_map(|stage| entry_at_stage(&entries, stage))
            .find(|entry| matches!(entry.mode.as_str(), "100644" | "100755"))
            .map(|entry| entry.mode.as_str())
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::UnsupportedOperation,
                    "Edited text cannot resolve a non-regular-file conflict",
                )
            })?;
        if !matches!(
            expected_state.result.kind,
            ConflictWorktreeKind::Regular | ConflictWorktreeKind::Missing
        ) {
            return Err(ApiError::new(
                ErrorCode::UnsupportedOperation,
                "Edited text cannot resolve a non-regular-file conflict",
            ));
        }
        self.write_conflict_result_async(
            path,
            conflict_path,
            text,
            line_ending,
            &expected_state.result,
            desired_mode,
        )
        .await?;
        self.stage_conflict_path(path, conflict_path).await
    }

    async fn auto_resolve_conflicts(&self, path: &Path) -> ApiResult<MutationResult> {
        // `rerere` only reuses a repository-local resolution recorded for the
        // exact conflict preimage. It never chooses current or incoming content.
        self.mutate(
            path,
            os_args(&[
                "-c",
                "rerere.enabled=true",
                "-c",
                "rerere.autoupdate=true",
                "rerere",
                "--rerere-autoupdate",
            ]),
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    async fn create_commit(
        &self,
        path: &Path,
        options: &CommitOptions,
    ) -> ApiResult<MutationResult> {
        validate_message(&options.message)?;
        let mut args = os_args(&["commit", "-F", "-"]);
        if options.amend {
            args.push("--amend".into());
        }
        if options.signoff {
            args.push("--signoff".into());
        }
        self.mutate(
            path,
            args,
            Some(options.message.as_bytes()),
            CancellationToken::new(),
            false,
        )
        .await
    }

    async fn reword_commit(
        &self,
        path: &Path,
        oid: &str,
        message: &str,
    ) -> ApiResult<MutationResult> {
        validate_message(message)?;
        let target = self.resolve_commit(path, oid).await?;

        // Rewriting is only defined while no merge/rebase/cherry-pick is in flight.
        if self.operation_state(path).await? != RepositoryOperationState::Normal {
            return Err(ApiError::new(
                ErrorCode::OperationInProgress,
                "Finish the in-progress Git operation before editing a commit message",
            ));
        }

        let head = self.head_oid(path).await?.ok_or_else(|| {
            ApiError::new(
                ErrorCode::InvalidRequest,
                "The repository has no commit to edit",
            )
        })?;

        // Amending HEAD needs no replay and never touches the working tree.
        if target == head {
            return self
                .mutate(
                    path,
                    os_args(&["commit", "--amend", "--only", "-F", "-"]),
                    Some(message.as_bytes()),
                    CancellationToken::new(),
                    false,
                )
                .await;
        }

        // Older commits are reworded by rebuilding the commit object and
        // replaying its descendants onto it. The tree is byte-identical, so the
        // replay never conflicts; these guards keep it from silently losing
        // history it cannot faithfully reproduce.
        if !self.is_ancestor(path, &target, &head).await? {
            return Err(ApiError::new(
                ErrorCode::UnsupportedOperation,
                "Only commits reachable from the current branch can be edited",
            ));
        }
        if self.range_has_merge(path, &target, &head).await? {
            return Err(ApiError::new(
                ErrorCode::UnsupportedOperation,
                "Cannot edit this message because a later commit is a merge",
            ));
        }

        let rebuilt = self.rebuild_commit_message(path, &target, message).await?;
        let mut args = os_args(&["rebase", "--autostash", "--onto"]);
        args.push(rebuilt.into());
        args.push(target.into());
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn create_branch(
        &self,
        path: &Path,
        name: &str,
        start_oid: &str,
        checkout: bool,
    ) -> ApiResult<MutationResult> {
        self.validate_branch_name(name).await?;
        let oid = self.resolve_commit(path, start_oid).await?;
        let args = if checkout {
            vec!["switch".into(), "-c".into(), name.into(), oid.into()]
        } else {
            vec!["branch".into(), "--".into(), name.into(), oid.into()]
        };
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn checkout_branch(&self, path: &Path, name: &str) -> ApiResult<MutationResult> {
        self.validate_branch_name(name).await?;
        self.mutate(
            path,
            vec!["switch".into(), name.into()],
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    async fn rename_branch(
        &self,
        path: &Path,
        old_name: &str,
        new_name: &str,
    ) -> ApiResult<MutationResult> {
        self.validate_branch_name(old_name).await?;
        self.validate_branch_name(new_name).await?;
        self.mutate(
            path,
            vec![
                "branch".into(),
                "-m".into(),
                old_name.into(),
                new_name.into(),
            ],
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    async fn delete_branch(
        &self,
        path: &Path,
        name: &str,
        force: bool,
        confirmed: bool,
    ) -> ApiResult<MutationResult> {
        self.validate_branch_name(name).await?;
        if force && !confirmed {
            return Err(confirmation_required(
                "Force-deleting a branch requires confirmation",
            ));
        }
        let mode = if force { "-D" } else { "-d" };
        self.mutate(
            path,
            vec!["branch".into(), mode.into(), "--".into(), name.into()],
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    async fn set_upstream(
        &self,
        path: &Path,
        branch: &str,
        upstream: &str,
    ) -> ApiResult<MutationResult> {
        self.validate_branch_name(branch).await?;
        self.validate_branch_name(upstream).await?;
        let upstream_ref = format!("refs/remotes/{upstream}");
        let verify = self
            .read_allow_failure(
                Some(path),
                vec![
                    "show-ref".into(),
                    "--verify".into(),
                    "--quiet".into(),
                    upstream_ref.into(),
                ],
            )
            .await?;
        if !verify.success() {
            return Err(ApiError::new(
                ErrorCode::InvalidRefName,
                "Selected upstream branch does not exist",
            ));
        }
        self.mutate(
            path,
            vec![
                "branch".into(),
                format!("--set-upstream-to={upstream}").into(),
                "--".into(),
                branch.into(),
            ],
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    async fn merge_branch(&self, path: &Path, branch: &str) -> ApiResult<MutationResult> {
        self.validate_branch_name(branch).await?;
        let oid = self.resolve_commit(path, branch).await?;
        self.mutate(
            path,
            vec!["merge".into(), "--no-edit".into(), oid.into()],
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    async fn fetch(
        &self,
        path: &Path,
        options: &FetchOptions,
        cancellation: CancellationToken,
    ) -> ApiResult<MutationResult> {
        self.validate_remote_selection(path, options.remote.as_deref())
            .await?;
        let mut args = os_args(&["fetch", "--progress"]);
        if options.prune {
            args.push("--prune".into());
        }
        if options.tags {
            args.push("--tags".into());
        }
        if let Some(remote) = &options.remote {
            args.push("--".into());
            args.push(remote.into());
        } else {
            args.push("--all".into());
        }
        self.mutate(path, args, None, cancellation, true).await
    }

    async fn pull(
        &self,
        path: &Path,
        options: &PullOptions,
        cancellation: CancellationToken,
    ) -> ApiResult<MutationResult> {
        self.validate_remote_selection(path, options.remote.as_deref())
            .await?;
        if options.branch.is_some() && options.remote.is_none() {
            return Err(ApiError::new(
                ErrorCode::InvalidSettings,
                "Pull branch requires an explicit remote",
            ));
        }
        let mut args = os_args(&["pull", "--progress"]);
        match options.mode {
            PullMode::Merge => {
                args.push("--no-rebase".into());
                args.push("--ff".into());
            }
            PullMode::FastForwardOnly => {
                args.push("--ff-only".into());
                args.push("--no-rebase".into());
            }
            PullMode::Rebase => args.push("--rebase".into()),
        }
        if options.prune {
            args.push("--prune".into());
        }
        if options.autostash {
            args.push("--autostash".into());
        }
        if let Some(remote) = &options.remote {
            args.push("--".into());
            args.push(remote.into());
            if let Some(branch) = &options.branch {
                self.validate_branch_name(branch).await?;
                args.push(branch.into());
            }
        }
        self.mutate(path, args, None, cancellation, true).await
    }

    async fn push(
        &self,
        path: &Path,
        options: &PushOptions,
        cancellation: CancellationToken,
    ) -> ApiResult<MutationResult> {
        if options.branch.is_some() && options.remote.is_none() {
            return Err(ApiError::new(
                ErrorCode::InvalidRequest,
                "Pushing an explicit branch requires an explicit remote",
            ));
        }
        self.validate_remote_selection(path, options.remote.as_deref())
            .await?;
        if options.set_upstream && (options.remote.is_none() || options.branch.is_none()) {
            return Err(ApiError::new(
                ErrorCode::InvalidSettings,
                "Setting upstream requires an explicit remote and branch",
            ));
        }
        let mut args = os_args(&["push", "--porcelain", "--progress"]);
        if options.set_upstream {
            args.push("--set-upstream".into());
        }
        if let Some(remote) = &options.remote {
            args.push("--".into());
            args.push(remote.into());
            if let Some(branch) = &options.branch {
                self.validate_branch_name(branch).await?;
                args.push(branch.into());
            }
        }
        self.mutate(path, args, None, cancellation, true).await
    }

    async fn checkout_commit(&self, path: &Path, oid: &str) -> ApiResult<MutationResult> {
        let oid = self.resolve_commit(path, oid).await?;
        self.mutate(
            path,
            vec!["switch".into(), "--detach".into(), oid.into()],
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    async fn create_tag(
        &self,
        path: &Path,
        name: &str,
        oid: &str,
        message: Option<&str>,
    ) -> ApiResult<MutationResult> {
        self.validate_tag_name(name).await?;
        let oid = self.resolve_commit(path, oid).await?;
        let (args, stdin) = if let Some(message) = message {
            validate_message(message)?;
            (
                vec![
                    "tag".into(),
                    "-a".into(),
                    "-F".into(),
                    "-".into(),
                    name.into(),
                    oid.into(),
                ],
                Some(message.as_bytes()),
            )
        } else {
            (
                vec!["tag".into(), "--".into(), name.into(), oid.into()],
                None,
            )
        };
        self.mutate(path, args, stdin, CancellationToken::new(), false)
            .await
    }

    async fn cherry_pick(
        &self,
        path: &Path,
        oid: &str,
        mainline_parent: Option<u32>,
    ) -> ApiResult<MutationResult> {
        let oid = self.resolve_commit(path, oid).await?;
        let parents = self.commit_parent_oids(path, &oid).await?;
        validate_mainline_parent(parents.len(), mainline_parent)?;
        let mut args = os_args(&["cherry-pick"]);
        if let Some(parent) = mainline_parent {
            args.extend(["-m".into(), parent.to_string().into()]);
        }
        args.push(oid.into());
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn revert_commit(
        &self,
        path: &Path,
        oid: &str,
        mainline_parent: Option<u32>,
    ) -> ApiResult<MutationResult> {
        let oid = self.resolve_commit(path, oid).await?;
        let parents = self.commit_parent_oids(path, &oid).await?;
        validate_mainline_parent(parents.len(), mainline_parent)?;
        let mut args = os_args(&["revert", "--no-edit"]);
        if let Some(parent) = mainline_parent {
            args.extend(["-m".into(), parent.to_string().into()]);
        }
        args.push(oid.into());
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn reset_to_commit(
        &self,
        path: &Path,
        oid: &str,
        mode: ResetMode,
        confirmed: bool,
    ) -> ApiResult<MutationResult> {
        if mode == ResetMode::Hard && !confirmed {
            return Err(confirmation_required("Hard reset requires confirmation"));
        }
        let snapshot = self.snapshot(path).await?;
        if snapshot.operation_state != RepositoryOperationState::Normal {
            return Err(ApiError::new(
                ErrorCode::OperationInProgress,
                "Finish or abort the current Git operation before resetting",
            ));
        }
        if !matches!(snapshot.head, HeadState::Branch { .. }) {
            return Err(ApiError::new(
                ErrorCode::UnsupportedOperation,
                "Reset is only available while a local branch is checked out",
            ));
        }
        let oid = self.resolve_commit(path, oid).await?;
        let flag = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        };
        self.mutate(
            path,
            vec!["reset".into(), flag.into(), oid.into()],
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    async fn commit_action_availability(
        &self,
        path: &Path,
        oid: &str,
    ) -> ApiResult<Vec<CommitActionAvailability>> {
        let oid = self.resolve_commit(path, oid).await?;
        let (status_output, operation_state) =
            tokio::try_join!(self.status_output(path), self.operation_state(path))?;
        let parsed_status = parse_status(&status_output.stdout)?;
        let operation_busy = operation_state != RepositoryOperationState::Normal;
        let dirty = !parsed_status.status.clean;
        let reset_unavailable = !matches!(parsed_status.head, HeadState::Branch { .. });
        let head_oid = match &parsed_status.head {
            HeadState::Branch { oid, .. } | HeadState::Detached { oid } => Some(oid.as_str()),
            HeadState::Unborn { .. } => None,
        };
        let target_in_head_history = if let Some(head_oid) = head_oid {
            Some(self.is_ancestor(path, &oid, head_oid).await?)
        } else {
            None
        };
        let cherry_pick_unavailable = match target_in_head_history {
            Some(true) => Some("Commit is already in the current HEAD history"),
            Some(false) => None,
            None => Some("Check out a commit before cherry-picking"),
        };
        let revert_unavailable = match target_in_head_history {
            Some(true) => None,
            Some(false) => Some("Commit is not in the current HEAD history"),
            None => Some("Check out a commit before reverting"),
        };
        let action = |kind, requires_clean, requires_confirmation, unavailable: Option<&str>| {
            let disabled_reason = if operation_busy {
                Some("Finish or abort the current Git operation first".to_owned())
            } else if kind == CommitActionKind::Reset && reset_unavailable {
                Some("Check out a local branch before resetting".to_owned())
            } else if let Some(reason) = unavailable {
                Some(reason.to_owned())
            } else if requires_clean && dirty {
                Some("Working tree must be clean for this action".to_owned())
            } else {
                None
            };
            CommitActionAvailability {
                kind,
                enabled: disabled_reason.is_none(),
                disabled_reason,
                requires_confirmation,
            }
        };
        Ok(vec![
            action(CommitActionKind::Checkout, true, false, None),
            action(CommitActionKind::CreateBranch, false, false, None),
            action(
                CommitActionKind::CherryPick,
                true,
                false,
                cherry_pick_unavailable,
            ),
            action(CommitActionKind::Revert, true, false, revert_unavailable),
            action(CommitActionKind::Reset, false, true, None),
            action(CommitActionKind::CreateTag, false, false, None),
            CommitActionAvailability {
                kind: CommitActionKind::CopySha,
                enabled: true,
                disabled_reason: None,
                requires_confirmation: false,
            },
        ])
    }

    async fn continue_operation(
        &self,
        path: &Path,
        operation: ContinueOperation,
    ) -> ApiResult<MutationResult> {
        ensure_operation(self.operation_state(path).await?, operation)?;
        let args = match operation {
            ContinueOperation::Merge => os_args(&["merge", "--continue"]),
            ContinueOperation::Rebase => os_args(&["rebase", "--continue"]),
            ContinueOperation::CherryPick => os_args(&["cherry-pick", "--continue"]),
            ContinueOperation::Revert => os_args(&["revert", "--continue"]),
        };
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn abort_operation(
        &self,
        path: &Path,
        operation: ContinueOperation,
    ) -> ApiResult<MutationResult> {
        ensure_operation(self.operation_state(path).await?, operation)?;
        let args = match operation {
            ContinueOperation::Merge => os_args(&["merge", "--abort"]),
            ContinueOperation::Rebase => os_args(&["rebase", "--abort"]),
            ContinueOperation::CherryPick => os_args(&["cherry-pick", "--abort"]),
            ContinueOperation::Revert => os_args(&["revert", "--abort"]),
        };
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn stash_list(&self, path: &Path) -> ApiResult<Vec<StashEntry>> {
        let mut args = os_args(&["stash", "list"]);
        args.push(format!("--format={STASH_FORMAT}").into());
        let output = self.read(Some(path), args).await?;
        parse_stashes(&output.stdout)
    }

    async fn stash_push(
        &self,
        path: &Path,
        message: Option<&str>,
        include_untracked: bool,
    ) -> ApiResult<MutationResult> {
        let mut args = os_args(&["stash", "push"]);
        if include_untracked {
            args.push("--include-untracked".into());
        }
        if let Some(message) = message {
            if message.len() > MAX_COMMIT_MESSAGE_BYTES || message.contains('\0') {
                return Err(ApiError::new(
                    ErrorCode::InvalidSettings,
                    "Stash message is too large",
                ));
            }
            args.push("--message".into());
            args.push(message.into());
        }
        self.mutate(path, args, None, CancellationToken::new(), false)
            .await
    }

    async fn stash_apply(&self, path: &Path, index: usize, pop: bool) -> ApiResult<MutationResult> {
        verify_stash_index(self.stash_list(path).await?, index)?;
        let action = if pop { "pop" } else { "apply" };
        self.mutate(
            path,
            vec![
                "stash".into(),
                action.into(),
                format!("stash@{{{index}}}").into(),
            ],
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    async fn stash_drop(
        &self,
        path: &Path,
        index: usize,
        confirmed: bool,
    ) -> ApiResult<MutationResult> {
        if !confirmed {
            return Err(confirmation_required(
                "Dropping a stash requires confirmation",
            ));
        }
        verify_stash_index(self.stash_list(path).await?, index)?;
        self.mutate(
            path,
            vec![
                "stash".into(),
                "drop".into(),
                format!("stash@{{{index}}}").into(),
            ],
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }
}

fn blocking_line_stats_task_error(error: tokio::task::JoinError) -> ApiError {
    ApiError::new(
        ErrorCode::Internal,
        "Untracked line count worker task failed unexpectedly",
    )
    .with_details(error.to_string())
}

fn blocking_conflict_task_error(error: tokio::task::JoinError) -> ApiError {
    ApiError::new(
        ErrorCode::Internal,
        "Conflict file worker task failed unexpectedly",
    )
    .with_details(error.to_string())
}

fn parse_unmerged_index_entries(
    stdout: &[u8],
    expected_path: &str,
) -> ApiResult<Vec<UnmergedIndexEntry>> {
    let mut entries = Vec::new();
    for record in stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let tab = record
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::GitCommandFailed,
                    "Git returned malformed unmerged index data",
                )
            })?;
        if &record[tab + 1..] != expected_path.as_bytes() {
            return Err(ApiError::new(
                ErrorCode::GitCommandFailed,
                "Git returned an unexpected unmerged path",
            ));
        }
        let header = std::str::from_utf8(&record[..tab]).map_err(|error| {
            ApiError::new(
                ErrorCode::GitCommandFailed,
                "Git returned non-UTF-8 unmerged index metadata",
            )
            .with_details(error.to_string())
        })?;
        let mut fields = header.split_ascii_whitespace();
        let mode = fields.next().unwrap_or_default();
        let oid = fields.next().unwrap_or_default();
        let stage = fields
            .next()
            .unwrap_or_default()
            .parse::<u8>()
            .map_err(|error| {
                ApiError::new(
                    ErrorCode::GitCommandFailed,
                    "Git returned an invalid conflict stage",
                )
                .with_details(error.to_string())
            })?;
        if fields.next().is_some()
            || !matches!(stage, 1..=3)
            || mode.len() != 6
            || !mode.bytes().all(|byte| byte.is_ascii_digit())
            || !is_full_oid(oid)
            || entries
                .iter()
                .any(|entry: &UnmergedIndexEntry| entry.stage == stage)
        {
            return Err(ApiError::new(
                ErrorCode::GitCommandFailed,
                "Git returned inconsistent unmerged index metadata",
            ));
        }
        entries.push(UnmergedIndexEntry {
            mode: mode.to_owned(),
            oid: oid.to_owned(),
            stage,
        });
    }
    if entries.is_empty() {
        return Err(ApiError::new(
            ErrorCode::StaleSnapshot,
            "Conflict index entries no longer exist",
        )
        .with_details(expected_path.to_owned()));
    }
    entries.sort_unstable_by_key(|entry| entry.stage);
    Ok(entries)
}

fn entry_at_stage(entries: &[UnmergedIndexEntry], stage: u8) -> Option<&UnmergedIndexEntry> {
    entries.iter().find(|entry| entry.stage == stage)
}

fn conflict_expected_state(
    entries: &[UnmergedIndexEntry],
    result: ConflictWorktreeIdentity,
) -> ConflictExpectedState {
    let identity = |stage| {
        entry_at_stage(entries, stage).map(|entry| ConflictStageIdentity {
            oid: entry.oid.clone(),
            mode: entry.mode.clone(),
        })
    };
    ConflictExpectedState {
        base: identity(1),
        ours: identity(2),
        theirs: identity(3),
        result,
    }
}

fn classify_conflict_content(bytes: Vec<u8>, reported_size: u64) -> ConflictFileContent {
    if bytes.len() > MAX_CONFLICT_TEXT_BYTES {
        return ConflictFileContent {
            kind: ConflictContentKind::TooLarge,
            size: Some(bytes.len() as u64),
            text: None,
            line_ending: None,
        };
    }
    if bytes.contains(&0) {
        return ConflictFileContent {
            kind: ConflictContentKind::Binary,
            size: Some(reported_size),
            text: None,
            line_ending: None,
        };
    }
    match String::from_utf8(bytes) {
        Ok(text) => {
            let line_ending = detect_line_ending(&text);
            ConflictFileContent {
                kind: ConflictContentKind::Text,
                size: Some(reported_size),
                text: Some(text),
                line_ending: Some(line_ending),
            }
        }
        Err(_) => ConflictFileContent {
            kind: ConflictContentKind::Binary,
            size: Some(reported_size),
            text: None,
            line_ending: None,
        },
    }
}

fn missing_worktree_identity() -> ConflictWorktreeIdentity {
    ConflictWorktreeIdentity {
        kind: ConflictWorktreeKind::Missing,
        size: None,
        sha256: None,
        line_ending: None,
        mode: None,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(unix)]
fn os_string_bytes(value: &std::ffi::OsStr) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    value.as_bytes().to_vec()
}

#[cfg(windows)]
fn os_string_bytes(value: &std::ffi::OsStr) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    value
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>()
}

#[cfg(not(any(unix, windows)))]
fn os_string_bytes(value: &std::ffi::OsStr) -> Vec<u8> {
    value.to_string_lossy().as_bytes().to_vec()
}

fn detect_line_ending(text: &str) -> ConflictLineEnding {
    let bytes = text.as_bytes();
    let mut saw_lf = false;
    let mut saw_crlf = false;
    let mut saw_bare_cr = false;
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' if bytes.get(index + 1) == Some(&b'\n') => {
                saw_crlf = true;
                index += 2;
            }
            b'\r' => {
                saw_bare_cr = true;
                index += 1;
            }
            b'\n' => {
                saw_lf = true;
                index += 1;
            }
            _ => index += 1,
        }
    }
    match (saw_lf, saw_crlf, saw_bare_cr) {
        (false, false, false) => ConflictLineEnding::None,
        (true, false, false) => ConflictLineEnding::Lf,
        (false, true, false) => ConflictLineEnding::CrLf,
        _ => ConflictLineEnding::Mixed,
    }
}

fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn encode_edited_conflict_text(
    text: &str,
    policy: ConflictLineEndingPolicy,
    current: &ConflictFileContent,
) -> ApiResult<Vec<u8>> {
    match current.kind {
        ConflictContentKind::Missing | ConflictContentKind::Text => {
            let normalized = normalize_line_endings(text);
            match policy {
                ConflictLineEndingPolicy::Lf => Ok(normalized.into_bytes()),
                ConflictLineEndingPolicy::CrLf => Ok(normalized.replace('\n', "\r\n").into_bytes()),
                ConflictLineEndingPolicy::Preserve => {
                    match current.line_ending.unwrap_or(ConflictLineEnding::None) {
                        ConflictLineEnding::CrLf => {
                            Ok(normalized.replace('\n', "\r\n").into_bytes())
                        }
                        ConflictLineEnding::Lf | ConflictLineEnding::None => {
                            Ok(normalized.into_bytes())
                        }
                        ConflictLineEnding::Mixed => {
                            let original = current.text.as_deref().unwrap_or_default();
                            if normalize_line_endings(original) == normalized {
                                Ok(original.as_bytes().to_vec())
                            } else {
                                Err(ApiError::new(
                                    ErrorCode::InvalidRequest,
                                    "Edited mixed line endings require an explicit LF or CRLF policy",
                                ))
                            }
                        }
                    }
                }
            }
        }
        ConflictContentKind::Binary | ConflictContentKind::TooLarge => Err(ApiError::new(
            ErrorCode::UnsupportedOperation,
            "Built-in text editor cannot save binary or oversized conflict content",
        )),
    }
}

fn new_conflict_temporary(parent: &Path, desired_mode: Option<&str>) -> ApiResult<NamedTempFile> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut builder = tempfile::Builder::new();
        if let Some(desired_mode) = desired_mode {
            // Passing creation permissions lets the operating system apply the
            // process umask. A later chmod to 0644/0755 would bypass it.
            let mode = if desired_mode == "100755" {
                0o777
            } else {
                0o666
            };
            builder.permissions(fs::Permissions::from_mode(mode));
        }
        return builder
            .tempfile_in(parent)
            .map_err(conflict_temporary_error);
    }
    #[cfg(not(unix))]
    {
        let _ = desired_mode;
        NamedTempFile::new_in(parent).map_err(conflict_temporary_error)
    }
}

fn conflict_temporary_error(error: std::io::Error) -> ApiError {
    ApiError::new(
        ErrorCode::Io,
        "Temporary conflict result could not be created",
    )
    .with_details(error.to_string())
}

#[cfg(unix)]
fn conflict_file_mode(metadata: &fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;

    Some(metadata.permissions().mode() & 0o7777)
}

#[cfg(not(unix))]
fn conflict_file_mode(_metadata: &fs::Metadata) -> Option<u32> {
    None
}

fn checked_worktree_target(
    repository: &Path,
    relative_path: &str,
    reject_target_symlink: bool,
) -> ApiResult<PathBuf> {
    validate_relative_path(relative_path)?;
    let root = dunce::canonicalize(repository).map_err(|error| {
        ApiError::new(
            ErrorCode::InvalidRepository,
            "Repository root could not be resolved",
        )
        .with_details(error.to_string())
    })?;
    let lexical_target = root.join(relative_path);
    let parent = lexical_target.parent().ok_or_else(|| {
        ApiError::new(
            ErrorCode::InvalidPath,
            "Conflict result has no repository-relative parent",
        )
    })?;
    let canonical_parent = dunce::canonicalize(parent).map_err(|error| {
        ApiError::new(
            ErrorCode::InvalidPath,
            "Conflict result parent could not be resolved",
        )
        .with_details(error.to_string())
    })?;
    if !canonical_parent.starts_with(&root) {
        return Err(ApiError::new(
            ErrorCode::ProtectedOperation,
            "Conflict result path escapes the repository through a symlink",
        ));
    }
    let file_name = lexical_target.file_name().ok_or_else(|| {
        ApiError::new(ErrorCode::InvalidPath, "Conflict result path is malformed")
    })?;
    let target = canonical_parent.join(file_name);
    match fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if reject_target_symlink && metadata.file_type().is_symlink() {
                return Err(ApiError::new(
                    ErrorCode::ProtectedOperation,
                    "Edited conflict result cannot replace a symbolic link",
                ));
            }
            if !metadata.file_type().is_symlink() {
                let canonical_target = dunce::canonicalize(&target).map_err(|error| {
                    ApiError::new(
                        ErrorCode::InvalidPath,
                        "Conflict result could not be resolved",
                    )
                    .with_details(error.to_string())
                })?;
                if !canonical_target.starts_with(&root) {
                    return Err(ApiError::new(
                        ErrorCode::ProtectedOperation,
                        "Conflict result path escapes the repository",
                    ));
                }
                if !metadata.is_file() {
                    return Err(ApiError::new(
                        ErrorCode::InvalidPath,
                        "Conflict result path is not a regular file",
                    ));
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(
                ApiError::new(ErrorCode::Io, "Conflict result metadata could not be read")
                    .with_details(error.to_string()),
            );
        }
    }
    Ok(target)
}

fn canonical_or_absolute(base: &Path, value: &str) -> ApiResult<PathBuf> {
    let path = PathBuf::from(value);
    let path = if path.is_absolute() {
        path
    } else {
        base.join(path)
    };
    dunce::canonicalize(&path).map_err(|error| {
        ApiError::new(
            ErrorCode::InvalidRepository,
            "Repository metadata path could not be resolved",
        )
        .with_details(error.to_string())
    })
}

fn operation_state_from_git_dir(git_dir: &Path) -> RepositoryOperationState {
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

fn validate_relative_path(path: &str) -> ApiResult<()> {
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

fn validate_paths(paths: &[String]) -> ApiResult<()> {
    for path in paths {
        validate_relative_path(path)?;
    }
    Ok(())
}

fn validate_message(message: &str) -> ApiResult<()> {
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

fn validate_mainline_parent(parent_count: usize, mainline_parent: Option<u32>) -> ApiResult<()> {
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

fn validate_remote_name(name: &str) -> ApiResult<()> {
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

fn validate_remote_url(url: &str) -> ApiResult<()> {
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

fn is_full_oid(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn supports_merge_tree_preflight(version: &GitVersion) -> bool {
    version.major > 2 || (version.major == 2 && version.minor >= 38)
}

fn merge_tree_preflight_unavailable(output: &GitCommandOutput) -> bool {
    let diagnostic = format!(
        "{}\n{}",
        output.stderr_lossy_redacted(),
        output.stdout_lossy()
    )
    .to_ascii_lowercase();
    output.status.code() == Some(129)
        || diagnostic.contains("unknown option")
        || diagnostic.contains("unrecognized option")
        || diagnostic.contains("unknown switch")
}

fn parse_merge_tree_paths(stdout: &[u8]) -> ApiResult<Vec<String>> {
    let mut fields = stdout.split(|byte| *byte == 0);
    let tree_oid = fields
        .next()
        .map(String::from_utf8_lossy)
        .map(|value| value.trim().to_owned())
        .unwrap_or_default();
    if !is_full_oid(&tree_oid) {
        return Err(ApiError::new(
            ErrorCode::GitCommandFailed,
            "Git conflict preflight did not return a valid tree object ID",
        ));
    }

    let mut paths: Vec<String> = fields
        .filter(|field| !field.is_empty())
        .map(|field| String::from_utf8_lossy(field).into_owned())
        .collect();
    paths.sort_unstable();
    paths.dedup();
    Ok(paths)
}

fn invalid_ref() -> ApiError {
    ApiError::new(ErrorCode::InvalidRefName, "Git reference name is invalid")
}

fn confirmation_required(message: &'static str) -> ApiError {
    ApiError::new(ErrorCode::ProtectedOperation, message)
}

fn ensure_operation(
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

fn apply_stash_view(commits: &mut Vec<CommitSummary>, stashes: &StashGraph) {
    if stashes.is_empty() {
        return;
    }

    commits.retain(|commit| !stashes.hidden.contains(&commit.oid));
    for commit in commits.iter_mut() {
        let Some(stash) = stashes.commits.get(&commit.oid) else {
            continue;
        };
        commit.parent_oids.truncate(1);
        if commit.body_preview.is_empty() {
            commit.body_preview = commit.subject.clone();
        }
        commit.subject = stash.label.clone();
        commit.stash = Some(stash.reference.clone());
    }
}

fn verify_stash_index(stashes: Vec<StashEntry>, index: usize) -> ApiResult<()> {
    if stashes.iter().any(|stash| stash.index == index) {
        Ok(())
    } else {
        Err(ApiError::new(
            ErrorCode::InvalidRevision,
            "Selected stash no longer exists",
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, process::Command};

    use tempfile::tempdir;

    use super::*;

    fn git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .expect("run fixture git command");
        assert!(
            output.status.success(),
            "fixture git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_stdout(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .expect("run fixture git command");
        assert!(
            output.status.success(),
            "fixture git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("fixture git output is UTF-8")
            .trim()
            .to_owned()
    }

    async fn committed_repository() -> (tempfile::TempDir, GitCliBackend, String) {
        let directory = tempdir().expect("temp repository");
        let backend = GitCliBackend::default();
        backend
            .init_repository(directory.path(), "main")
            .await
            .expect("initialize repository");
        git(directory.path(), &["config", "user.name", "GitCat Test"]);
        git(
            directory.path(),
            &["config", "user.email", "gitcat@example.test"],
        );
        fs::write(directory.path().join("hello.txt"), "first\n").expect("write fixture");
        backend
            .stage_paths(directory.path(), &["hello.txt".into()])
            .await
            .expect("stage fixture");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "initial subject\n\nsearchable body text\nárvíztűrő tükörfúrógép"
                        .into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("commit fixture");
        let oid = backend
            .head_oid(directory.path())
            .await
            .expect("read HEAD")
            .expect("HEAD exists");
        (directory, backend, oid)
    }

    async fn preflight_conflict_repository() -> (tempfile::TempDir, GitCliBackend, String, String) {
        let (directory, backend, base_oid) = committed_repository().await;
        backend
            .create_branch(directory.path(), "conflicting", &base_oid, true)
            .await
            .expect("create preflight target branch");
        fs::write(directory.path().join("hello.txt"), "target version\n")
            .expect("write target version");
        backend
            .stage_paths(directory.path(), &["hello.txt".into()])
            .await
            .expect("stage target version");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "target change".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("commit target version");
        let target_oid = backend
            .head_oid(directory.path())
            .await
            .expect("read target HEAD")
            .expect("target HEAD exists");

        backend
            .checkout_branch(directory.path(), "main")
            .await
            .expect("return to main for preflight");
        fs::write(directory.path().join("hello.txt"), "current version\n")
            .expect("write current version");
        backend
            .stage_paths(directory.path(), &["hello.txt".into()])
            .await
            .expect("stage current version");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "current change".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("commit current version");
        let head_oid = backend
            .head_oid(directory.path())
            .await
            .expect("read current HEAD")
            .expect("current HEAD exists");

        (directory, backend, target_oid, head_oid)
    }

    fn preflight_observable_state(path: &Path) -> (String, String, String, Vec<u8>) {
        (
            git_stdout(path, &["rev-parse", "HEAD"]),
            git_stdout(path, &["status", "--porcelain=v2"]),
            git_stdout(path, &["diff", "--cached", "--binary"]),
            fs::read(path.join("hello.txt")).expect("read working copy"),
        )
    }

    async fn conflicted_repository() -> (tempfile::TempDir, GitCliBackend) {
        let (directory, backend, base_oid) = committed_repository().await;
        backend
            .create_branch(directory.path(), "conflicting", &base_oid, true)
            .await
            .expect("create conflicting branch");
        fs::write(directory.path().join("hello.txt"), "branch version\n")
            .expect("write branch version");
        backend
            .stage_paths(directory.path(), &["hello.txt".into()])
            .await
            .expect("stage branch version");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "branch change".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("commit branch version");

        backend
            .checkout_branch(directory.path(), "main")
            .await
            .expect("return to main");
        fs::write(directory.path().join("hello.txt"), "main version\n")
            .expect("write main version");
        backend
            .stage_paths(directory.path(), &["hello.txt".into()])
            .await
            .expect("stage main version");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "main change".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("commit main version");

        let result = backend
            .merge_branch(directory.path(), "conflicting")
            .await
            .expect("conflict is returned as resumable state");
        assert!(result.needs_user_action);
        assert_eq!(result.conflicts.len(), 1);
        (directory, backend)
    }

    async fn modify_delete_conflicted_repository() -> (tempfile::TempDir, GitCliBackend) {
        let (directory, backend, base_oid) = committed_repository().await;
        backend
            .create_branch(directory.path(), "deleting", &base_oid, true)
            .await
            .expect("create deleting branch");
        git(directory.path(), &["rm", "--", "hello.txt"]);
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "delete hello".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("commit deletion");

        backend
            .checkout_branch(directory.path(), "main")
            .await
            .expect("return to main");
        fs::write(directory.path().join("hello.txt"), "main version\n")
            .expect("write main version");
        backend
            .stage_paths(directory.path(), &["hello.txt".into()])
            .await
            .expect("stage main version");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "modify hello".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("commit modification");
        backend
            .merge_branch(directory.path(), "deleting")
            .await
            .expect("modify/delete conflict is resumable");
        (directory, backend)
    }

    async fn delete_modify_conflicted_repository() -> (tempfile::TempDir, GitCliBackend) {
        let (directory, backend, base_oid) = committed_repository().await;
        backend
            .create_branch(directory.path(), "modifying", &base_oid, true)
            .await
            .expect("create modifying branch");
        fs::write(directory.path().join("hello.txt"), "branch version\n")
            .expect("write branch version");
        backend
            .stage_paths(directory.path(), &["hello.txt".into()])
            .await
            .expect("stage branch version");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "modify hello".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("commit modification");

        backend
            .checkout_branch(directory.path(), "main")
            .await
            .expect("return to main");
        git(directory.path(), &["rm", "--", "hello.txt"]);
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "delete hello".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("commit deletion");
        backend
            .merge_branch(directory.path(), "modifying")
            .await
            .expect("delete/modify conflict is resumable");
        (directory, backend)
    }

    async fn conflict_expected(
        backend: &GitCliBackend,
        path: &Path,
        conflict_path: &str,
    ) -> ConflictExpectedState {
        backend
            .conflict_details(path, conflict_path)
            .await
            .expect("read conflict details")
            .expected_state
    }

    #[tokio::test]
    async fn reword_head_updates_message_without_folding_staged_changes() {
        let (directory, backend, _oid) = committed_repository().await;
        // A staged change on a different path must stay out of the amended commit.
        fs::write(directory.path().join("staged.txt"), "staged\n").expect("write staged");
        backend
            .stage_paths(directory.path(), &["staged.txt".into()])
            .await
            .expect("stage extra file");

        backend
            .reword_commit(directory.path(), "HEAD", "reworded head\n\nnew body")
            .await
            .expect("reword head");

        assert_eq!(
            git_stdout(directory.path(), &["log", "-1", "--format=%B"]).trim(),
            "reworded head\n\nnew body"
        );
        assert_eq!(
            git_stdout(directory.path(), &["ls-tree", "--name-only", "HEAD"]),
            "hello.txt"
        );
        assert_eq!(
            git_stdout(directory.path(), &["diff", "--cached", "--name-only"]),
            "staged.txt"
        );
    }

    #[tokio::test]
    async fn reword_older_commit_preserves_author_and_replays_descendants() {
        let (directory, backend, base_oid) = committed_repository().await;
        let author_before = git_stdout(directory.path(), &["show", "-s", "--format=%an <%ae> %aI", &base_oid]);
        fs::write(directory.path().join("hello.txt"), "first\nsecond\n").expect("write second");
        backend
            .stage_paths(directory.path(), &["hello.txt".into()])
            .await
            .expect("stage second");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions { message: "child commit".into(), amend: false, signoff: false },
            )
            .await
            .expect("commit child");

        backend
            .reword_commit(directory.path(), &base_oid, "reworded base")
            .await
            .expect("reword base commit");

        let subjects = git_stdout(directory.path(), &["log", "--reverse", "--format=%s"]);
        assert_eq!(subjects, "reworded base\nchild commit");
        // Authorship (including the author date) survives the rewrite.
        let root_oid = git_stdout(directory.path(), &["rev-list", "--max-parents=0", "HEAD"]);
        assert_eq!(
            git_stdout(directory.path(), &["show", "-s", "--format=%an <%ae> %aI", &root_oid]),
            author_before
        );
        // The working tree is unchanged by the replay (ignore platform CRLF).
        let worktree = fs::read_to_string(directory.path().join("hello.txt"))
            .expect("read worktree")
            .replace("\r\n", "\n");
        assert_eq!(worktree, "first\nsecond\n");
    }

    #[tokio::test]
    async fn reword_rejects_commit_off_the_current_branch() {
        let (directory, backend, base_oid) = committed_repository().await;
        // A commit that only lives on another branch is not reachable from HEAD.
        backend
            .create_branch(directory.path(), "side", &base_oid, true)
            .await
            .expect("create side branch");
        fs::write(directory.path().join("side.txt"), "side\n").expect("write side");
        backend
            .stage_paths(directory.path(), &["side.txt".into()])
            .await
            .expect("stage side");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions { message: "side only".into(), amend: false, signoff: false },
            )
            .await
            .expect("commit side");
        let side_oid = backend
            .head_oid(directory.path())
            .await
            .expect("read side HEAD")
            .expect("side HEAD exists");
        backend
            .checkout_branch(directory.path(), "main")
            .await
            .expect("return to main");

        let error = backend
            .reword_commit(directory.path(), &side_oid, "nope")
            .await
            .expect_err("reword off-branch commit is rejected");
        assert_eq!(error.code, ErrorCode::UnsupportedOperation);
    }

    #[tokio::test]
    async fn conflict_preflight_reports_clean_without_touching_repository_state() {
        let (directory, backend, head_oid) = committed_repository().await;
        git(directory.path(), &["branch", "clean-target"]);
        let before = preflight_observable_state(directory.path());

        let result = backend
            .conflict_preflight(directory.path(), "clean-target")
            .await
            .expect("run clean conflict preflight");

        assert_eq!(result.target, "clean-target");
        assert_eq!(result.target_oid, head_oid);
        assert_eq!(result.state, ConflictPreflightState::Clean);
        assert!(result.conflicting_paths.is_empty());
        assert_eq!(result.unavailable_reason, None);
        assert_eq!(preflight_observable_state(directory.path()), before);
    }

    #[tokio::test]
    async fn conflict_preflight_reports_paths_without_touching_repository_state() {
        let (directory, backend, target_oid, head_oid) = preflight_conflict_repository().await;
        let before = preflight_observable_state(directory.path());

        let result = backend
            .conflict_preflight(directory.path(), "conflicting")
            .await
            .expect("run conflicting preflight");

        assert_eq!(result.target, "conflicting");
        assert_eq!(result.target_oid, target_oid);
        assert_eq!(result.state, ConflictPreflightState::Conflicting);
        assert_eq!(result.conflicting_paths, vec!["hello.txt"]);
        assert_eq!(result.unavailable_reason, None);
        assert_eq!(
            git_stdout(directory.path(), &["rev-parse", "HEAD"]),
            head_oid
        );
        assert_eq!(preflight_observable_state(directory.path()), before);

        let snapshot = backend
            .snapshot(directory.path())
            .await
            .expect("snapshot after conflict preflight");
        assert_eq!(snapshot.operation_state, RepositoryOperationState::Normal);
        assert!(snapshot.status.clean);
    }

    #[tokio::test]
    async fn conflict_preflight_rejects_unresolvable_target() {
        let (directory, backend, _) = committed_repository().await;
        let error = backend
            .conflict_preflight(directory.path(), "missing-target")
            .await
            .expect_err("target must resolve before preflight");
        assert_eq!(error.code, ErrorCode::InvalidRevision);
    }

    #[test]
    fn conflict_preflight_version_gate_is_stable() {
        let version = |major, minor| GitVersion {
            major,
            minor,
            patch: 0,
            raw: format!("git version {major}.{minor}.0"),
        };
        assert!(!supports_merge_tree_preflight(&version(2, 37)));
        assert!(supports_merge_tree_preflight(&version(2, 38)));
        assert!(supports_merge_tree_preflight(&version(3, 0)));
    }

    #[tokio::test]
    async fn repository_read_workflow_uses_machine_formats() {
        let (directory, backend, oid) = committed_repository().await;
        let snapshot = backend
            .snapshot(directory.path())
            .await
            .expect("snapshot repository");
        assert!(snapshot.status.clean);
        assert_eq!(snapshot.local_branches.len(), 1);
        assert_eq!(snapshot.local_branches[0].name, "main");

        let history = backend
            .history(directory.path(), &HistoryQuery::default())
            .await
            .expect("history");
        assert_eq!(history.commits.len(), 1);
        assert_eq!(history.commits[0].oid, oid);
        assert_eq!(history.commits[0].subject, "initial subject");

        let search = backend
            .search_commits(
                directory.path(),
                &CommitSearchQuery {
                    query: "BODY TEXT".into(),
                    scope: HistoryScope::AllRefs,
                    limit: 20,
                },
            )
            .await
            .expect("search body");
        assert_eq!(search.total, 1);
        assert!(search.hits[0].matched_body);

        let unicode_search = backend
            .search_commits(
                directory.path(),
                &CommitSearchQuery {
                    query: "ÁRVÍZTŰRŐ".into(),
                    scope: HistoryScope::AllRefs,
                    limit: 20,
                },
            )
            .await
            .expect("search Unicode body");
        assert_eq!(unicode_search.total, 1);
        assert!(unicode_search.hits[0].matched_body);

        let details = backend
            .commit_details(directory.path(), &oid, 0)
            .await
            .expect("commit details");
        assert_eq!(details.files.len(), 1);
        assert_eq!(details.files[0].new_path, "hello.txt");
        assert_eq!(details.files[0].additions, Some(1));
    }

    #[tokio::test]
    async fn history_shows_one_row_per_stash() {
        let (directory, backend, _) = committed_repository().await;
        fs::write(directory.path().join("hello.txt"), "stashed\n").expect("write tracked change");
        fs::write(directory.path().join("extra.txt"), "untracked\n").expect("write untracked file");
        backend
            .stage_paths(directory.path(), &["hello.txt".into()])
            .await
            .expect("stage tracked change");
        backend
            .stash_push(directory.path(), None, true)
            .await
            .expect("stash changes");

        let page = backend
            .history(
                directory.path(),
                &HistoryQuery {
                    scope: HistoryScope::AllRefs,
                    cursor: None,
                    limit: 50,
                },
            )
            .await
            .expect("history page");

        let stash_rows: Vec<&CommitSummary> = page
            .commits
            .iter()
            .filter(|commit| commit.stash.is_some())
            .collect();
        assert_eq!(stash_rows.len(), 1);
        assert_eq!(stash_rows[0].subject, "WIP on main");
        assert_eq!(stash_rows[0].parent_oids.len(), 1);
        assert_eq!(stash_rows[0].graph.edges.len(), 1);
        assert_eq!(stash_rows[0].stash.as_ref().unwrap().index, 0);
        let first_stash_oid = stash_rows[0].oid.clone();
        assert!(
            !page
                .commits
                .iter()
                .any(|commit| commit.subject.starts_with("index on")
                    || commit.subject.starts_with("untracked files on"))
        );

        fs::write(directory.path().join("hello.txt"), "named\n").expect("write second change");
        backend
            .stash_push(directory.path(), Some("layout tweaks"), true)
            .await
            .expect("stash with message");
        let page = backend
            .history(
                directory.path(),
                &HistoryQuery {
                    scope: HistoryScope::AllRefs,
                    cursor: None,
                    limit: 50,
                },
            )
            .await
            .expect("history page after named stash");
        let mut labels: Vec<&str> = page
            .commits
            .iter()
            .filter(|commit| commit.stash.is_some())
            .map(|commit| commit.subject.as_str())
            .collect();
        labels.sort_unstable();
        assert_eq!(labels, vec!["WIP on main", "layout tweaks"]);

        let details = backend
            .commit_details(directory.path(), &first_stash_oid, 0)
            .await
            .expect("stash commit details");
        assert_eq!(details.subject, "WIP on main");
    }

    #[tokio::test]
    async fn history_cursor_tracks_refs_not_worktree_edits() {
        let (directory, backend, first_oid) = committed_repository().await;
        fs::write(directory.path().join("hello.txt"), "second\n").expect("write second version");
        backend
            .stage_paths(directory.path(), &["hello.txt".into()])
            .await
            .expect("stage second version");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "second commit".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("second commit");
        let first_page = backend
            .history(
                directory.path(),
                &HistoryQuery {
                    scope: HistoryScope::AllRefs,
                    cursor: None,
                    limit: 1,
                },
            )
            .await
            .expect("first history page");
        let cursor = first_page.next_cursor.expect("next cursor");

        fs::write(directory.path().join("uncommitted.txt"), "worktree only\n")
            .expect("write worktree-only file");
        backend
            .history(
                directory.path(),
                &HistoryQuery {
                    scope: HistoryScope::AllRefs,
                    cursor: Some(cursor.clone()),
                    limit: 1,
                },
            )
            .await
            .expect("worktree edit keeps history cursor valid");

        backend
            .create_branch(directory.path(), "new-ref", &first_oid, false)
            .await
            .expect("create ref");
        let error = backend
            .history(
                directory.path(),
                &HistoryQuery {
                    scope: HistoryScope::AllRefs,
                    cursor: Some(cursor),
                    limit: 1,
                },
            )
            .await
            .expect_err("ref change invalidates cursor");
        assert_eq!(error.code, ErrorCode::StaleSnapshot);
    }

    #[tokio::test]
    async fn worktree_diff_branch_and_stash_workflow() {
        let (directory, backend, oid) = committed_repository().await;
        fs::write(directory.path().join("hello.txt"), "first\nsecond\n").expect("modify fixture");
        let diff = backend
            .diff(
                directory.path(),
                &DiffRequest {
                    target: DiffTarget::Worktree,
                    path: "hello.txt".into(),
                    context_lines: 3,
                    ignore_whitespace: false,
                    max_bytes: 1024 * 1024,
                },
            )
            .await
            .expect("worktree diff");
        assert_eq!(diff.stats.additions, 1);
        assert_eq!(diff.hunks.len(), 1);
        let error = backend
            .diff(
                directory.path(),
                &DiffRequest {
                    target: DiffTarget::Worktree,
                    path: ".".into(),
                    context_lines: 3,
                    ignore_whitespace: false,
                    max_bytes: 1024 * 1024,
                },
            )
            .await
            .expect_err("directory path rejected by single-file diff API");
        assert_eq!(error.code, ErrorCode::InvalidRequest);

        backend
            .stash_push(directory.path(), Some("test stash"), false)
            .await
            .expect("stash changes");
        let stashes = backend
            .stash_list(directory.path())
            .await
            .expect("list stashes");
        assert_eq!(stashes.len(), 1);
        backend
            .stash_apply(directory.path(), stashes[0].index, true)
            .await
            .expect("pop stash");

        backend
            .create_branch(directory.path(), "feature/test", &oid, false)
            .await
            .expect("create branch");
        let snapshot = backend
            .snapshot(directory.path())
            .await
            .expect("branch snapshot");
        assert!(
            snapshot
                .local_branches
                .iter()
                .any(|branch| branch.name == "feature/test")
        );
        let error = backend
            .delete_branch(directory.path(), "feature/test", true, false)
            .await
            .expect_err("force delete needs confirmation");
        assert_eq!(error.code, ErrorCode::ProtectedOperation);
        let error = backend
            .reset_to_commit(directory.path(), &oid, ResetMode::Hard, false)
            .await
            .expect_err("hard reset needs confirmation");
        assert_eq!(error.code, ErrorCode::ProtectedOperation);
    }

    #[tokio::test]
    async fn worktree_diff_reports_untracked_file_contents() {
        let (directory, backend, _) = committed_repository().await;
        fs::write(directory.path().join("fresh.txt"), "alpha\nbeta\n").expect("write new file");
        let diff = backend
            .diff(
                directory.path(),
                &DiffRequest {
                    target: DiffTarget::Worktree,
                    path: "fresh.txt".into(),
                    context_lines: 3,
                    ignore_whitespace: false,
                    max_bytes: 1024 * 1024,
                },
            )
            .await
            .expect("untracked worktree diff");
        assert_eq!(diff.status, ChangeKind::Added);
        assert_eq!(diff.stats.additions, 2);
        assert_eq!(diff.stats.deletions, 0);
        assert_eq!(diff.hunks.len(), 1);
        assert_eq!(diff.new_path, "fresh.txt");
    }

    #[tokio::test]
    async fn snapshot_reports_line_stats_for_staged_worktree_and_untracked_changes() {
        let directory = tempdir().expect("temp repository");
        let backend = GitCliBackend::default();
        backend
            .init_repository(directory.path(), "main")
            .await
            .expect("initialize repository");
        fs::write(directory.path().join("tracked.txt"), "one\ntwo\n").expect("write tracked file");
        backend
            .stage_paths(directory.path(), &["tracked.txt".into()])
            .await
            .expect("stage tracked file");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "chore: seed".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("seed commit");

        fs::write(directory.path().join("staged.txt"), "alpha\nbeta\n").expect("write staged file");
        backend
            .stage_paths(directory.path(), &["staged.txt".into()])
            .await
            .expect("stage new file");
        fs::write(directory.path().join("tracked.txt"), "one\ntwo\nthree\n")
            .expect("modify tracked file");
        fs::write(directory.path().join("fresh.txt"), "new\nlines\nhere\n")
            .expect("write untracked file");

        let snapshot = backend
            .snapshot(directory.path())
            .await
            .expect("snapshot with stats");
        let stats = |path: &str| {
            snapshot
                .status
                .entries
                .iter()
                .find(|entry| entry.path == path)
                .cloned()
                .unwrap_or_else(|| panic!("status entry for {path}"))
        };
        assert_eq!(
            stats("staged.txt").index_stats,
            Some(LineStats {
                additions: 2,
                deletions: 0
            })
        );
        assert_eq!(
            stats("tracked.txt").worktree_stats,
            Some(LineStats {
                additions: 1,
                deletions: 0
            })
        );
        assert_eq!(
            stats("fresh.txt").worktree_stats,
            Some(LineStats {
                additions: 3,
                deletions: 0
            })
        );
    }

    #[tokio::test]
    async fn unstage_in_unborn_repository_preserves_modified_worktree_file() {
        let directory = tempdir().expect("temp repository");
        let backend = GitCliBackend::default();
        backend
            .init_repository(directory.path(), "main")
            .await
            .expect("initialize repository");
        fs::write(directory.path().join("draft.txt"), "staged\n").expect("write staged version");
        backend
            .stage_paths(directory.path(), &["draft.txt".into()])
            .await
            .expect("stage draft");
        fs::write(directory.path().join("draft.txt"), "worktree changed\n")
            .expect("change worktree version");

        backend
            .unstage_paths(directory.path(), &["draft.txt".into()])
            .await
            .expect("unstage draft");
        assert_eq!(
            fs::read_to_string(directory.path().join("draft.txt")).expect("read worktree file"),
            "worktree changed\n"
        );
        let snapshot = backend
            .snapshot(directory.path())
            .await
            .expect("unborn snapshot");
        assert_eq!(snapshot.status.entries.len(), 1);
        assert_eq!(
            snapshot.status.entries[0].worktree,
            Some(ChangeKind::Untracked)
        );
    }

    #[tokio::test]
    async fn reset_rejects_detached_head() {
        let (directory, backend, oid) = committed_repository().await;
        backend
            .checkout_commit(directory.path(), &oid)
            .await
            .expect("detach HEAD");
        let error = backend
            .reset_to_commit(directory.path(), &oid, ResetMode::Mixed, true)
            .await
            .expect_err("detached reset rejected");
        assert_eq!(error.code, ErrorCode::UnsupportedOperation);
    }

    #[tokio::test]
    async fn commit_action_availability_matches_current_head_context() {
        let (directory, backend, base_oid) = committed_repository().await;
        backend
            .create_branch(directory.path(), "side", &base_oid, true)
            .await
            .expect("create side branch");
        fs::write(directory.path().join("side.txt"), "side\n").expect("write side file");
        backend
            .stage_paths(directory.path(), &["side.txt".into()])
            .await
            .expect("stage side file");
        backend
            .create_commit(
                directory.path(),
                &CommitOptions {
                    message: "side commit".into(),
                    amend: false,
                    signoff: false,
                },
            )
            .await
            .expect("commit side file");
        let side_oid = backend
            .head_oid(directory.path())
            .await
            .expect("read side HEAD")
            .expect("side HEAD exists");
        backend
            .checkout_branch(directory.path(), "main")
            .await
            .expect("return to main");

        let main_actions = backend
            .commit_action_availability(directory.path(), &base_oid)
            .await
            .expect("main commit actions");
        fn action(
            actions: &[CommitActionAvailability],
            kind: CommitActionKind,
        ) -> &CommitActionAvailability {
            actions
                .iter()
                .find(|action| action.kind == kind)
                .expect("action exists")
        }
        assert!(action(&main_actions, CommitActionKind::Checkout).enabled);
        assert!(action(&main_actions, CommitActionKind::CreateBranch).enabled);
        assert!(action(&main_actions, CommitActionKind::CreateTag).enabled);
        assert!(action(&main_actions, CommitActionKind::Reset).enabled);
        assert!(!action(&main_actions, CommitActionKind::CherryPick).enabled);
        assert!(
            action(&main_actions, CommitActionKind::CherryPick)
                .disabled_reason
                .as_deref()
                .is_some_and(|reason| reason.contains("already in the current HEAD history"))
        );
        assert!(action(&main_actions, CommitActionKind::Revert).enabled);

        let side_actions = backend
            .commit_action_availability(directory.path(), &side_oid)
            .await
            .expect("side commit actions");
        assert!(action(&side_actions, CommitActionKind::CherryPick).enabled);
        assert!(!action(&side_actions, CommitActionKind::Revert).enabled);
        assert!(
            action(&side_actions, CommitActionKind::Revert)
                .disabled_reason
                .as_deref()
                .is_some_and(|reason| reason.contains("not in the current HEAD history"))
        );

        fs::write(directory.path().join("dirty.txt"), "dirty\n").expect("write dirty file");
        let dirty_actions = backend
            .commit_action_availability(directory.path(), &side_oid)
            .await
            .expect("dirty commit actions");
        assert!(!action(&dirty_actions, CommitActionKind::Checkout).enabled);
        assert!(!action(&dirty_actions, CommitActionKind::CherryPick).enabled);
        assert!(!action(&dirty_actions, CommitActionKind::Revert).enabled);
        assert!(action(&dirty_actions, CommitActionKind::CreateBranch).enabled);
        assert!(action(&dirty_actions, CommitActionKind::CreateTag).enabled);
        assert!(action(&dirty_actions, CommitActionKind::Reset).enabled);
        assert!(action(&dirty_actions, CommitActionKind::CopySha).enabled);
    }

    #[test]
    fn mainline_parent_is_required_only_for_merge_commits() {
        assert!(validate_mainline_parent(2, Some(1)).is_ok());
        assert_eq!(
            validate_mainline_parent(2, None).unwrap_err().code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            validate_mainline_parent(1, Some(1)).unwrap_err().code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            validate_mainline_parent(2, Some(3)).unwrap_err().code,
            ErrorCode::InvalidRequest
        );
    }

    #[tokio::test]
    async fn rejects_ext_remote_before_spawning_clone() {
        let destination = tempdir().expect("destination parent");
        let backend = GitCliBackend::default();
        let error = backend
            .clone_repository(
                &CloneOptions {
                    url: "ext::sh -c bad".into(),
                    destination: destination
                        .path()
                        .join("clone")
                        .to_string_lossy()
                        .into_owned(),
                    branch: None,
                    depth: None,
                    filter_blob_none: false,
                },
                CancellationToken::new(),
            )
            .await
            .expect_err("ext transport rejected");
        assert_eq!(error.code, ErrorCode::ProtectedOperation);
    }

    #[tokio::test]
    async fn rejects_custom_remote_helpers_and_ambiguous_push_selection() {
        let destination = tempdir().expect("destination parent");
        let backend = GitCliBackend::default();
        for url in [
            "helper::payload",
            "--upload-pack=bad",
            "https://host/repo\nnext",
        ] {
            let error = backend
                .clone_repository(
                    &CloneOptions {
                        url: url.into(),
                        destination: destination
                            .path()
                            .join("clone")
                            .to_string_lossy()
                            .into_owned(),
                        branch: None,
                        depth: None,
                        filter_blob_none: false,
                    },
                    CancellationToken::new(),
                )
                .await
                .expect_err("unsafe transport rejected");
            assert_eq!(error.code, ErrorCode::ProtectedOperation);
        }

        let (directory, backend, _) = committed_repository().await;
        let error = backend
            .push(
                directory.path(),
                &PushOptions {
                    remote: None,
                    branch: Some("main".into()),
                    set_upstream: false,
                },
                CancellationToken::new(),
            )
            .await
            .expect_err("branch without remote rejected");
        assert_eq!(error.code, ErrorCode::InvalidRequest);
    }

    #[tokio::test]
    async fn rejects_bare_repository_with_stable_error() {
        let bare = tempdir().expect("bare repository");
        git(bare.path(), &["init", "--bare", "--quiet"]);
        let error = GitCliBackend::default()
            .open_repository(bare.path())
            .await
            .expect_err("bare repository rejected");
        assert_eq!(error.code, ErrorCode::UnsupportedOperation);
    }

    #[tokio::test]
    async fn local_remote_fetch_pull_and_push_use_explicit_modes() {
        let (directory, backend, _) = committed_repository().await;
        let bare = tempdir().expect("bare remote");
        git(bare.path(), &["init", "--bare", "--quiet"]);
        let bare_path = bare.path().to_string_lossy().into_owned();
        git(directory.path(), &["remote", "add", "origin", &bare_path]);

        backend
            .push(
                directory.path(),
                &PushOptions {
                    remote: Some("origin".into()),
                    branch: Some("main".into()),
                    set_upstream: true,
                },
                CancellationToken::new(),
            )
            .await
            .expect("initial push");
        backend
            .fetch(
                directory.path(),
                &FetchOptions {
                    remote: None,
                    prune: true,
                    tags: false,
                },
                CancellationToken::new(),
            )
            .await
            .expect("fetch all");
        backend
            .pull(
                directory.path(),
                &PullOptions {
                    remote: Some("origin".into()),
                    branch: Some("main".into()),
                    mode: PullMode::Rebase,
                    prune: true,
                    autostash: false,
                },
                CancellationToken::new(),
            )
            .await
            .expect("explicit rebase pull");

        let snapshot = backend
            .snapshot(directory.path())
            .await
            .expect("remote snapshot");
        assert_eq!(snapshot.remotes.len(), 1);
        assert!(
            snapshot
                .remote_branches
                .iter()
                .any(|branch| branch.name == "origin/main")
        );
        assert_eq!(
            snapshot.default_conflict_target.as_deref(),
            Some("origin/main")
        );
        git(directory.path(), &["branch", "--unset-upstream"]);
        git(directory.path(), &["remote", "set-head", "origin", "main"]);
        let symbolic_default = backend
            .snapshot(directory.path())
            .await
            .expect("snapshot with symbolic remote HEAD");
        assert_eq!(
            symbolic_default.default_conflict_target.as_deref(),
            Some("origin/main")
        );
        assert!(
            symbolic_default
                .remote_branches
                .iter()
                .all(|branch| branch.name != "origin/HEAD"),
            "symbolic remote HEAD must not render as a normal branch"
        );

        let updater_parent = tempdir().expect("updater parent");
        git(
            updater_parent.path(),
            &[
                "clone", "--quiet", "--branch", "main", &bare_path, "updater",
            ],
        );
        let updater = updater_parent.path().join("updater");
        git(&updater, &["config", "user.name", "GitCat Updater"]);
        git(&updater, &["config", "user.email", "updater@example.test"]);
        fs::write(updater.join("remote.txt"), "remote change\n").expect("write remote change");
        git(&updater, &["add", "--", "remote.txt"]);
        git(&updater, &["commit", "--quiet", "-m", "remote change"]);
        git(&updater, &["push", "--quiet", "origin", "main"]);

        // Explicit Merge mode must override pull.ff=false and still fast-forward
        // when possible, matching GitKraken's "fast-forward if possible" choice.
        git(directory.path(), &["config", "pull.ff", "false"]);
        backend
            .pull(
                directory.path(),
                &PullOptions {
                    remote: Some("origin".into()),
                    branch: Some("main".into()),
                    mode: PullMode::Merge,
                    prune: false,
                    autostash: false,
                },
                CancellationToken::new(),
            )
            .await
            .expect("explicit merge-mode pull");
        let head = backend
            .head_oid(directory.path())
            .await
            .expect("read pulled HEAD")
            .expect("pulled HEAD exists");
        let details = backend
            .commit_details(directory.path(), &head, 0)
            .await
            .expect("pulled commit details");
        assert_eq!(details.subject, "remote change");
        assert_eq!(details.parent_oids.len(), 1, "pull should fast-forward");
    }

    #[tokio::test]
    async fn conflict_details_exposes_three_index_versions_and_worktree_result() {
        let (directory, backend) = conflicted_repository().await;
        let details = backend
            .conflict_details(directory.path(), "hello.txt")
            .await
            .expect("read three-way conflict");

        let base = details.base.as_ref().expect("base stage");
        let ours = details.ours.as_ref().expect("ours stage");
        let theirs = details.theirs.as_ref().expect("theirs stage");
        assert_eq!(base.content.kind, ConflictContentKind::Text);
        assert_eq!(base.content.text.as_deref(), Some("first\n"));
        assert_eq!(ours.content.text.as_deref(), Some("main version\n"));
        assert_eq!(theirs.content.text.as_deref(), Some("branch version\n"));
        assert_eq!(details.result.kind, ConflictContentKind::Text);
        assert!(
            details
                .result
                .text
                .as_deref()
                .is_some_and(|text| text.contains("<<<<<<<") && text.contains(">>>>>>>"))
        );
        assert_eq!(
            details.expected_state.ours.as_ref().map(|stage| &stage.oid),
            Some(&ours.oid)
        );
        assert_eq!(
            details
                .expected_state
                .theirs
                .as_ref()
                .map(|stage| &stage.mode),
            Some(&theirs.mode)
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn oversized_conflict_result_is_hashed_off_executor_and_not_loaded_as_text() {
        let (directory, backend) = conflicted_repository().await;
        let oversized = vec![b'x'; MAX_CONFLICT_TEXT_BYTES + 64 * 1024];
        fs::write(directory.path().join("hello.txt"), &oversized)
            .expect("write oversized conflict result");

        let details = backend
            .conflict_details(directory.path(), "hello.txt")
            .await
            .expect("inspect oversized conflict result");
        assert_eq!(details.result.kind, ConflictContentKind::TooLarge);
        assert!(details.result.text.is_none());
        assert_eq!(
            details.expected_state.result.size,
            Some(oversized.len() as u64)
        );
        assert_eq!(
            details
                .expected_state
                .result
                .sha256
                .as_deref()
                .map(str::len),
            Some(64)
        );
    }

    #[tokio::test]
    async fn saves_and_stages_edited_conflict_result() {
        let (directory, backend) = conflicted_repository().await;
        let expected = conflict_expected(&backend, directory.path(), "hello.txt").await;
        let result = backend
            .save_conflict_result(
                directory.path(),
                "hello.txt",
                "reviewed combined result\n",
                ConflictLineEndingPolicy::Preserve,
                &expected,
            )
            .await
            .expect("save edited conflict result");

        assert!(result.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(directory.path().join("hello.txt"))
                .expect("read edited working result")
                .replace("\r\n", "\n"),
            "reviewed combined result\n"
        );
        assert_eq!(
            git_stdout(directory.path(), &["show", ":hello.txt"]),
            "reviewed combined result"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn atomic_edited_save_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let (directory, backend) = conflicted_repository().await;
        let target = directory.path().join("hello.txt");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755))
            .expect("make conflict result executable");
        let details = backend
            .conflict_details(directory.path(), "hello.txt")
            .await
            .expect("read executable conflict result");

        backend
            .save_conflict_result(
                directory.path(),
                "hello.txt",
                "resolved executable\n",
                ConflictLineEndingPolicy::Preserve,
                &details.expected_state,
            )
            .await
            .expect("atomically save executable conflict result");
        assert_eq!(
            fs::metadata(target)
                .expect("read saved permissions")
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn edited_save_rejects_mode_changes_after_editor_snapshot() {
        use std::os::unix::fs::PermissionsExt;

        let (directory, backend) = conflicted_repository().await;
        let target = directory.path().join("hello.txt");
        let details = backend
            .conflict_details(directory.path(), "hello.txt")
            .await
            .expect("read conflict before external chmod");
        let original_mode = fs::metadata(&target)
            .expect("read original conflict permissions")
            .permissions()
            .mode()
            & 0o7777;
        let changed_mode = if original_mode & 0o100 == 0 {
            original_mode | 0o100
        } else {
            original_mode & !0o100
        };
        fs::set_permissions(&target, fs::Permissions::from_mode(changed_mode))
            .expect("change executable bit outside the editor");

        let error = backend
            .save_conflict_result(
                directory.path(),
                "hello.txt",
                "must not overwrite chmod\n",
                ConflictLineEndingPolicy::Preserve,
                &details.expected_state,
            )
            .await
            .expect_err("external chmod must make the editor snapshot stale");
        assert_eq!(error.code, ErrorCode::StaleSnapshot);
        assert_eq!(
            fs::metadata(&target)
                .expect("read unchanged external permissions")
                .permissions()
                .mode()
                & 0o7777,
            changed_mode
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn new_edited_result_creation_respects_process_umask() {
        use std::os::unix::fs::PermissionsExt;

        let (directory, backend) = conflicted_repository().await;
        let mut probe_builder = tempfile::Builder::new();
        probe_builder.permissions(fs::Permissions::from_mode(0o777));
        let probe = probe_builder
            .tempfile_in(directory.path())
            .expect("create umask permission probe");
        let permissions_allowed_by_umask = probe
            .as_file()
            .metadata()
            .expect("read umask permission probe")
            .permissions()
            .mode()
            & 0o777;

        let target = directory.path().join("hello.txt");
        fs::remove_file(&target).expect("remove worktree conflict result");
        let details = backend
            .conflict_details(directory.path(), "hello.txt")
            .await
            .expect("read missing conflict result");
        assert_eq!(
            details.expected_state.result.kind,
            ConflictWorktreeKind::Missing
        );
        let desired_mode = details
            .ours
            .as_ref()
            .or(details.theirs.as_ref())
            .or(details.base.as_ref())
            .expect("regular conflict stage")
            .mode
            .as_str();
        let requested_permissions = if desired_mode == "100755" {
            0o777
        } else {
            0o666
        };

        backend
            .save_conflict_result(
                directory.path(),
                "hello.txt",
                "recreated result\n",
                ConflictLineEndingPolicy::Preserve,
                &details.expected_state,
            )
            .await
            .expect("save recreated conflict result");
        assert_eq!(
            fs::metadata(target)
                .expect("read recreated result permissions")
                .permissions()
                .mode()
                & 0o777,
            requested_permissions & permissions_allowed_by_umask
        );
    }

    #[tokio::test]
    async fn crlf_result_survives_textarea_lf_normalization() {
        let (directory, backend) = conflicted_repository().await;
        git(directory.path(), &["config", "core.autocrlf", "true"]);
        fs::write(
            directory.path().join("hello.txt"),
            b"first line\r\nsecond line\r\n",
        )
        .expect("write CRLF conflict result");
        let details = backend
            .conflict_details(directory.path(), "hello.txt")
            .await
            .expect("read CRLF conflict result");
        assert_eq!(details.result.line_ending, Some(ConflictLineEnding::CrLf));

        backend
            .save_conflict_result(
                directory.path(),
                "hello.txt",
                "first line\nsecond line\n",
                ConflictLineEndingPolicy::Preserve,
                &details.expected_state,
            )
            .await
            .expect("save browser-normalized CRLF result");
        assert_eq!(
            fs::read(directory.path().join("hello.txt")).expect("read CRLF roundtrip"),
            b"first line\r\nsecond line\r\n"
        );
        let staged = Command::new("git")
            .arg("-C")
            .arg(directory.path())
            .args(["show", ":hello.txt"])
            .output()
            .expect("read staged CRLF result");
        assert!(staged.status.success());
        assert_eq!(
            staged.stdout, b"first line\nsecond line\n",
            "Git clean conversion may normalize CRLF in the index; working file must stay CRLF"
        );
    }

    #[tokio::test]
    async fn unstaged_external_edit_makes_all_overwriting_resolutions_stale() {
        let (directory, backend) = conflicted_repository().await;
        let details = backend
            .conflict_details(directory.path(), "hello.txt")
            .await
            .expect("open conflict editor");
        fs::write(
            directory.path().join("hello.txt"),
            "external unstaged resolution\n",
        )
        .expect("external worktree edit");

        for resolution in [
            ConflictResolution::Ours,
            ConflictResolution::Theirs,
            ConflictResolution::MarkResolved,
            ConflictResolution::Delete,
        ] {
            let error = backend
                .resolve_conflict(
                    directory.path(),
                    "hello.txt",
                    resolution,
                    &details.expected_state,
                )
                .await
                .expect_err("stale resolution must fail");
            assert_eq!(error.code, ErrorCode::StaleSnapshot);
            assert_eq!(
                fs::read_to_string(directory.path().join("hello.txt"))
                    .expect("external edit remains intact"),
                "external unstaged resolution\n"
            );
        }
    }

    #[tokio::test]
    async fn stale_conflict_editor_state_cannot_overwrite_external_resolution() {
        let (directory, backend) = conflicted_repository().await;
        let expected = conflict_expected(&backend, directory.path(), "hello.txt").await;
        git(directory.path(), &["checkout", "--ours", "--", "hello.txt"]);
        git(directory.path(), &["add", "--", "hello.txt"]);

        let error = backend
            .save_conflict_result(
                directory.path(),
                "hello.txt",
                "stale overwrite\n",
                ConflictLineEndingPolicy::Preserve,
                &expected,
            )
            .await
            .expect_err("stale editor save must fail");
        assert_eq!(error.code, ErrorCode::StaleSnapshot);
        assert_eq!(
            fs::read_to_string(directory.path().join("hello.txt"))
                .expect("read externally resolved file")
                .replace("\r\n", "\n"),
            "main version\n"
        );
    }

    #[tokio::test]
    async fn explicit_delete_resolves_modify_delete_in_both_directions() {
        let (ours_directory, ours_backend) = modify_delete_conflicted_repository().await;
        let ours_details = ours_backend
            .conflict_details(ours_directory.path(), "hello.txt")
            .await
            .expect("read modified-by-ours conflict");
        assert!(ours_details.ours.is_some());
        assert!(ours_details.theirs.is_none());
        let ours_result = ours_backend
            .resolve_conflict(
                ours_directory.path(),
                "hello.txt",
                ConflictResolution::Delete,
                &ours_details.expected_state,
            )
            .await
            .expect("choose deletion when theirs deleted");
        assert!(ours_result.conflicts.is_empty());
        assert!(!ours_directory.path().join("hello.txt").exists());

        let (theirs_directory, theirs_backend) = delete_modify_conflicted_repository().await;
        let theirs_details = theirs_backend
            .conflict_details(theirs_directory.path(), "hello.txt")
            .await
            .expect("read modified-by-theirs conflict");
        assert!(theirs_details.ours.is_none());
        assert!(theirs_details.theirs.is_some());
        let theirs_result = theirs_backend
            .resolve_conflict(
                theirs_directory.path(),
                "hello.txt",
                ConflictResolution::Delete,
                &theirs_details.expected_state,
            )
            .await
            .expect("choose deletion when ours deleted");
        assert!(theirs_result.conflicts.is_empty());
        assert!(!theirs_directory.path().join("hello.txt").exists());
    }

    #[test]
    fn conflict_content_classification_blocks_binary_and_oversized_text() {
        let binary = classify_conflict_content(vec![b'a', 0, b'b'], 3);
        assert_eq!(binary.kind, ConflictContentKind::Binary);
        assert!(binary.text.is_none());

        let too_large = classify_conflict_content(
            vec![b'a'; MAX_CONFLICT_TEXT_BYTES + 1],
            (MAX_CONFLICT_TEXT_BYTES + 1) as u64,
        );
        assert_eq!(too_large.kind, ConflictContentKind::TooLarge);
        assert!(too_large.text.is_none());

        let mixed = classify_conflict_content(b"one\r\ntwo\n".to_vec(), 9);
        assert_eq!(mixed.line_ending, Some(ConflictLineEnding::Mixed));
        assert_eq!(
            encode_edited_conflict_text("one\ntwo\n", ConflictLineEndingPolicy::Preserve, &mixed,)
                .expect("logical no-op preserves exact mixed endings"),
            b"one\r\ntwo\n"
        );
        assert_eq!(
            encode_edited_conflict_text(
                "one\nchanged\n",
                ConflictLineEndingPolicy::Preserve,
                &mixed,
            )
            .expect_err("mixed edit needs explicit policy")
            .code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            encode_edited_conflict_text("one\nchanged\n", ConflictLineEndingPolicy::Lf, &mixed,)
                .expect("normalize mixed to LF"),
            b"one\nchanged\n"
        );
        assert_eq!(
            encode_edited_conflict_text("one\nchanged\n", ConflictLineEndingPolicy::CrLf, &mixed,)
                .expect("normalize mixed to CRLF"),
            b"one\r\nchanged\r\n"
        );
    }

    #[tokio::test]
    async fn resolves_both_modified_conflict_with_selected_index_side() {
        let (current_directory, current_backend) = conflicted_repository().await;
        let current_expected =
            conflict_expected(&current_backend, current_directory.path(), "hello.txt").await;
        let current_result = current_backend
            .resolve_conflict(
                current_directory.path(),
                "hello.txt",
                ConflictResolution::Ours,
                &current_expected,
            )
            .await
            .expect("resolve with current side");
        assert!(current_result.conflicts.is_empty());
        assert!(
            current_result.needs_user_action,
            "merge still needs completion"
        );
        assert_eq!(
            fs::read_to_string(current_directory.path().join("hello.txt"))
                .expect("read current resolution")
                .replace("\r\n", "\n"),
            "main version\n"
        );
        assert_eq!(
            git_stdout(current_directory.path(), &["show", ":hello.txt"]),
            "main version"
        );
        current_backend
            .abort_operation(current_directory.path(), ContinueOperation::Merge)
            .await
            .expect("abort current-side fixture merge");

        let (incoming_directory, incoming_backend) = conflicted_repository().await;
        let incoming_expected =
            conflict_expected(&incoming_backend, incoming_directory.path(), "hello.txt").await;
        let incoming_result = incoming_backend
            .resolve_conflict(
                incoming_directory.path(),
                "hello.txt",
                ConflictResolution::Theirs,
                &incoming_expected,
            )
            .await
            .expect("resolve with incoming side");
        assert!(incoming_result.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(incoming_directory.path().join("hello.txt"))
                .expect("read incoming resolution")
                .replace("\r\n", "\n"),
            "branch version\n"
        );
        assert_eq!(
            git_stdout(incoming_directory.path(), &["show", ":hello.txt"]),
            "branch version"
        );
        incoming_backend
            .abort_operation(incoming_directory.path(), ContinueOperation::Merge)
            .await
            .expect("abort incoming-side fixture merge");
    }

    #[tokio::test]
    async fn mark_resolved_stages_exact_current_worktree_content() {
        let (directory, backend) = conflicted_repository().await;
        fs::write(directory.path().join("hello.txt"), "manual resolution\n")
            .expect("write manual resolution");
        let expected = conflict_expected(&backend, directory.path(), "hello.txt").await;

        let result = backend
            .resolve_conflict(
                directory.path(),
                "hello.txt",
                ConflictResolution::MarkResolved,
                &expected,
            )
            .await
            .expect("mark manual resolution resolved");

        assert!(result.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(directory.path().join("hello.txt")).expect("read manual resolution"),
            "manual resolution\n"
        );
        assert_eq!(
            git_stdout(directory.path(), &["show", ":hello.txt"]),
            "manual resolution"
        );
        backend
            .abort_operation(directory.path(), ContinueOperation::Merge)
            .await
            .expect("abort manual fixture merge");
    }

    #[tokio::test]
    async fn conflict_resolution_rejects_clean_path_and_absent_index_side() {
        let (clean_directory, clean_backend, _) = committed_repository().await;
        let empty_expected = ConflictExpectedState {
            base: None,
            ours: None,
            theirs: None,
            result: missing_worktree_identity(),
        };
        let clean_error = clean_backend
            .resolve_conflict(
                clean_directory.path(),
                "hello.txt",
                ConflictResolution::Ours,
                &empty_expected,
            )
            .await
            .expect_err("clean path must not resolve as conflict");
        assert_eq!(clean_error.code, ErrorCode::InvalidRequest);

        let (directory, backend) = modify_delete_conflicted_repository().await;
        let expected = conflict_expected(&backend, directory.path(), "hello.txt").await;
        let error = backend
            .resolve_conflict(
                directory.path(),
                "hello.txt",
                ConflictResolution::Theirs,
                &expected,
            )
            .await
            .expect_err("missing incoming side must not imply deletion");
        assert_eq!(error.code, ErrorCode::UnsupportedOperation);
        assert!(error.message.contains("theirs side"));
        assert!(
            error
                .details
                .as_deref()
                .is_some_and(|details| details.contains("explicit delete"))
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("hello.txt"))
                .expect("missing-side resolution leaves file untouched"),
            "main version\n"
        );
        assert!(
            backend
                .snapshot(directory.path())
                .await
                .expect("read unresolved modify/delete snapshot")
                .status
                .entries
                .iter()
                .any(|entry| entry.path == "hello.txt" && entry.conflicted)
        );
        backend
            .abort_operation(directory.path(), ContinueOperation::Merge)
            .await
            .expect("abort modify/delete fixture merge");
    }

    #[tokio::test]
    async fn auto_resolve_reuses_only_recorded_rerere_resolution_and_stages_it() {
        let (directory, backend) = conflicted_repository().await;
        git(directory.path(), &["-c", "rerere.enabled=true", "rerere"]);
        fs::write(
            directory.path().join("hello.txt"),
            "remembered resolution\n",
        )
        .expect("write remembered resolution");
        git(directory.path(), &["add", "--", "hello.txt"]);
        git(directory.path(), &["-c", "rerere.enabled=true", "rerere"]);
        backend
            .abort_operation(directory.path(), ContinueOperation::Merge)
            .await
            .expect("abort trained rerere merge");
        git(
            directory.path(),
            &["config", "--local", "rerere.enabled", "false"],
        );

        let second_conflict = backend
            .merge_branch(directory.path(), "conflicting")
            .await
            .expect("recreate recorded conflict");
        assert_eq!(second_conflict.conflicts.len(), 1);
        assert!(
            fs::read_to_string(directory.path().join("hello.txt"))
                .expect("read unresolved second conflict")
                .contains("<<<<<<<")
        );

        let resolved = backend
            .auto_resolve_conflicts(directory.path())
            .await
            .expect("reuse recorded rerere resolution");
        assert!(resolved.conflicts.is_empty());
        assert!(resolved.needs_user_action, "merge still needs completion");
        assert_eq!(
            fs::read_to_string(directory.path().join("hello.txt")).expect("read reused resolution"),
            "remembered resolution\n"
        );
        assert_eq!(
            git_stdout(directory.path(), &["show", ":hello.txt"]),
            "remembered resolution"
        );
        backend
            .abort_operation(directory.path(), ContinueOperation::Merge)
            .await
            .expect("abort rerere fixture merge");
    }

    #[tokio::test]
    async fn merge_conflict_is_a_successful_transition_requiring_user_action() {
        let (directory, backend) = conflicted_repository().await;
        let snapshot = backend
            .snapshot(directory.path())
            .await
            .expect("conflict snapshot");
        assert_eq!(snapshot.operation_state, RepositoryOperationState::Merge);

        backend
            .abort_operation(directory.path(), ContinueOperation::Merge)
            .await
            .expect("abort merge");
    }
}
