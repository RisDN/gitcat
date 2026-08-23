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
}
