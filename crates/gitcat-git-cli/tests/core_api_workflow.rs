use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};

use gitcat_contracts::{
    ChangeKind, CommitOptions, CommitSearchQuery, DiffRequest, DiffTarget, ExpectedState,
    HeadState, HistoryQuery, HistoryScope, RepositoryId, RepositorySnapshot,
};
use gitcat_core::CoreApi;
use gitcat_git_cli::GitCliBackend;
use tempfile::{TempDir, tempdir};

struct TestRepository {
    _directory: TempDir,
    path: PathBuf,
    api: CoreApi,
    id: RepositoryId,
}

async fn initialized_repository() -> TestRepository {
    let directory = tempdir().expect("create temporary test directory");
    let path = directory.path().join("repository with spaces");
    let api = CoreApi::new(Arc::new(GitCliBackend::default()));

    let version = api.probe().await.expect("probe system Git");
    assert!(version.major >= 2);

    let (initial_id, initialized) = api
        .init_repository(&path, "main")
        .await
        .expect("initialize repository through CoreApi");
    assert!(Path::new(&initialized.root).is_absolute());

    configure_local_repository(&path, "user.name", "GitCat Integration Tests");
    configure_local_repository(&path, "user.email", "gitcat-tests@example.invalid");
    configure_local_repository(&path, "commit.gpgSign", "false");
    configure_local_repository(&path, "core.autocrlf", "false");

    api.close_repository(&initial_id)
        .await
        .expect("close initialized repository");
    let (id, reopened) = api
        .open_repository(&path)
        .await
        .expect("reopen repository through CoreApi");
    assert_eq!(reopened.name, "repository with spaces");

    TestRepository {
        _directory: directory,
        path,
        api,
        id,
    }
}

fn configure_local_repository(repository: &Path, key: &str, value: &str) {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(["config", "--local", key, value])
        .output()
        .expect("run local git config subprocess");

    assert!(
        output.status.success(),
        "git config {key} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn commit_file(
    repository: &TestRepository,
    relative_path: &str,
    contents: &str,
    message: &str,
) -> String {
    let file_path = repository.path.join(relative_path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).expect("create committed file parent");
    }
    fs::write(&file_path, contents).expect("write committed file");

    repository
        .api
        .stage_paths(&repository.id, &[relative_path.to_owned()])
        .await
        .expect("stage file through CoreApi");
    repository
        .api
        .create_commit(
            &repository.id,
            &CommitOptions {
                message: message.to_owned(),
                amend: false,
                signoff: false,
            },
        )
        .await
        .expect("commit staged file through CoreApi")
        .after_oid
        .expect("commit returns new HEAD")
}

fn expected_state(snapshot: &RepositorySnapshot) -> ExpectedState {
    let head_oid = match &snapshot.head {
        HeadState::Branch { oid, .. } | HeadState::Detached { oid } => Some(oid.clone()),
        HeadState::Unborn { .. } => None,
    };
    ExpectedState {
        head_oid,
        generation: snapshot.generation.clone(),
    }
}

#[tokio::test]
async fn commit_is_searchable_and_readable_through_public_core_api() {
    let repository = initialized_repository().await;
    let oid = commit_file(
        &repository,
        "src/notes.txt",
        "alpha\nbeta\n",
        "feat: searchable subject\n\nBody marker: body-only-needle.\n",
    )
    .await;

    let subject_search = repository
        .api
        .search_commits(
            &repository.id,
            &CommitSearchQuery {
                query: "searchable subject".into(),
                scope: HistoryScope::CurrentBranch,
                limit: 10,
            },
        )
        .await
        .expect("search commit subject");
    assert_eq!(subject_search.total, 1);
    assert_eq!(subject_search.hits[0].oid, oid);
    assert!(subject_search.hits[0].matched_subject);

    let body_search = repository
        .api
        .search_commits(
            &repository.id,
            &CommitSearchQuery {
                query: "body-only-needle".into(),
                scope: HistoryScope::CurrentBranch,
                limit: 10,
            },
        )
        .await
        .expect("search commit body");
    assert_eq!(body_search.total, 1);
    assert_eq!(body_search.hits[0].oid, oid);
    assert!(body_search.hits[0].matched_body);

    let history = repository
        .api
        .history(
            &repository.id,
            &HistoryQuery {
                scope: HistoryScope::CurrentBranch,
                cursor: None,
                limit: 20,
            },
        )
        .await
        .expect("read commit history");
    assert_eq!(history.commits.len(), 1);
    assert_eq!(history.commits[0].oid, oid);
    assert_eq!(history.commits[0].subject, "feat: searchable subject");
    assert_eq!(history.commits[0].graph.lane, 0);

    let details = repository
        .api
        .commit_details(&repository.id, &oid, 0)
        .await
        .expect("read commit details");
    assert_eq!(details.subject, "feat: searchable subject");
    assert_eq!(details.body, "Body marker: body-only-needle.");
    assert_eq!(details.files.len(), 1);
    assert_eq!(details.files[0].new_path, "src/notes.txt");
    assert_eq!(details.files[0].status, ChangeKind::Added);
    assert_eq!(details.stats.additions, 2);

    let diff = repository
        .api
        .diff(
            &repository.id,
            &DiffRequest {
                target: DiffTarget::Commit {
                    oid: oid.clone(),
                    parent_index: 0,
                },
                path: "src/notes.txt".into(),
                context_lines: 3,
                ignore_whitespace: false,
                max_bytes: 1024 * 1024,
            },
        )
        .await
        .expect("read committed file diff");
    assert_eq!(diff.status, ChangeKind::Added);
    assert_eq!(diff.stats.additions, 2);
    assert!(
        diff.hunks
            .iter()
            .flat_map(|hunk| &hunk.lines)
            .any(|line| line.content == "alpha")
    );

    let snapshot = repository
        .api
        .snapshot(&repository.id)
        .await
        .expect("read clean repository snapshot");
    assert!(snapshot.status.clean);
}

#[tokio::test]
async fn branch_lifecycle_uses_public_core_api_and_expected_state() {
    let repository = initialized_repository().await;
    let oid = commit_file(
        &repository,
        "seed.txt",
        "seed\n",
        "chore: seed repository\n",
    )
    .await;

    repository
        .api
        .create_branch(&repository.id, "feature/workflow", &oid, true)
        .await
        .expect("create and checkout branch");
    let feature_snapshot = repository
        .api
        .snapshot(&repository.id)
        .await
        .expect("read feature branch snapshot");
    assert!(matches!(
        feature_snapshot.head,
        HeadState::Branch { ref name, .. } if name == "feature/workflow"
    ));

    repository
        .api
        .rename_branch(&repository.id, "feature/workflow", "feature/renamed")
        .await
        .expect("rename current branch");
    repository
        .api
        .checkout_branch(&repository.id, "main")
        .await
        .expect("checkout main branch");

    let before_delete = repository
        .api
        .snapshot(&repository.id)
        .await
        .expect("prepare branch deletion");
    assert!(
        before_delete
            .local_branches
            .iter()
            .any(|branch| branch.name == "feature/renamed")
    );
    let expected = expected_state(&before_delete);
    repository
        .api
        .delete_branch(&repository.id, "feature/renamed", false, false, &expected)
        .await
        .expect("delete fully merged branch");

    let after_delete = repository
        .api
        .snapshot(&repository.id)
        .await
        .expect("read branches after deletion");
    assert!(matches!(
        after_delete.head,
        HeadState::Branch { ref name, .. } if name == "main"
    ));
    assert!(
        after_delete
            .local_branches
            .iter()
            .all(|branch| branch.name != "feature/renamed")
    );
}
