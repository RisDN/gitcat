//! Contracts for the hosting-service integration: avatar lookup and the
//! credentials it may use.

use serde::{Deserialize, Serialize};

use crate::ForgeKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AvatarSettings {
    /// Resolve commit authors against the repository's hosting service.
    pub enabled: bool,
    /// Fall back to Gravatar for authors the hosting service does not know.
    ///
    /// Off by default: it sends a hash of every unresolved author's email
    /// address to a third party that is not hosting the repository.
    pub gravatar_fallback: bool,
}

impl Default for AvatarSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            gravatar_fallback: false,
        }
    }
}

/// One batch of authors to resolve, scoped to the repository they committed to.
///
/// The hosting service maps a commit email onto an account itself, so an
/// author whose address is neither a forge alias nor public still resolves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AvatarLookup {
    /// Host of the repository's remote, which selects both the API endpoint
    /// and the stored credential.
    pub host: String,
    pub owner: String,
    pub repo: String,
    /// Which API to speak, already carrying any settings override.
    pub forge: ForgeKind,
    /// Newest commit in view. The commit walk starts here, so a lookup for an
    /// old page resolves the authors on that page rather than the tip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tip_oid: Option<String>,
    /// Author emails, lower-cased by the caller or not; matching is
    /// case-insensitive either way.
    pub emails: Vec<String>,
}

/// A resolved avatar, inlined as a `data:` URI so the webview needs no network
/// access of its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AvatarEntry {
    pub email: String,
    pub image: String,
}

/// Which hosts hold a stored token. The token itself never crosses this
/// boundary once saved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeCredential {
    pub host: String,
    /// Non-secret hint for the settings UI, such as the last four characters.
    pub hint: String,
    /// How the credential was obtained, which decides what the settings screen
    /// offers: a signed-in account can be signed out, a typed token replaced.
    #[serde(default)]
    pub kind: CredentialKind,
    /// Account the credential belongs to, when the sign-in reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialKind {
    /// Typed in by the user as a personal access token.
    #[default]
    Token,
    /// Obtained by signing in through the device flow.
    OAuth,
}

/// The repository a hosting-service request is scoped to.
///
/// The webview derives this from the remote it links against, so a request
/// always names the host that holds the credential as well as the path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeRepo {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub forge: ForgeKind,
}

/// Which hosting-service lookups are allowed to leave the machine.
///
/// Both default to on: unlike Gravatar these ask the service that already
/// hosts the repository, which the user is pushing to anyway.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ForgeSettings {
    /// Show the open pull request a branch belongs to.
    pub pull_requests: bool,
    /// Show the rolled-up check state of a branch tip.
    pub checks: bool,
}

impl Default for ForgeSettings {
    fn default() -> Self {
        Self {
            pull_requests: true,
            checks: true,
        }
    }
}

/// Where a pull request stands.
///
/// Draft is a state of its own rather than a flag beside `Open`, because it is
/// what the UI paints and a draft is never simultaneously merged or closed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestState {
    #[default]
    Open,
    Draft,
    Merged,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PullRequestInfo {
    pub number: u64,
    pub title: String,
    pub state: PullRequestState,
    /// Account that opened it, absent once that account is gone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Branch being merged, named as it is in the repository that holds it.
    pub head_ref: String,
    pub head_oid: String,
    /// Owner of the head repository when the branch lives in a fork. A local
    /// branch only matches a pull request opened from this same repository,
    /// so a fork's `main` is never mistaken for the local one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_owner: Option<String>,
    pub base_ref: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Rolled-up state of everything that reported a result for one commit.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    /// Nothing reported at all, which is different from reporting nothing
    /// conclusive.
    #[default]
    None,
    Success,
    Failure,
    Pending,
    /// Everything that reported was skipped or explicitly neutral.
    Neutral,
}

/// Both halves of a commit's status -- the legacy commit statuses and the
/// check runs -- collapsed into the one badge a branch row can show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckSummary {
    pub oid: String,
    pub state: CheckState,
    pub total: u32,
    pub failed: u32,
    pub pending: u32,
}

/// The signed-in account on one host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeAccount {
    pub host: String,
    pub login: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Served by the hosting service; the webview's image policy already
    /// allows it, so unlike a commit author avatar it is not inlined.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

/// What the user has to do to finish a device-flow sign-in.
///
/// The device code itself stays in the backend: the webview only needs what it
/// shows the user, and a code that authorises a token has no business in a
/// page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceAuthorization {
    pub host: String,
    /// Typed into the verification page by the user.
    pub user_code: String,
    pub verification_uri: String,
    /// How often the backend may poll, in seconds.
    pub interval_seconds: u32,
    pub expires_in_seconds: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoginState {
    /// The user has not finished authorising yet.
    #[default]
    Pending,
    Complete,
    /// The code timed out; the sign-in has to start again.
    Expired,
    /// The user refused, on the verification page.
    Denied,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoginPoll {
    pub state: LoginState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<ForgeAccount>,
}

/// What a repository created on a hosting service is created with.
///
/// It is always created under the connected account: creating one inside an
/// organisation would mean listing the account's organisations first, which
/// GitCat does not ask for yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewRepository {
    pub host: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub private: bool,
}

/// One repository the signed-in account can reach.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeRepository {
    pub full_name: String,
    pub owner: String,
    pub name: String,
    pub private: bool,
    pub fork: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_branch: Option<String>,
    pub clone_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}
