use std::{
    collections::{HashMap, hash_map::DefaultHasher},
    ffi::OsString,
    hash::{Hash, Hasher},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use async_trait::async_trait;
use gitcat_contracts::*;
use gitcat_core::{GitBackend, layout_commits};
use tokio_util::sync::CancellationToken;

use crate::{
    parse::{
        DETAIL_FORMAT, LOG_FORMAT, ParsedStatus, REF_FORMAT, STASH_FORMAT, parse_changed_files,
        parse_commit_details, parse_file_diff, parse_git_version, parse_log, parse_refs,
        parse_search_hits, parse_stashes, parse_status,
    },
    runner::{GitCommandOutput, GitRunOptions, GitRunner, os_args, redact_sensitive},
};

const READ_OUTPUT_CAP: usize = 32 * 1024 * 1024;
const NETWORK_OUTPUT_CAP: usize = 4 * 1024 * 1024;
const MAX_HISTORY_PAGE: usize = 500;
const MAX_SEARCH_RESULTS: usize = 10_000;
const MAX_DIFF_BYTES: usize = 128 * 1024 * 1024;
const MAX_COMMIT_MESSAGE_BYTES: usize = 1024 * 1024;

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

    async fn operation_state(&self, path: &Path) -> ApiResult<RepositoryOperationState> {
        let info = self.inspect_repository(path).await?;
        let git_dir = PathBuf::from(info.git_dir);
        let state =
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
            };
        Ok(state)
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
        let (generation, refs_output, parsed_status) = self.generation_and_refs(path).await?;
        let refs = parse_refs(&refs_output)?;
        let mut local_branches = Vec::new();
        let mut remote_branches = Vec::new();
        let mut tags = Vec::new();
        for parsed_ref in refs {
            match parsed_ref.label.kind {
                RefKind::LocalBranch => {
                    if let Some(branch) = parsed_ref.branch {
                        local_branches.push(branch);
                    }
                }
                RefKind::RemoteBranch if !parsed_ref.symbolic => {
                    if let Some(branch) = parsed_ref.branch {
                        remote_branches.push(branch);
                    }
                }
                RefKind::Tag => tags.push(parsed_ref.label),
                RefKind::RemoteBranch => {}
            }
        }
        local_branches.sort_by(|left, right| left.name.cmp(&right.name));
        remote_branches.sort_by(|left, right| left.name.cmp(&right.name));
        tags.sort_by(|left, right| left.name.cmp(&right.name));

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

        let mut labels: HashMap<String, Vec<RefLabel>> = HashMap::new();
        for parsed_ref in parse_refs(&refs_output)? {
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
        layout_commits(&mut commits, &mut lanes);
        let next_cursor = has_more.then(|| HistoryCursor {
            generation: generation.clone(),
            offset: offset + commits.len(),
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
        self.resolve_commit(path, oid).await?;
        let snapshot = self.snapshot(path).await?;
        let operation_busy = snapshot.operation_state != RepositoryOperationState::Normal;
        let dirty = !snapshot.status.clean;
        let reset_unavailable = !matches!(snapshot.head, HeadState::Branch { .. });
        let action = |kind, requires_clean, requires_confirmation| {
            let disabled_reason = if operation_busy {
                Some("Finish or abort the current Git operation first".to_owned())
            } else if kind == CommitActionKind::Reset && reset_unavailable {
                Some("Check out a local branch before resetting".to_owned())
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
            action(CommitActionKind::Checkout, true, false),
            action(CommitActionKind::CreateBranch, false, false),
            action(CommitActionKind::CherryPick, true, false),
            action(CommitActionKind::Revert, true, false),
            action(CommitActionKind::Reset, false, true),
            action(CommitActionKind::CreateTag, false, false),
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
    async fn merge_conflict_is_a_successful_transition_requiring_user_action() {
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
        assert!(!result.conflicts.is_empty());
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
