//! On-disk avatar cache.
//!
//! Two layers: which account an author email belongs to, and the image bytes
//! for that account. The first is the expensive one -- it costs an API request
//! and counts against a rate limit -- so a miss is remembered too, and both
//! layers survive a restart.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// How long a resolved account stays trusted. Avatars change rarely and a
/// stale one is a cosmetic error, not a wrong answer.
const POSITIVE_TTL_SECONDS: u64 = 30 * 24 * 60 * 60;
/// Misses expire sooner: an author who had no account may have one now.
const NEGATIVE_TTL_SECONDS: u64 = 7 * 24 * 60 * 60;
const INDEX_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IdentityRecord {
    /// `None` records that the author could not be resolved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    fetched_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AvatarIndex {
    version: u32,
    entries: BTreeMap<String, IdentityRecord>,
}

pub struct AvatarCache {
    dir: PathBuf,
    index: Mutex<AvatarIndex>,
}

/// What the cache knows about one author email.
pub enum CachedIdentity {
    /// The account is known and its avatar URL is still fresh.
    Known(String),
    /// The author was looked up and could not be resolved; do not ask again
    /// until the miss expires.
    Missing,
    /// Nothing usable is stored.
    Unknown,
}

impl AvatarCache {
    pub fn new(dir: impl AsRef<Path>) -> Self {
        let dir = dir.as_ref().to_path_buf();
        let index = fs::read_to_string(dir.join("index.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<AvatarIndex>(&raw).ok())
            .filter(|index| index.version == INDEX_VERSION)
            .unwrap_or_else(|| AvatarIndex {
                version: INDEX_VERSION,
                entries: BTreeMap::new(),
            });
        Self {
            dir,
            index: Mutex::new(index),
        }
    }

    pub fn identity(&self, email: &str) -> CachedIdentity {
        let Ok(index) = self.index.lock() else {
            return CachedIdentity::Unknown;
        };
        let Some(record) = index.entries.get(&email.to_ascii_lowercase()) else {
            return CachedIdentity::Unknown;
        };
        let age = now().saturating_sub(record.fetched_at);
        match &record.url {
            Some(url) if age < POSITIVE_TTL_SECONDS => CachedIdentity::Known(url.clone()),
            None if age < NEGATIVE_TTL_SECONDS => CachedIdentity::Missing,
            _ => CachedIdentity::Unknown,
        }
    }

    pub fn remember_identity(&self, email: &str, url: Option<String>) {
        if let Ok(mut index) = self.index.lock() {
            index.entries.insert(
                email.to_ascii_lowercase(),
                IdentityRecord {
                    url,
                    fetched_at: now(),
                },
            );
        }
        self.flush();
    }

    /// The stored `data:` URI for an avatar URL, if it was downloaded before.
    pub fn image(&self, url: &str) -> Option<String> {
        fs::read_to_string(self.image_path(url)).ok()
    }

    /// Encodes and stores image bytes, returning the `data:` URI to hand to the
    /// webview. Bytes that are not a known image format are refused, so a
    /// redirect to an error page cannot become an inline document.
    pub fn remember_image(&self, url: &str, bytes: &[u8]) -> Option<String> {
        let mime = image_mime(bytes)?;
        let image = format!("data:{mime};base64,{}", STANDARD.encode(bytes));
        if fs::create_dir_all(self.dir.join("images")).is_ok() {
            let _ = fs::write(self.image_path(url), &image);
        }
        Some(image)
    }

    fn image_path(&self, url: &str) -> PathBuf {
        self.dir.join("images").join(digest(url))
    }

    fn flush(&self) {
        let Ok(index) = self.index.lock() else {
            return;
        };
        let Ok(body) = serde_json::to_string(&*index) else {
            return;
        };
        if fs::create_dir_all(&self.dir).is_ok() {
            let _ = fs::write(self.dir.join("index.json"), body);
        }
    }
}

fn digest(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

/// Recognises the raster formats a forge serves avatars in. SVG is excluded on
/// purpose: it is a document, not a bitmap.
fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR";

    #[test]
    fn a_resolved_account_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let cache = AvatarCache::new(dir.path());
        cache.remember_identity(
            "Author@Example.test",
            Some("https://host.test/a.png".into()),
        );

        let reopened = AvatarCache::new(dir.path());
        assert!(matches!(
            reopened.identity("author@example.test"),
            CachedIdentity::Known(url) if url == "https://host.test/a.png"
        ));
    }

    #[test]
    fn a_miss_is_remembered_so_the_rate_limit_is_not_spent_twice() {
        let dir = tempfile::tempdir().unwrap();
        let cache = AvatarCache::new(dir.path());
        assert!(matches!(
            cache.identity("nobody@example.test"),
            CachedIdentity::Unknown
        ));

        cache.remember_identity("nobody@example.test", None);
        assert!(matches!(
            cache.identity("nobody@example.test"),
            CachedIdentity::Missing
        ));
    }

    #[test]
    fn images_round_trip_as_data_uris() {
        let dir = tempfile::tempdir().unwrap();
        let cache = AvatarCache::new(dir.path());
        let stored = cache
            .remember_image("https://host.test/a.png", PNG)
            .unwrap();
        assert!(stored.starts_with("data:image/png;base64,"));
        assert_eq!(
            cache.image("https://host.test/a.png").as_deref(),
            Some(stored.as_str())
        );
        assert_eq!(cache.image("https://host.test/b.png"), None);
    }

    #[test]
    fn bytes_that_are_not_an_image_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let cache = AvatarCache::new(dir.path());
        assert_eq!(
            cache.remember_image("https://host.test/a.png", b"<html>"),
            None
        );
        assert_eq!(
            cache.remember_image("https://host.test/b.svg", b"<svg xmlns=\"...\">"),
            None
        );
    }

    #[test]
    fn an_index_from_another_version_is_discarded() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("index.json"),
            br#"{"version":99,"entries":{"a@b.test":{"url":"https://host.test/a.png","fetched_at":0}}}"#,
        )
        .unwrap();
        assert!(matches!(
            AvatarCache::new(dir.path()).identity("a@b.test"),
            CachedIdentity::Unknown
        ));
    }
}
