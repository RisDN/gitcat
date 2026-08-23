//! Turns commit author emails into inline avatar images.
//!
//! Three sources, cheapest first. A forge alias address names its account
//! outright and costs nothing. The repository's hosting service resolves the
//! rest, including private addresses, because it holds the address-to-account
//! link itself. Gravatar is last and opt-in, because unlike the other two it
//! sends a hash of the address to a party that is not hosting the repository.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;

use gitcat_contracts::{ApiResult, AvatarEntry, AvatarLookup, AvatarSettings, ForgeKind};
use sha2::{Digest, Sha256};

use crate::cache::{AvatarCache, CachedIdentity};
use crate::github::GitHubClient;
use crate::token::TokenStore;

/// Twice the rendered node diameter, so the image stays sharp on a high-DPI
/// display without paying for a full-size portrait.
const AVATAR_PIXELS: u16 = 64;
const MAX_IMAGE_BYTES: u64 = 512 * 1024;
const GITHUB_NOREPLY_SUFFIX: &str = "@users.noreply.github.com";

pub struct AvatarService {
    http: reqwest::Client,
    cache: AvatarCache,
    tokens: Arc<TokenStore>,
}

impl AvatarService {
    pub fn new(cache_dir: impl AsRef<Path>, tokens: Arc<TokenStore>) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("GitCat/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        Self {
            http,
            cache: AvatarCache::new(cache_dir),
            tokens,
        }
    }

    /// Resolves as many of the requested authors as the enabled sources allow.
    ///
    /// Authors that stay unresolved are simply absent from the result; the UI
    /// keeps drawing their initial. A hosting service that refuses the request
    /// is not an error either -- the rest of the batch still resolves.
    pub async fn resolve(
        &self,
        lookup: &AvatarLookup,
        settings: AvatarSettings,
    ) -> ApiResult<Vec<AvatarEntry>> {
        if !settings.enabled {
            return Ok(Vec::new());
        }

        let emails: BTreeSet<String> = lookup
            .emails
            .iter()
            .map(|email| email.trim().to_ascii_lowercase())
            .filter(|email| !email.is_empty())
            .collect();

        let mut entries = Vec::new();
        let mut unresolved = Vec::new();
        let mut ask_service = Vec::new();

        for email in emails {
            match self.cache.identity(&email) {
                CachedIdentity::Known(url) => {
                    if let Some(image) = self.image(&url).await {
                        entries.push(AvatarEntry { email, image });
                        continue;
                    }
                    unresolved.push(email);
                }
                // The service already said it knows nobody at this address, so
                // asking again would only spend the rate limit. Gravatar may
                // still know them.
                CachedIdentity::Missing => unresolved.push(email),
                CachedIdentity::Unknown => match noreply_avatar_url(&email) {
                    Some(url) => {
                        self.cache.remember_identity(&email, Some(url.clone()));
                        match self.image(&url).await {
                            Some(image) => entries.push(AvatarEntry { email, image }),
                            None => unresolved.push(email),
                        }
                    }
                    None => ask_service.push(email),
                },
            }
        }

        if !ask_service.is_empty() && lookup.forge == ForgeKind::GitHub {
            self.resolve_from_github(lookup, &mut ask_service, &mut entries)
                .await;
        }
        unresolved.append(&mut ask_service);

        for email in unresolved {
            if !settings.gravatar_fallback {
                continue;
            }
            if let Some(image) = self.gravatar(&email).await {
                entries.push(AvatarEntry { email, image });
            }
        }

        Ok(entries)
    }

    /// Walks one page of commits and records what the service matched. Emails
    /// the page did not mention stay unknown rather than being written off:
    /// they may well appear on the next page of history.
    async fn resolve_from_github(
        &self,
        lookup: &AvatarLookup,
        pending: &mut Vec<String>,
        entries: &mut Vec<AvatarEntry>,
    ) {
        let token = self.tokens.get(&lookup.host);
        let client = GitHubClient::new(self.http.clone(), &lookup.host, token);
        let Ok(authors) = client
            .commit_authors(&lookup.owner, &lookup.repo, lookup.tip_oid.as_deref())
            .await
        else {
            return;
        };

        for author in &authors {
            self.cache
                .remember_identity(&author.email, author.avatar_url.clone());
        }

        let mut still_pending = Vec::new();
        for email in std::mem::take(pending) {
            let matched = authors
                .iter()
                .find(|author| author.email == email)
                .and_then(|author| author.avatar_url.clone());
            let image = match matched {
                Some(url) => self.image(&sized(&url)).await,
                None => None,
            };
            match image {
                Some(image) => entries.push(AvatarEntry { email, image }),
                None => still_pending.push(email),
            }
        }
        *pending = still_pending;
    }

    async fn gravatar(&self, email: &str) -> Option<String> {
        let key = format!("gravatar:{email}");
        if let CachedIdentity::Missing = self.cache.identity(&key) {
            return None;
        }
        let url = gravatar_url(email);
        match self.image(&url).await {
            Some(image) => {
                self.cache.remember_identity(&key, Some(url));
                Some(image)
            }
            None => {
                self.cache.remember_identity(&key, None);
                None
            }
        }
    }

    /// Downloads and inlines an image, or returns the copy already on disk.
    async fn image(&self, url: &str) -> Option<String> {
        if let Some(cached) = self.cache.image(url) {
            return Some(cached);
        }
        let response = self.http.get(url).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_IMAGE_BYTES)
        {
            return None;
        }
        let bytes = response.bytes().await.ok()?;
        if bytes.len() as u64 > MAX_IMAGE_BYTES {
            return None;
        }
        self.cache.remember_image(url, &bytes)
    }
}

/// GitHub's alias addresses name the account without a lookup: the numeric
/// form carries the account id, the older form carries the login.
pub fn noreply_avatar_url(email: &str) -> Option<String> {
    let local = email
        .to_ascii_lowercase()
        .strip_suffix(GITHUB_NOREPLY_SUFFIX)?
        .to_owned();
    if local.is_empty() {
        return None;
    }
    if let Some((id, login)) = local.split_once('+') {
        if !id.is_empty() && !login.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()) {
            return Some(format!(
                "https://avatars.githubusercontent.com/u/{id}?v=4&s={AVATAR_PIXELS}"
            ));
        }
    }
    if local.contains(['/', '?', '#', '+', '@', '%']) {
        return None;
    }
    Some(format!(
        "https://github.com/{local}.png?size={AVATAR_PIXELS}"
    ))
}

/// Asks the service for an avatar no larger than it is drawn. The URL the
/// commit list hands back already carries a query, so the size joins it.
fn sized(url: &str) -> String {
    if url.contains("s=") {
        return url.to_owned();
    }
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{url}{separator}s={AVATAR_PIXELS}")
}

/// `d=404` makes an address with no Gravatar answer 404 instead of handing
/// back a generated pattern, which is what lets the miss be cached.
pub fn gravatar_url(email: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(email.trim().to_ascii_lowercase().as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    format!("https://gravatar.com/avatar/{digest}?d=404&s={AVATAR_PIXELS}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_numeric_alias_address_names_the_account_id() {
        assert_eq!(
            noreply_avatar_url("12345+ikoli@users.noreply.github.com").as_deref(),
            Some("https://avatars.githubusercontent.com/u/12345?v=4&s=64"),
        );
    }

    #[test]
    fn the_older_alias_address_names_the_login() {
        assert_eq!(
            noreply_avatar_url("Ikoli@users.noreply.github.com").as_deref(),
            Some("https://github.com/ikoli.png?size=64"),
        );
    }

    #[test]
    fn an_ordinary_address_is_not_an_alias() {
        assert_eq!(noreply_avatar_url("szilagypet53@gmail.com"), None);
        assert_eq!(noreply_avatar_url("@users.noreply.github.com"), None);
        assert_eq!(noreply_avatar_url("a/b@users.noreply.github.com"), None);
    }

    #[test]
    fn gravatar_hashes_the_trimmed_lower_case_address() {
        // The published example digest for the canonical test address.
        assert_eq!(
            gravatar_url("  Author@Example.test "),
            gravatar_url("author@example.test")
        );
        assert!(gravatar_url("author@example.test").contains("d=404"));
    }
}
