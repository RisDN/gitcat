//! Minimal GitHub REST client, scoped to what avatar resolution needs.
//!
//! The commit list is the endpoint that matters: it answers with one hundred
//! commits per request, and each entry pairs the raw commit email with the
//! account GitHub matched it to. That mapping is the part no local heuristic
//! can reproduce -- an author who commits under a private address still
//! resolves, because GitHub holds the address-to-account link itself.

use gitcat_contracts::{ApiError, ApiResult, ErrorCode};
use serde::Deserialize;

/// One request covers a whole history page and then some.
const COMMITS_PER_REQUEST: u16 = 100;
const API_VERSION: &str = "2022-11-28";

pub struct GitHubClient {
    http: reqwest::Client,
    api_base: String,
    token: Option<String>,
}

/// A commit email and the account GitHub matched it to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitAuthor {
    pub email: String,
    /// `None` when the service matched no account to this address, which is a
    /// fact worth caching in its own right.
    pub avatar_url: Option<String>,
}

impl GitHubClient {
    /// `host` selects the endpoint: github.com talks to the public API, any
    /// other host is treated as a GitHub Enterprise install, which serves the
    /// same routes under `/api/v3`.
    pub fn new(http: reqwest::Client, host: &str, token: Option<String>) -> Self {
        let host = host.to_ascii_lowercase();
        let api_base = if host == "github.com" || host == "www.github.com" {
            "https://api.github.com".to_owned()
        } else {
            format!("https://{host}/api/v3")
        };
        Self {
            http,
            api_base,
            token,
        }
    }

    /// Lists commits reachable from `sha` (or the default branch), returning
    /// every author the response resolved to an account.
    pub async fn commit_authors(
        &self,
        owner: &str,
        repo: &str,
        sha: Option<&str>,
    ) -> ApiResult<Vec<CommitAuthor>> {
        let mut url = format!(
            "{}/repos/{}/{}/commits?per_page={COMMITS_PER_REQUEST}",
            self.api_base,
            encode(owner),
            encode(repo),
        );
        if let Some(sha) = sha {
            url.push_str(&format!("&sha={}", encode(sha)));
        }

        let mut request = self
            .http
            .get(&url)
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", API_VERSION);
        if let Some(token) = &self.token {
            request = request.header("authorization", format!("Bearer {token}"));
        }

        let response = request.send().await.map_err(network_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(status_error(status, rate_limited(&response)));
        }

        let commits: Vec<CommitListItem> = response.json().await.map_err(|error| {
            ApiError::new(
                ErrorCode::NetworkFailed,
                "the hosting service returned an unexpected response",
            )
            .with_details(error.to_string())
        })?;

        Ok(commits.into_iter().filter_map(commit_author).collect())
    }
}

fn commit_author(item: CommitListItem) -> Option<CommitAuthor> {
    let email = item.commit.author?.email?;
    if email.is_empty() {
        return None;
    }
    Some(CommitAuthor {
        email: email.to_ascii_lowercase(),
        avatar_url: item
            .author
            .and_then(|account| account.avatar_url)
            .filter(|url| !url.is_empty()),
    })
}

/// The commit list nests the recorded author under `commit` and the matched
/// account at the top level; the account is absent when GitHub knows no
/// matching user.
#[derive(Deserialize)]
struct CommitListItem {
    commit: CommitMeta,
    author: Option<Account>,
}

#[derive(Deserialize)]
struct CommitMeta {
    author: Option<AuthorMeta>,
}

#[derive(Deserialize)]
struct AuthorMeta {
    email: Option<String>,
}

#[derive(Deserialize)]
struct Account {
    avatar_url: Option<String>,
}

/// GitHub answers an exhausted rate limit with 403 or 429 and no remaining
/// quota, which is worth telling apart from a rejected credential.
fn rate_limited(response: &reqwest::Response) -> bool {
    response
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim() == "0")
}

fn status_error(status: reqwest::StatusCode, rate_limited: bool) -> ApiError {
    if rate_limited {
        return ApiError::new(
            ErrorCode::NetworkFailed,
            "the hosting service rate limit is exhausted; add a token to raise it",
        );
    }
    match status.as_u16() {
        401 | 403 => ApiError::new(
            ErrorCode::AuthenticationRequired,
            "the hosting service rejected the stored token",
        ),
        404 => ApiError::new(
            ErrorCode::InvalidRequest,
            "the hosting service does not expose this repository",
        ),
        _ => ApiError::new(
            ErrorCode::NetworkFailed,
            "the hosting service request failed",
        )
        .with_details(status.to_string()),
    }
}

fn network_error(error: reqwest::Error) -> ApiError {
    let code = if error.is_timeout() {
        ErrorCode::Timeout
    } else {
        ErrorCode::NetworkFailed
    };
    ApiError::new(code, "could not reach the hosting service").with_details(error.to_string())
}

/// Percent-encodes a single path or query segment. Owner, repository and
/// revision names are validated elsewhere, but they reach here as plain
/// strings and must not be able to open a new path.
fn encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(host: &str) -> GitHubClient {
        GitHubClient::new(reqwest::Client::new(), host, None)
    }

    #[test]
    fn public_github_and_enterprise_use_different_api_roots() {
        assert_eq!(client("github.com").api_base, "https://api.github.com");
        assert_eq!(client("GitHub.com").api_base, "https://api.github.com");
        assert_eq!(
            client("git.example.test").api_base,
            "https://git.example.test/api/v3"
        );
    }

    #[test]
    fn path_segments_cannot_open_a_new_path() {
        assert_eq!(encode("ikoli"), "ikoli");
        assert_eq!(encode("../../users"), "..%2F..%2Fusers");
        assert_eq!(encode("a b"), "a%20b");
    }

    #[test]
    fn an_unmatched_author_is_kept_so_the_miss_can_be_cached() {
        let payload = r#"[
            {"commit":{"author":{"email":"A@Example.test"}},"author":{"avatar_url":"https://host.test/a.png"}},
            {"commit":{"author":{"email":"b@example.test"}},"author":null},
            {"commit":{"author":null},"author":{"avatar_url":"https://host.test/c.png"}}
        ]"#;
        let items: Vec<CommitListItem> = serde_json::from_str(payload).unwrap();
        let authors: Vec<CommitAuthor> = items.into_iter().filter_map(commit_author).collect();

        assert_eq!(
            authors,
            vec![
                CommitAuthor {
                    email: "a@example.test".into(),
                    avatar_url: Some("https://host.test/a.png".into()),
                },
                // Seen by the service, matched to nobody.
                CommitAuthor {
                    email: "b@example.test".into(),
                    avatar_url: None,
                },
            ]
        );
    }
}
