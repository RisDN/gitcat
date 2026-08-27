//! Pull requests and check state, with the short-lived cache that keeps a
//! sidebar redraw from turning into a request.
//!
//! Both lookups are read-only decorations: when the service cannot answer, the
//! branch rows simply stay undecorated, so nothing here retries or escalates.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use gitcat_contracts::{
    ApiError, ApiResult, CheckState, CheckSummary, ErrorCode, ForgeKind, ForgeRepo, PullRequestInfo,
};

use crate::github::GitHubClient;
use crate::token::TokenStore;

/// Long enough that opening a repository, redrawing and switching tabs costs
/// one request; short enough that a freshly opened pull request shows up
/// without restarting the application.
const PULLS_TTL: Duration = Duration::from_secs(60);
/// Check state moves faster than the pull request around it does.
const CHECKS_TTL: Duration = Duration::from_secs(30);
/// Two requests per commit, so a caller cannot turn a history page into a
/// hundred round trips.
const MAX_CHECK_COMMITS: usize = 12;
/// Bounded so a long session cannot grow the cache without limit.
const MAX_CACHED_CHECKS: usize = 256;

struct Cached<T> {
    stored: Instant,
    value: T,
}

pub struct ForgeService {
    http: reqwest::Client,
    tokens: Arc<TokenStore>,
    pulls: Mutex<HashMap<String, Cached<Vec<PullRequestInfo>>>>,
    checks: Mutex<HashMap<String, Cached<CheckSummary>>>,
}

impl ForgeService {
    pub fn new(tokens: Arc<TokenStore>) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("GitCat/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        Self {
            http,
            tokens,
            pulls: Mutex::new(HashMap::new()),
            checks: Mutex::new(HashMap::new()),
        }
    }

    /// The pull requests open against `repo`.
    ///
    /// A hosting service without a client answers with nothing rather than an
    /// error: the caller asked whether there is anything to show, and for a
    /// GitLab remote the honest answer is "not from here".
    pub async fn pull_requests(
        &self,
        repo: &ForgeRepo,
        refresh: bool,
    ) -> ApiResult<Vec<PullRequestInfo>> {
        let Some(client) = self.client(repo) else {
            return Ok(Vec::new());
        };
        let key = repo_key(repo);
        if !refresh {
            if let Some(cached) = read_cache(&self.pulls, &key, PULLS_TTL) {
                return Ok(cached);
            }
        }

        let pulls = client.pull_requests(&repo.owner, &repo.repo).await?;
        write_cache(&self.pulls, key, pulls.clone(), usize::MAX);
        Ok(pulls)
    }

    /// Rolled-up check state for the given commits. The list is capped, so
    /// pass the tips that are actually painted rather than a history page.
    ///
    /// A commit the service has never seen is reported as having no checks
    /// rather than as a failure -- that is the normal state of a local commit
    /// which has not been pushed yet.
    pub async fn checks(
        &self,
        repo: &ForgeRepo,
        oids: &[String],
        refresh: bool,
    ) -> ApiResult<Vec<CheckSummary>> {
        let Some(client) = self.client(repo) else {
            return Ok(Vec::new());
        };

        let mut summaries = Vec::new();
        let mut failure: Option<ApiError> = None;
        let repo_key = repo_key(repo);

        for oid in oids.iter().take(MAX_CHECK_COMMITS) {
            let key = format!("{repo_key}@{oid}");
            if !refresh {
                if let Some(cached) = read_cache(&self.checks, &key, CHECKS_TTL) {
                    summaries.push(cached);
                    continue;
                }
            }

            let summary = match client.commit_checks(&repo.owner, &repo.repo, oid).await {
                Ok(summary) => summary,
                Err(error) if error.code == ErrorCode::InvalidRequest => CheckSummary {
                    oid: oid.clone(),
                    state: CheckState::None,
                    total: 0,
                    failed: 0,
                    pending: 0,
                },
                Err(error) => {
                    failure = Some(error);
                    continue;
                }
            };
            write_cache(&self.checks, key, summary.clone(), MAX_CACHED_CHECKS);
            summaries.push(summary);
        }

        // Something answered, so the batch is worth showing. Only a batch that
        // resolved nothing at all reports the reason it failed.
        if summaries.is_empty() {
            if let Some(error) = failure {
                return Err(error);
            }
        }
        Ok(summaries)
    }

    /// Drops everything cached for one repository, so the next lookup asks the
    /// service again.
    pub fn forget(&self, repo: &ForgeRepo) {
        let prefix = repo_key(repo);
        if let Ok(mut pulls) = self.pulls.lock() {
            pulls.remove(&prefix);
        }
        if let Ok(mut checks) = self.checks.lock() {
            checks.retain(|key, _| !key.starts_with(&prefix));
        }
    }

    fn client(&self, repo: &ForgeRepo) -> Option<GitHubClient> {
        if repo.forge != ForgeKind::GitHub || repo.owner.is_empty() || repo.repo.is_empty() {
            return None;
        }
        Some(GitHubClient::new(
            self.http.clone(),
            &repo.host,
            self.tokens.get(&repo.host),
        ))
    }
}

fn repo_key(repo: &ForgeRepo) -> String {
    format!(
        "{}/{}/{}",
        repo.host.to_ascii_lowercase(),
        repo.owner,
        repo.repo
    )
}

fn read_cache<T: Clone>(
    cache: &Mutex<HashMap<String, Cached<T>>>,
    key: &str,
    ttl: Duration,
) -> Option<T> {
    let guard = cache.lock().ok()?;
    let entry = guard.get(key)?;
    (entry.stored.elapsed() < ttl).then(|| entry.value.clone())
}

/// Stores one entry, dropping everything stale first. `capacity` is the point
/// at which even fresh entries are cleared out: the cache is an optimisation,
/// so losing it costs a request and nothing else.
fn write_cache<T>(
    cache: &Mutex<HashMap<String, Cached<T>>>,
    key: String,
    value: T,
    capacity: usize,
) {
    let Ok(mut guard) = cache.lock() else {
        return;
    };
    guard.retain(|_, entry| entry.stored.elapsed() < PULLS_TTL.max(CHECKS_TTL));
    if guard.len() >= capacity {
        guard.clear();
    }
    guard.insert(
        key,
        Cached {
            stored: Instant::now(),
            value,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::token::SecretStore;

    /// The credential store is irrelevant here: these tests never reach a
    /// network, and a real keyring would prompt on some platforms.
    struct NoSecrets;

    impl SecretStore for NoSecrets {
        fn get(&self, _host: &str) -> ApiResult<Option<String>> {
            Ok(None)
        }

        fn set(&self, _host: &str, _token: &str) -> ApiResult<()> {
            Ok(())
        }

        fn delete(&self, _host: &str) -> ApiResult<()> {
            Ok(())
        }
    }

    fn service() -> ForgeService {
        let dir = tempfile::tempdir().expect("temp dir");
        ForgeService::new(Arc::new(TokenStore::with_secrets(
            dir.path(),
            Box::new(NoSecrets),
        )))
    }

    fn repo(forge: ForgeKind) -> ForgeRepo {
        ForgeRepo {
            host: "github.com".into(),
            owner: "ikoli".into(),
            repo: "gitcat".into(),
            forge,
        }
    }

    fn summary(oid: &str) -> CheckSummary {
        CheckSummary {
            oid: oid.to_owned(),
            state: CheckState::Success,
            total: 1,
            failed: 0,
            pending: 0,
        }
    }

    #[tokio::test]
    async fn a_forge_without_a_client_answers_with_nothing() {
        let service = service();
        assert!(
            service
                .pull_requests(&repo(ForgeKind::GitLab), false)
                .await
                .expect("no error")
                .is_empty()
        );
        assert!(
            service
                .checks(&repo(ForgeKind::GitLab), &["abc".to_owned()], false)
                .await
                .expect("no error")
                .is_empty()
        );
    }

    #[test]
    fn a_repository_without_a_path_has_no_client() {
        let service = service();
        let mut incomplete = repo(ForgeKind::GitHub);
        incomplete.owner = String::new();
        assert!(service.client(&incomplete).is_none());
        assert!(service.client(&repo(ForgeKind::GitHub)).is_some());
    }

    #[test]
    fn a_cached_entry_expires_with_its_own_ttl() {
        let cache: Mutex<HashMap<String, Cached<u8>>> = Mutex::new(HashMap::new());
        write_cache(&cache, "key".into(), 7, MAX_CACHED_CHECKS);

        assert_eq!(read_cache(&cache, "key", Duration::from_secs(60)), Some(7));
        assert_eq!(read_cache(&cache, "key", Duration::ZERO), None);
        assert_eq!(read_cache(&cache, "missing", Duration::from_secs(60)), None);
    }

    #[test]
    fn a_full_cache_is_cleared_rather_than_grown() {
        let cache: Mutex<HashMap<String, Cached<u8>>> = Mutex::new(HashMap::new());
        for index in 0..4u8 {
            write_cache(&cache, format!("key{index}"), index, 3);
        }

        let guard = cache.lock().expect("lock");
        assert!(guard.len() <= 3);
        assert!(guard.contains_key("key3"), "the newest entry survives");
    }

    #[test]
    fn forgetting_a_repository_leaves_another_repository_alone() {
        let service = service();
        write_cache(
            &service.checks,
            "github.com/ikoli/gitcat@abc".into(),
            summary("abc"),
            MAX_CACHED_CHECKS,
        );
        write_cache(
            &service.checks,
            "github.com/other/repo@abc".into(),
            summary("abc"),
            MAX_CACHED_CHECKS,
        );

        service.forget(&repo(ForgeKind::GitHub));

        let guard = service.checks.lock().expect("lock");
        assert!(!guard.contains_key("github.com/ikoli/gitcat@abc"));
        assert!(guard.contains_key("github.com/other/repo@abc"));
    }
}
