//! Signing in to a hosting service with the OAuth device flow.
//!
//! The device flow is the one browser-less shape that suits a desktop
//! application: there is no redirect URI to listen on and no client secret to
//! ship, because the application is a public client. GitCat asks the service
//! for a short user code, the user types it into the service's own verification
//! page, and the token is collected by polling.
//!
//! A refresh works the same way: GitHub requires the client secret to renew a
//! token *unless* the token came from the device flow, which is why this is the
//! flow the application registers for.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use gitcat_contracts::{
    ApiError, ApiResult, DeviceAuthorization, ErrorCode, ForgeAccount, LoginPoll, LoginState,
};
use serde::Deserialize;

use crate::token::{OAuthCredential, StoredCredential, TokenStore};

/// GitCat's registered OAuth application. A client ID is public by design: the
/// device flow proves nothing with it, the user's own authorisation does.
pub const GITHUB_CLIENT_ID: &str = "Ov23liXsrhyLXSlqd0bE";

/// `repo` reaches private repositories and is what a clone or a push needs;
/// `read:org` lists the repositories an organisation shares with the user;
/// `read:user` names the account the sign-in belongs to.
pub const GITHUB_SCOPES: &str = "repo read:org read:user";

/// A token is renewed slightly before it expires, so a request already in
/// flight cannot land on the far side of the boundary.
const RENEW_MARGIN: Duration = Duration::from_secs(120);
/// The service asks for five seconds between polls; anything faster is
/// answered with `slow_down`.
const DEFAULT_POLL_INTERVAL: u32 = 5;

pub struct ForgeAuth {
    http: reqwest::Client,
    tokens: std::sync::Arc<TokenStore>,
    client_id: String,
    /// Sign-ins waiting for the user, keyed by host. The device code stays
    /// here rather than travelling to the webview: it is the half of the
    /// exchange that turns into a token.
    pending: Mutex<HashMap<String, PendingLogin>>,
}

struct PendingLogin {
    device_code: String,
    interval: u32,
}

impl ForgeAuth {
    pub fn new(tokens: std::sync::Arc<TokenStore>) -> Self {
        Self::with_client_id(tokens, GITHUB_CLIENT_ID)
    }

    pub fn with_client_id(tokens: std::sync::Arc<TokenStore>, client_id: &str) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("GitCat/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_default();
        Self {
            http,
            tokens,
            client_id: client_id.to_owned(),
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// Starts a sign-in and returns what the user has to do.
    pub async fn begin(&self, host: &str) -> ApiResult<DeviceAuthorization> {
        let host = normalize(host);
        let response: DeviceCodeResponse = self
            .post(
                &format!("https://{}/login/device/code", web_host(&host)),
                &[
                    ("client_id", self.client_id.as_str()),
                    ("scope", GITHUB_SCOPES),
                ],
            )
            .await?;

        let interval = response.interval.unwrap_or(DEFAULT_POLL_INTERVAL);
        let authorization = DeviceAuthorization {
            host: host.clone(),
            user_code: response.user_code,
            verification_uri: response.verification_uri,
            interval_seconds: interval,
            expires_in_seconds: response.expires_in.unwrap_or(900),
        };

        self.pending_map()?.insert(
            host,
            PendingLogin {
                device_code: response.device_code,
                interval,
            },
        );
        Ok(authorization)
    }

    /// Asks once whether the user has finished. The caller decides how often to
    /// come back; the service says how fast it will tolerate.
    ///
    /// A completed sign-in stores the credential and drops the pending code, so
    /// a second poll after success reports nothing rather than exchanging the
    /// same code twice.
    pub async fn poll(&self, host: &str) -> ApiResult<LoginPoll> {
        let host = normalize(host);
        let Some(device_code) = self
            .pending_map()?
            .get(&host)
            .map(|pending| pending.device_code.clone())
        else {
            return Ok(LoginPoll {
                state: LoginState::Expired,
                account: None,
            });
        };

        let response: TokenResponse = self
            .post(
                &token_url(&host),
                &[
                    ("client_id", self.client_id.as_str()),
                    ("device_code", device_code.as_str()),
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ],
            )
            .await?;

        match response.error.as_deref() {
            Some("authorization_pending") => {
                return Ok(LoginPoll {
                    state: LoginState::Pending,
                    account: None,
                });
            }
            // The service is telling us to back off; the interval it sends
            // replaces the one from the start of the flow.
            Some("slow_down") => {
                if let Some(interval) = response.interval {
                    if let Ok(mut pending) = self.pending.lock() {
                        if let Some(entry) = pending.get_mut(&host) {
                            entry.interval = interval;
                        }
                    }
                }
                return Ok(LoginPoll {
                    state: LoginState::Pending,
                    account: None,
                });
            }
            Some("expired_token") => {
                self.pending_map()?.remove(&host);
                return Ok(LoginPoll {
                    state: LoginState::Expired,
                    account: None,
                });
            }
            Some("access_denied") => {
                self.pending_map()?.remove(&host);
                return Ok(LoginPoll {
                    state: LoginState::Denied,
                    account: None,
                });
            }
            Some(other) => {
                self.pending_map()?.remove(&host);
                return Err(ApiError::new(
                    ErrorCode::AuthenticationRequired,
                    "the hosting service refused the sign-in",
                )
                .with_details(other.to_owned()));
            }
            None => {}
        }

        let Some(access_token) = response.access_token.filter(|token| !token.is_empty()) else {
            return Err(ApiError::new(
                ErrorCode::NetworkFailed,
                "the hosting service returned a sign-in without a token",
            ));
        };

        let mut credential = OAuthCredential {
            access_token,
            refresh_token: response.refresh_token.filter(|token| !token.is_empty()),
            expires_at: response.expires_in.map(expiry_from_now),
            account: None,
            scopes: response.scope.unwrap_or_default(),
        };

        // The account name is stored with the credential so the settings screen
        // can name it without a request on every open.
        let account = self
            .fetch_account(&host, &credential.access_token)
            .await
            .ok();
        credential.account = account.as_ref().map(|account| account.login.clone());

        self.tokens.set_oauth(&host, &credential)?;
        self.pending_map()?.remove(&host);
        Ok(LoginPoll {
            state: LoginState::Complete,
            account,
        })
    }

    /// How long the caller should wait before polling again.
    pub fn poll_interval(&self, host: &str) -> u32 {
        self.pending
            .lock()
            .ok()
            .and_then(|pending| pending.get(&normalize(host)).map(|entry| entry.interval))
            .unwrap_or(DEFAULT_POLL_INTERVAL)
    }

    /// Forgets the credential for one host, and any sign-in still in flight.
    pub fn sign_out(&self, host: &str) -> ApiResult<()> {
        let host = normalize(host);
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&host);
        }
        self.tokens.set(&host, None)
    }

    /// The bearer token to send for one host, renewed first when the stored one
    /// is spent.
    ///
    /// A renewal that fails leaves the stored credential alone and answers with
    /// what is there: a request that then comes back unauthorised tells the
    /// user to sign in again, which is clearer than silently having no token.
    pub async fn access_token(&self, host: &str) -> Option<String> {
        let host = normalize(host);
        let stored = self.tokens.stored(&host)?;
        let credential = match stored {
            StoredCredential::Token(token) => return Some(token),
            StoredCredential::OAuth(credential) => credential,
        };

        if !is_expiring(&credential) {
            return Some(credential.access_token);
        }
        let refresh_token = credential.refresh_token.clone()?;

        match self.renew(&host, &refresh_token, &credential).await {
            Ok(renewed) => Some(renewed),
            Err(_) => Some(credential.access_token),
        }
    }

    async fn renew(
        &self,
        host: &str,
        refresh_token: &str,
        previous: &OAuthCredential,
    ) -> ApiResult<String> {
        let response: TokenResponse = self
            .post(
                &token_url(host),
                &[
                    ("client_id", self.client_id.as_str()),
                    ("grant_type", "refresh_token"),
                    ("refresh_token", refresh_token),
                ],
            )
            .await?;

        let Some(access_token) = response.access_token.filter(|token| !token.is_empty()) else {
            return Err(ApiError::new(
                ErrorCode::AuthenticationRequired,
                "the hosting service would not renew the sign-in",
            ));
        };

        let credential = OAuthCredential {
            access_token: access_token.clone(),
            // A service that rotates refresh tokens sends a new one; one that
            // does not leaves the old one in place.
            refresh_token: response
                .refresh_token
                .filter(|token| !token.is_empty())
                .or_else(|| previous.refresh_token.clone()),
            expires_at: response.expires_in.map(expiry_from_now),
            account: previous.account.clone(),
            scopes: response.scope.clone().unwrap_or(previous.scopes.clone()),
        };
        self.tokens.set_oauth(host, &credential)?;
        Ok(access_token)
    }

    /// The account a stored credential belongs to, asked of the service rather
    /// than read back from storage.
    pub async fn account(&self, host: &str) -> ApiResult<Option<ForgeAccount>> {
        let host = normalize(host);
        let Some(token) = self.access_token(&host).await else {
            return Ok(None);
        };
        self.fetch_account(&host, &token).await.map(Some)
    }

    async fn fetch_account(&self, host: &str, token: &str) -> ApiResult<ForgeAccount> {
        let url = format!("{}/user", api_base(host));
        let response = self
            .http
            .get(url)
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28")
            .header("authorization", format!("Bearer {token}"))
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            return Err(ApiError::new(
                ErrorCode::AuthenticationRequired,
                "the hosting service did not recognise the sign-in",
            ));
        }

        let account: AccountResponse = response.json().await.map_err(|error| {
            ApiError::new(
                ErrorCode::NetworkFailed,
                "the hosting service returned an unexpected account",
            )
            .with_details(error.to_string())
        })?;
        Ok(ForgeAccount {
            host: host.to_owned(),
            login: account.login,
            name: account.name.filter(|name| !name.is_empty()),
            avatar_url: account.avatar_url.filter(|url| !url.is_empty()),
        })
    }

    async fn post<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        form: &[(&str, &str)],
    ) -> ApiResult<T> {
        let response = self
            .http
            .post(url)
            .header("accept", "application/json")
            .header("content-type", "application/x-www-form-urlencoded")
            .body(form_encode(form))
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(ApiError::new(
                ErrorCode::AuthenticationRequired,
                "the hosting service refused the sign-in request",
            )
            .with_details(status.to_string()));
        }
        response.json().await.map_err(|error| {
            ApiError::new(
                ErrorCode::NetworkFailed,
                "the hosting service returned an unexpected sign-in response",
            )
            .with_details(error.to_string())
        })
    }

    fn pending_map(&self) -> ApiResult<std::sync::MutexGuard<'_, HashMap<String, PendingLogin>>> {
        self.pending
            .lock()
            .map_err(|_| ApiError::new(ErrorCode::Internal, "the sign-in state is unavailable"))
    }
}

fn normalize(host: &str) -> String {
    host.trim().to_ascii_lowercase()
}

/// Builds an `application/x-www-form-urlencoded` body. The values are a client
/// ID, a grant type and codes the service issued, but they are encoded all the
/// same: a value must never be able to introduce a parameter of its own.
fn form_encode(fields: &[(&str, &str)]) -> String {
    let mut body = String::new();
    for (name, value) in fields {
        if !body.is_empty() {
            body.push('&');
        }
        body.push_str(&percent_encode(name));
        body.push('=');
        body.push_str(&percent_encode(value));
    }
    body
}

fn percent_encode(value: &str) -> String {
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

/// The device flow lives on the service's web host, not its API host.
fn web_host(host: &str) -> &str {
    if host == "www.github.com" {
        "github.com"
    } else {
        host
    }
}

fn token_url(host: &str) -> String {
    format!("https://{}/login/oauth/access_token", web_host(host))
}

fn api_base(host: &str) -> String {
    if host == "github.com" || host == "www.github.com" {
        "https://api.github.com".to_owned()
    } else {
        format!("https://{host}/api/v3")
    }
}

fn expiry_from_now(seconds: u64) -> u64 {
    now_seconds().saturating_add(seconds)
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

/// A credential with no expiry never needs renewing; one whose expiry is
/// already inside the margin does.
fn is_expiring(credential: &OAuthCredential) -> bool {
    credential
        .expires_at
        .is_some_and(|expires_at| expires_at <= now_seconds() + RENEW_MARGIN.as_secs())
}

fn network_error(error: reqwest::Error) -> ApiError {
    let code = if error.is_timeout() {
        ErrorCode::Timeout
    } else {
        ErrorCode::NetworkFailed
    };
    ApiError::new(code, "could not reach the hosting service").with_details(error.to_string())
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: Option<u32>,
    expires_in: Option<u32>,
}

/// The token endpoint answers with either a token or an error, in the same
/// object and with the same status code, so both halves are optional.
#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
    error: Option<String>,
    interval: Option<u32>,
}

#[derive(Deserialize)]
struct AccountResponse {
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credential(expires_at: Option<u64>) -> OAuthCredential {
        OAuthCredential {
            access_token: "gho_token".into(),
            refresh_token: Some("ghr_token".into()),
            expires_at,
            account: Some("ikoli".into()),
            scopes: GITHUB_SCOPES.into(),
        }
    }

    #[test]
    fn the_device_flow_uses_the_web_host_and_the_api_uses_the_api_host() {
        assert_eq!(
            token_url("github.com"),
            "https://github.com/login/oauth/access_token"
        );
        assert_eq!(
            token_url("www.github.com"),
            "https://github.com/login/oauth/access_token"
        );
        assert_eq!(api_base("github.com"), "https://api.github.com");
        // An enterprise install serves both from its own host.
        assert_eq!(
            token_url("git.example.test"),
            "https://git.example.test/login/oauth/access_token"
        );
        assert_eq!(
            api_base("git.example.test"),
            "https://git.example.test/api/v3"
        );
    }

    #[test]
    fn a_token_without_an_expiry_is_never_renewed() {
        assert!(!is_expiring(&credential(None)));
    }

    #[test]
    fn a_token_is_renewed_before_it_expires_rather_than_after() {
        // Inside the margin: a request starting now could otherwise land after
        // the expiry.
        assert!(is_expiring(&credential(Some(now_seconds() + 30))));
        assert!(is_expiring(&credential(Some(now_seconds() - 1))));
        assert!(!is_expiring(&credential(Some(now_seconds() + 3600))));
    }

    #[test]
    fn a_form_value_cannot_introduce_a_parameter_of_its_own() {
        assert_eq!(
            form_encode(&[("client_id", "Ov23li"), ("scope", "repo read:org")]),
            "client_id=Ov23li&scope=repo%20read%3Aorg",
        );
        assert_eq!(
            form_encode(&[("device_code", "a&grant_type=x")]),
            "device_code=a%26grant_type%3Dx",
        );
    }

    #[test]
    fn a_pending_answer_is_told_apart_from_a_granted_one() {
        let pending: TokenResponse =
            serde_json::from_str(r#"{"error":"authorization_pending"}"#).unwrap();
        assert_eq!(pending.error.as_deref(), Some("authorization_pending"));
        assert!(pending.access_token.is_none());

        let granted: TokenResponse = serde_json::from_str(
            r#"{"access_token":"gho_x","refresh_token":"ghr_x","expires_in":28800,"scope":"repo"}"#,
        )
        .unwrap();
        assert!(granted.error.is_none());
        assert_eq!(granted.expires_in, Some(28800));
    }
}
