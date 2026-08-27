//! Storage for hosting-service credentials.
//!
//! The token itself goes to the operating system's credential store -- the
//! Windows Credential Manager, the macOS keychain, or the Secret Service on
//! Linux -- so it is never written to a file GitCat controls. In particular it
//! is never part of [`AppSettings`], which is exported to a file the user
//! shares and imports on another machine.
//!
//! One thing still has to live on disk: the credential stores offer no way to
//! enumerate entries, so the settings screen would have nothing to list. The
//! index next to the application state therefore records *which hosts* have a
//! token. A bare host name is not a secret; the token stays in the OS store.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use gitcat_contracts::{ApiError, ApiResult, CredentialKind, ErrorCode, ForgeCredential};
use serde::{Deserialize, Serialize};

const MAX_TOKEN_LENGTH: usize = 512;
/// A signed-in account stores more than a token -- the refresh token, the
/// expiry, the account name -- so its encoded form gets its own, looser cap.
const MAX_STORED_LENGTH: usize = 4096;
const MAX_HOSTS: usize = 64;
const INDEX_FILE: &str = "token-hosts.json";
/// An earlier build kept tokens here in plain text. Anything found is moved
/// into the OS store and the file is deleted.
const LEGACY_FILE: &str = "tokens.json";
const KEYRING_SERVICE: &str = "gitcat";

/// A sign-in obtained through the device flow.
///
/// The refresh token sits beside the access token in the same operating-system
/// entry, because losing one without the other would leave a credential that
/// can neither be used nor renewed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuthCredential {
    pub access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    /// Unix seconds. `None` when the service issues a token that does not
    /// expire, which is a setting of the registered application.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default)]
    pub scopes: String,
}

/// What one host's entry holds.
///
/// A value written by an earlier build, or typed in by the user, is a bare
/// token. A sign-in is stored as JSON so its refresh token travels with it.
/// The two are told apart by the leading brace, which a token never has.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoredCredential {
    Token(String),
    OAuth(OAuthCredential),
}

impl StoredCredential {
    pub fn access_token(&self) -> &str {
        match self {
            Self::Token(token) => token,
            Self::OAuth(credential) => &credential.access_token,
        }
    }

    pub fn kind(&self) -> CredentialKind {
        match self {
            Self::Token(_) => CredentialKind::Token,
            Self::OAuth(_) => CredentialKind::OAuth,
        }
    }

    pub fn account(&self) -> Option<&str> {
        match self {
            Self::Token(_) => None,
            Self::OAuth(credential) => credential.account.as_deref(),
        }
    }
}

/// Written with a version so a later shape can be recognised rather than
/// misread as this one.
#[derive(Serialize, Deserialize)]
struct StoredOAuth {
    version: u8,
    #[serde(flatten)]
    credential: OAuthCredential,
}

const STORED_VERSION: u8 = 1;

fn encode(credential: &OAuthCredential) -> ApiResult<String> {
    serde_json::to_string(&StoredOAuth {
        version: STORED_VERSION,
        credential: credential.clone(),
    })
    .map_err(|error| {
        ApiError::new(ErrorCode::Internal, "could not encode the credential")
            .with_details(error.to_string())
    })
}

/// A stored value that is neither a bare token nor a version this build knows
/// is treated as absent: the user signs in again, which costs a round trip and
/// loses nothing.
fn decode(raw: String) -> Option<StoredCredential> {
    if !raw.starts_with('{') {
        return Some(StoredCredential::Token(raw));
    }
    let stored: StoredOAuth = serde_json::from_str(&raw).ok()?;
    (stored.version == STORED_VERSION).then_some(StoredCredential::OAuth(stored.credential))
}

/// The credential backend, split out so the index, the migration and the
/// validation rules can be tested without touching the machine's real store.
pub trait SecretStore: Send + Sync {
    fn get(&self, host: &str) -> ApiResult<Option<String>>;
    fn set(&self, host: &str, token: &str) -> ApiResult<()>;
    fn delete(&self, host: &str) -> ApiResult<()>;
}

/// The operating system's own credential store.
pub struct KeyringSecrets;

impl SecretStore for KeyringSecrets {
    fn get(&self, host: &str) -> ApiResult<Option<String>> {
        match entry(host)?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keyring_error(error)),
        }
    }

    fn set(&self, host: &str, token: &str) -> ApiResult<()> {
        entry(host)?.set_password(token).map_err(keyring_error)
    }

    fn delete(&self, host: &str) -> ApiResult<()> {
        match entry(host)?.delete_credential() {
            // Already gone is the outcome the caller asked for.
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keyring_error(error)),
        }
    }
}

fn entry(host: &str) -> ApiResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, host).map_err(keyring_error)
}

fn keyring_error(error: keyring::Error) -> ApiError {
    ApiError::new(
        ErrorCode::Io,
        "the operating system credential store is unavailable",
    )
    .with_details(error.to_string())
}

pub struct TokenStore {
    index_path: PathBuf,
    secrets: Box<dyn SecretStore>,
    hosts: Mutex<BTreeSet<String>>,
}

impl TokenStore {
    /// Opens the store for one application data directory.
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Self::with_secrets(data_dir, Box::new(KeyringSecrets))
    }

    pub fn with_secrets(data_dir: impl AsRef<Path>, secrets: Box<dyn SecretStore>) -> Self {
        let data_dir = data_dir.as_ref();
        let store = Self {
            index_path: data_dir.join(INDEX_FILE),
            secrets,
            hosts: Mutex::new(read_index(&data_dir.join(INDEX_FILE))),
        };
        store.migrate_legacy_file(&data_dir.join(LEGACY_FILE));
        store
    }

    /// The bearer token for one host, whichever way it was obtained.
    ///
    /// This does not renew an expired sign-in; [`crate::ForgeAuth`] owns that,
    /// because renewing needs the network.
    pub fn get(&self, host: &str) -> Option<String> {
        self.stored(host)
            .map(|credential| credential.access_token().to_owned())
    }

    pub fn stored(&self, host: &str) -> Option<StoredCredential> {
        let raw = self
            .secrets
            .get(&host.to_ascii_lowercase())
            .ok()
            .flatten()?;
        decode(raw)
    }

    /// Stores a sign-in, replacing whatever the host held before.
    pub fn set_oauth(&self, host: &str, credential: &OAuthCredential) -> ApiResult<()> {
        let host = normalize_host(host)?;
        validate_token(&credential.access_token)?;
        let encoded = encode(credential)?;
        if encoded.len() > MAX_STORED_LENGTH {
            return Err(invalid(
                "the sign-in is larger than the credential store allows",
            ));
        }

        let mut hosts = self.lock()?;
        if !hosts.contains(&host) && hosts.len() >= MAX_HOSTS {
            return Err(invalid("at most 64 hosting service tokens can be stored"));
        }
        self.secrets.set(&host, &encoded)?;
        hosts.insert(host);
        write_index(&self.index_path, &hosts)
    }

    /// Stores or clears the token for one host. `None` removes it.
    pub fn set(&self, host: &str, token: Option<&str>) -> ApiResult<()> {
        let host = normalize_host(host)?;
        let mut hosts = self.lock()?;
        match token.map(str::trim).filter(|value| !value.is_empty()) {
            Some(token) => {
                validate_token(token)?;
                if !hosts.contains(&host) && hosts.len() >= MAX_HOSTS {
                    return Err(invalid("at most 64 hosting service tokens can be stored"));
                }
                self.secrets.set(&host, token)?;
                hosts.insert(host);
            }
            None => {
                self.secrets.delete(&host)?;
                hosts.remove(&host);
            }
        }
        write_index(&self.index_path, &hosts)
    }

    /// What the settings screen may show: which hosts hold a token, and a hint
    /// short enough not to be the credential.
    ///
    /// A host whose entry has disappeared -- deleted through the operating
    /// system rather than through GitCat -- is dropped from the index here
    /// rather than reported as a token that no longer exists.
    pub fn credentials(&self) -> ApiResult<Vec<ForgeCredential>> {
        let mut hosts = self.lock()?;
        let mut credentials = Vec::new();
        let mut live = BTreeSet::new();
        for host in hosts.iter() {
            if let Some(credential) = self.stored(host) {
                credentials.push(ForgeCredential {
                    host: host.clone(),
                    hint: hint(credential.access_token()),
                    kind: credential.kind(),
                    account: credential.account().map(str::to_owned),
                });
                live.insert(host.clone());
            }
        }
        if live.len() != hosts.len() {
            *hosts = live;
            write_index(&self.index_path, &hosts)?;
        }
        Ok(credentials)
    }

    /// Moves a plain-text store written by an earlier build into the OS store
    /// and removes the file. A token that cannot be moved is left alone rather
    /// than deleted, so it is never lost silently.
    fn migrate_legacy_file(&self, path: &Path) {
        let Ok(raw) = fs::read_to_string(path) else {
            return;
        };
        let Ok(legacy) = serde_json::from_str::<std::collections::BTreeMap<String, String>>(&raw)
        else {
            return;
        };
        for (host, token) in legacy {
            if self.set(&host, Some(&token)).is_err() {
                return;
            }
        }
        let _ = fs::remove_file(path);
    }

    fn lock(&self) -> ApiResult<std::sync::MutexGuard<'_, BTreeSet<String>>> {
        self.hosts
            .lock()
            .map_err(|_| ApiError::new(ErrorCode::Internal, "the credential index is unavailable"))
    }
}

/// The last four characters, which identify a token to the person who created
/// it without narrowing it for anyone else.
fn hint(token: &str) -> String {
    let tail: String = token
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("…{tail}")
}

fn read_index(path: &Path) -> BTreeSet<String> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<BTreeSet<String>>(&raw).ok())
        .unwrap_or_default()
}

fn write_index(path: &Path, hosts: &BTreeSet<String>) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(io_error)?;
    }
    let body = serde_json::to_string_pretty(hosts).map_err(|error| {
        ApiError::new(ErrorCode::Internal, "could not encode the credential index")
            .with_details(error.to_string())
    })?;
    fs::write(path, body).map_err(io_error)
}

fn normalize_host(host: &str) -> ApiResult<String> {
    let host = host.trim().to_ascii_lowercase();
    if host.is_empty()
        || host.len() > 253
        || host.contains(['/', ':', '@', ' '])
        || host.chars().any(char::is_control)
    {
        return Err(invalid("a token is keyed by a bare host name"));
    }
    Ok(host)
}

fn validate_token(token: &str) -> ApiResult<()> {
    if token.len() > MAX_TOKEN_LENGTH
        || token
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err(invalid(
            "the token contains characters a header cannot carry",
        ));
    }
    Ok(())
}

fn io_error(error: std::io::Error) -> ApiError {
    ApiError::new(ErrorCode::Io, "could not write the credential index")
        .with_details(error.to_string())
}

fn invalid(message: &str) -> ApiError {
    ApiError::new(ErrorCode::InvalidSettings, message)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::Arc;

    use super::*;

    /// Stands in for the operating system store. Shared by clone so a test can
    /// reopen a `TokenStore` against the same secrets.
    #[derive(Clone, Default)]
    struct MemorySecrets {
        entries: Arc<Mutex<BTreeMap<String, String>>>,
        fail: bool,
    }

    impl SecretStore for MemorySecrets {
        fn get(&self, host: &str) -> ApiResult<Option<String>> {
            if self.fail {
                return Err(invalid("unavailable"));
            }
            Ok(self.entries.lock().unwrap().get(host).cloned())
        }

        fn set(&self, host: &str, token: &str) -> ApiResult<()> {
            if self.fail {
                return Err(invalid("unavailable"));
            }
            self.entries
                .lock()
                .unwrap()
                .insert(host.to_owned(), token.to_owned());
            Ok(())
        }

        fn delete(&self, host: &str) -> ApiResult<()> {
            self.entries.lock().unwrap().remove(host);
            Ok(())
        }
    }

    fn store(dir: &Path, secrets: &MemorySecrets) -> TokenStore {
        TokenStore::with_secrets(dir, Box::new(secrets.clone()))
    }

    #[test]
    fn the_token_goes_to_the_secret_store_and_only_the_host_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = MemorySecrets::default();
        let tokens = store(dir.path(), &secrets);

        tokens.set("GitHub.com", Some("ghp_secret1234")).unwrap();
        assert_eq!(tokens.get("github.com").as_deref(), Some("ghp_secret1234"));

        let index = fs::read_to_string(dir.path().join(INDEX_FILE)).unwrap();
        assert!(index.contains("github.com"));
        assert!(!index.contains("ghp_secret1234"));
    }

    #[test]
    fn a_reopened_store_lists_what_the_first_one_saved() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = MemorySecrets::default();
        store(dir.path(), &secrets)
            .set("github.com", Some("ghp_secret1234"))
            .unwrap();

        let credentials = store(dir.path(), &secrets).credentials().unwrap();
        assert_eq!(credentials.len(), 1);
        assert_eq!(credentials[0].host, "github.com");
        assert_eq!(credentials[0].hint, "…1234");
        assert!(!credentials[0].hint.contains("secret"));
    }

    #[test]
    fn clearing_a_token_removes_it_from_both_layers() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = MemorySecrets::default();
        let tokens = store(dir.path(), &secrets);
        tokens.set("github.com", Some("ghp_secret1234")).unwrap();

        tokens.set("github.com", None).unwrap();
        assert_eq!(tokens.get("github.com"), None);
        assert!(tokens.credentials().unwrap().is_empty());
        assert!(secrets.entries.lock().unwrap().is_empty());
    }

    #[test]
    fn an_entry_deleted_outside_gitcat_drops_out_of_the_index() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = MemorySecrets::default();
        let tokens = store(dir.path(), &secrets);
        tokens.set("github.com", Some("ghp_secret1234")).unwrap();

        secrets.entries.lock().unwrap().clear();
        assert!(tokens.credentials().unwrap().is_empty());
        assert_eq!(read_index(&dir.path().join(INDEX_FILE)).len(), 0);
    }

    #[test]
    fn a_plain_text_store_from_an_earlier_build_is_moved_and_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = dir.path().join(LEGACY_FILE);
        fs::write(&legacy, br#"{"github.com":"ghp_secret1234"}"#).unwrap();

        let secrets = MemorySecrets::default();
        let tokens = store(dir.path(), &secrets);

        assert_eq!(tokens.get("github.com").as_deref(), Some("ghp_secret1234"));
        assert!(!legacy.exists(), "the plain-text file must not survive");
    }

    #[test]
    fn a_token_that_cannot_be_moved_keeps_its_file() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = dir.path().join(LEGACY_FILE);
        fs::write(&legacy, br#"{"github.com":"ghp_secret1234"}"#).unwrap();

        let secrets = MemorySecrets {
            fail: true,
            ..MemorySecrets::default()
        };
        let _tokens = store(dir.path(), &secrets);

        assert!(legacy.exists(), "a token must never be dropped silently");
    }

    /// Touches the machine's real credential store, so it is not part of the
    /// normal run. Use it to check a platform backend by hand:
    /// `cargo test -p gitcat-forge -- --ignored`.
    #[test]
    #[ignore = "writes to the operating system credential store"]
    fn real_credential_store_round_trip() {
        let host = "gitcat-selftest.invalid";
        let secrets = KeyringSecrets;

        secrets.set(host, "ghp_selftest1234").unwrap();
        assert_eq!(
            secrets.get(host).unwrap().as_deref(),
            Some("ghp_selftest1234")
        );

        secrets.delete(host).unwrap();
        assert_eq!(secrets.get(host).unwrap(), None);
        // Deleting an entry that is already gone is not an error.
        secrets.delete(host).unwrap();
    }

    #[test]
    fn rejects_hosts_and_tokens_a_request_could_not_carry() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = MemorySecrets::default();
        let tokens = store(dir.path(), &secrets);

        assert!(tokens.set("https://github.com", Some("ghp_x")).is_err());
        assert!(tokens.set("github.com/owner", Some("ghp_x")).is_err());
        assert!(tokens.set("github.com", Some("ghp with space")).is_err());
        assert!(tokens.set("github.com", Some("ghp_\nx")).is_err());
    }

    #[test]
    fn an_unreadable_index_starts_empty_instead_of_failing() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(INDEX_FILE), b"{ not json").unwrap();
        let secrets = MemorySecrets::default();
        assert!(
            store(dir.path(), &secrets)
                .credentials()
                .unwrap()
                .is_empty()
        );
    }
}
