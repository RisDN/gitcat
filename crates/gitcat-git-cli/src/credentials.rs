//! Handing a hosting-service token to Git for one command.
//!
//! Git asks a credential helper for a username and password over a pipe. GitCat
//! installs a helper for the length of a single network command, so a sign-in
//! made inside the application also authenticates the clone, fetch and push it
//! leads to -- without writing anything into the user's Git configuration.
//!
//! The token travels in the child process environment, never in the command
//! line and never in a configuration value: an argument list is readable by any
//! process on the machine, and a configuration value would outlive the command.
//! The helper is a shell function rather than a second executable, so there is
//! no extra binary to install and nothing to find on `PATH`.

use std::ffi::OsString;

use async_trait::async_trait;

/// Any user name is accepted alongside a token; this is the one the hosting
/// services document for it.
pub(crate) const CREDENTIAL_USER: &str = "x-access-token";

pub(crate) const HOST_ENV: &str = "GITCAT_CREDENTIAL_HOST";
pub(crate) const USER_ENV: &str = "GITCAT_CREDENTIAL_USER";
pub(crate) const TOKEN_ENV: &str = "GITCAT_CREDENTIAL_TOKEN";

/// The helper reads the request Git writes on stdin and answers only when the
/// host matches the one the token was issued for. A redirect to another host
/// therefore gets nothing rather than someone else's token.
///
/// `$1` is the operation. Only `get` is answered: GitCat stores credentials
/// itself, so `store` and `erase` have nothing to do and exit quietly.
const HELPER_SCRIPT: &str = "!f() { \
test \"$1\" = get || exit 0; \
h=; \
while IFS= read -r line; do case \"$line\" in host=*) h=${line#host=} ;; esac; done; \
case \"$h\" in \"$GITCAT_CREDENTIAL_HOST\"|\"$GITCAT_CREDENTIAL_HOST\":*) ;; *) exit 0 ;; esac; \
printf 'username=%s\\npassword=%s\\n' \"$GITCAT_CREDENTIAL_USER\" \"$GITCAT_CREDENTIAL_TOKEN\"; \
}; f";

/// A token to offer while one command runs, and the host it belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostCredential {
    pub host: String,
    pub token: String,
}

/// Where the backend gets a token from. Implemented outside this crate, so the
/// Git layer needs to know nothing about hosting services or credential stores.
#[async_trait]
pub trait GitCredentialSource: Send + Sync {
    /// The token to offer for one host, or `None` to leave Git to whatever
    /// credential helpers the user has configured.
    async fn token_for(&self, host: &str) -> Option<String>;
}

/// The `-c` arguments that install the helper for one command.
///
/// The empty value first is what makes this work: it clears every helper the
/// user's configuration accumulated, so GitCat's answer is the one Git uses
/// rather than a fourth opinion after a system credential manager has already
/// answered. It is set per command, so nothing outside this process changes.
pub(crate) fn helper_args() -> Vec<OsString> {
    vec![
        "-c".into(),
        "credential.helper=".into(),
        "-c".into(),
        format!("credential.helper={HELPER_SCRIPT}").into(),
    ]
}

pub(crate) fn helper_env(credential: &HostCredential) -> Vec<(OsString, OsString)> {
    vec![
        (HOST_ENV.into(), credential.host.as_str().into()),
        (USER_ENV.into(), CREDENTIAL_USER.into()),
        (TOKEN_ENV.into(), credential.token.as_str().into()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_helper_answers_only_the_get_operation() {
        assert!(
            HELPER_SCRIPT.starts_with("!f() {"),
            "runs through the shell"
        );
        assert!(HELPER_SCRIPT.contains("test \"$1\" = get || exit 0"));
    }

    #[test]
    fn the_helper_checks_the_host_before_answering() {
        // Both the bare host and the host with a port, which is how Git spells
        // a service reached on a non-standard port.
        assert!(
            HELPER_SCRIPT.contains("\"$GITCAT_CREDENTIAL_HOST\"|\"$GITCAT_CREDENTIAL_HOST\":*")
        );
        assert!(
            HELPER_SCRIPT.contains("*) exit 0 ;;"),
            "an unexpected host gets nothing"
        );
    }

    /// The script names the variables literally, so a renamed constant has to
    /// be noticed here rather than at runtime.
    #[test]
    fn the_script_and_the_environment_agree_on_the_variable_names() {
        for name in [HOST_ENV, USER_ENV, TOKEN_ENV] {
            assert!(HELPER_SCRIPT.contains(&format!("${name}")), "{name}");
        }
    }

    #[test]
    fn the_token_never_reaches_the_command_line() {
        let arguments = helper_args();
        let rendered = arguments
            .iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(" ");

        assert!(
            rendered.contains("$GITCAT_CREDENTIAL_TOKEN"),
            "read from the environment"
        );
        // The empty helper comes first, so the user's own helpers do not answer
        // ahead of this one.
        assert_eq!(arguments[1], OsString::from("credential.helper="));
    }

    #[test]
    fn the_environment_carries_the_host_and_the_token() {
        let environment = helper_env(&HostCredential {
            host: "github.com".into(),
            token: "gho_secret".into(),
        });

        assert_eq!(
            environment,
            vec![
                (OsString::from(HOST_ENV), OsString::from("github.com")),
                (OsString::from(USER_ENV), OsString::from(CREDENTIAL_USER)),
                (OsString::from(TOKEN_ENV), OsString::from("gho_secret")),
            ]
        );
    }
}
