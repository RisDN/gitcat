//! Remote URL parsing and hosting-service detection.
//!
//! Git accepts several spellings for the same endpoint and the differences are
//! not cosmetic: `ssh://git@host:22/owner/repo` carries a port, while
//! `git@host:22/owner/repo` is the abbreviated form in which `22/owner/repo` is
//! the entire path. Parsing keeps those apart so callers never have to guess.
//!
//! Detection is deliberately host-driven and offline. A self-hosted GitHub
//! Enterprise or GitLab install is indistinguishable from any other domain
//! without asking it over the network, so those resolve to
//! [`ForgeKind::Unknown`] and are expected to be overridden by the caller.

use gitcat_contracts::{ForgeKind, RemoteUrlParts, RemoteUrlScheme};

/// Splits a Git remote URL into host, port and repository path.
///
/// Returns `None` for anything that names no network repository: local
/// filesystem paths, `file://` URLs, Windows drive letters and empty input.
/// Credentials are dropped, including the `***` placeholder the CLI backend
/// substitutes before a URL leaves the process.
pub fn parse_remote_url(url: &str) -> Option<RemoteUrlParts> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return None;
    }
    let Some(separator) = trimmed.find("://") else {
        return parse_scp_like(trimmed);
    };
    // An unrecognised scheme is never retried as the abbreviated form; that
    // would read `file:///srv/repo.git` as a host called `file`.
    let scheme = scheme_of(&trimmed[..separator])?;
    let rest = &trimmed[separator + 3..];
    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index + 1..]),
        None => (rest, ""),
    };
    let (host, port) = split_host_port(strip_credentials(authority))?;
    build(scheme, host, port, path)
}

/// Recognises the hosting service from the URL host alone.
///
/// Only the public hosts are listed. Self-hosted installations of the same
/// software answer [`ForgeKind::Unknown`], which the caller may override.
pub fn detect_forge(parts: &RemoteUrlParts) -> ForgeKind {
    match parts.host.as_str() {
        "github.com" | "www.github.com" | "ssh.github.com" | "gist.github.com" => ForgeKind::GitHub,
        "gitlab.com" | "www.gitlab.com" | "altssh.gitlab.com" => ForgeKind::GitLab,
        "bitbucket.org" | "www.bitbucket.org" | "altssh.bitbucket.org" => ForgeKind::Bitbucket,
        "codeberg.org" | "gitea.com" => ForgeKind::Gitea,
        "dev.azure.com" | "ssh.dev.azure.com" => ForgeKind::AzureDevOps,
        host if host.ends_with(".visualstudio.com") => ForgeKind::AzureDevOps,
        _ => ForgeKind::Unknown,
    }
}

/// Builds the repository home page for a parsed remote.
///
/// Returns `None` when the host cannot appear in a browser URL, which is the
/// case for unresolved SSH aliases from `~/.ssh/config`: the alias is a local
/// name, not a domain.
pub fn forge_web_url(parts: &RemoteUrlParts, forge: ForgeKind) -> Option<String> {
    if forge == ForgeKind::AzureDevOps {
        return azure_web_url(parts);
    }
    let host = web_host(&parts.host);
    if !host.contains('.') || parts.path.is_empty() {
        return None;
    }
    Some(format!(
        "https://{}/{}",
        with_web_port(host, parts),
        parts.path
    ))
}

fn scheme_of(name: &str) -> Option<RemoteUrlScheme> {
    match name.to_ascii_lowercase().as_str() {
        "https" => Some(RemoteUrlScheme::Https),
        "http" => Some(RemoteUrlScheme::Http),
        "ssh" | "git+ssh" | "ssh+git" => Some(RemoteUrlScheme::Ssh),
        "git" => Some(RemoteUrlScheme::Git),
        _ => None,
    }
}

/// Parses `[user@]host:path`, the abbreviated SSH form.
fn parse_scp_like(url: &str) -> Option<RemoteUrlParts> {
    if url.starts_with(['/', '.', '\\', '~']) {
        return None;
    }
    let colon = url.find(':')?;
    let (authority, path) = (&url[..colon], &url[colon + 1..]);
    if authority.contains(['/', '\\']) || path.starts_with('\\') {
        return None;
    }
    let host = strip_credentials(authority);
    // A one-character host is a Windows drive letter: `C:/src/repo`.
    if host.chars().count() <= 1 {
        return None;
    }
    build(
        RemoteUrlScheme::ScpLike,
        host.to_ascii_lowercase(),
        None,
        path,
    )
}

fn build(
    scheme: RemoteUrlScheme,
    host: String,
    port: Option<u16>,
    path: &str,
) -> Option<RemoteUrlParts> {
    let path = normalize_path(path);
    if host.is_empty() || path.is_empty() {
        return None;
    }
    let (owner, repo) = split_owner_repo(&host, &path);
    Some(RemoteUrlParts {
        scheme,
        host,
        port,
        path,
        owner,
        repo,
    })
}

fn strip_credentials(authority: &str) -> &str {
    match authority.rfind('@') {
        Some(index) => &authority[index + 1..],
        None => authority,
    }
}

fn split_host_port(authority: &str) -> Option<(String, Option<u16>)> {
    // Bracketed IPv6 literals keep their colons inside the brackets.
    if authority.starts_with('[') {
        let end = authority.find(']')?;
        let host = authority[..=end].to_ascii_lowercase();
        let port = match authority[end + 1..].strip_prefix(':') {
            Some(digits) => Some(digits.parse().ok()?),
            None => None,
        };
        return Some((host, port));
    }
    match authority.rsplit_once(':') {
        Some((host, digits)) => Some((host.to_ascii_lowercase(), Some(digits.parse().ok()?))),
        None => Some((authority.to_ascii_lowercase(), None)),
    }
}

fn normalize_path(path: &str) -> String {
    let path = path.split(['?', '#']).next().unwrap_or_default();
    let path = path.trim_matches('/');
    let path = match path.len().checked_sub(4) {
        Some(cut) if path[cut..].eq_ignore_ascii_case(".git") => &path[..cut],
        _ => path,
    };
    path.trim_end_matches('/').to_owned()
}

fn split_owner_repo(host: &str, path: &str) -> (Option<String>, Option<String>) {
    if let Some((organisation, project, repo)) = azure_parts(host, path) {
        return (Some(format!("{organisation}/{project}")), Some(repo));
    }
    let mut segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let Some(repo) = segments.pop() else {
        return (None, None);
    };
    let owner = (!segments.is_empty()).then(|| segments.join("/"));
    (owner, Some(repo.to_owned()))
}

/// Azure DevOps spells one repository four ways:
/// `dev.azure.com/org/project/_git/repo`,
/// `org.visualstudio.com/project/_git/repo`, and the two SSH forms that drop
/// `_git` and prefix the path with the protocol version.
fn azure_parts(host: &str, path: &str) -> Option<(String, String, String)> {
    if detect_forge(&host_only(host)) != ForgeKind::AzureDevOps {
        return None;
    }
    let mut segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    if segments
        .first()
        .is_some_and(|part| part.eq_ignore_ascii_case("v3"))
    {
        segments.remove(0);
    }
    if segments
        .first()
        .is_some_and(|part| part.eq_ignore_ascii_case("DefaultCollection"))
    {
        segments.remove(0);
    }
    let account = host
        .strip_suffix(".visualstudio.com")
        .filter(|account| !account.eq_ignore_ascii_case("vs-ssh"));
    match segments.iter().position(|part| *part == "_git") {
        Some(index) => {
            let repo = (*segments.get(index + 1)?).to_owned();
            match segments[..index] {
                [organisation, project] => {
                    Some((organisation.to_owned(), project.to_owned(), repo))
                }
                [project] => Some((account?.to_owned(), project.to_owned(), repo)),
                _ => None,
            }
        }
        None => match segments[..] {
            [organisation, project, repo] => {
                Some((organisation.to_owned(), project.to_owned(), repo.to_owned()))
            }
            [project, repo] => Some((account?.to_owned(), project.to_owned(), repo.to_owned())),
            _ => None,
        },
    }
}

fn azure_web_url(parts: &RemoteUrlParts) -> Option<String> {
    let (organisation, project, repo) = azure_parts(&parts.host, &parts.path)?;
    if parts.host.ends_with(".visualstudio.com") {
        return Some(format!(
            "https://{organisation}.visualstudio.com/{project}/_git/{repo}"
        ));
    }
    Some(format!(
        "https://dev.azure.com/{organisation}/{project}/_git/{repo}"
    ))
}

/// Hosts that serve Git under one name and the web UI under another.
fn web_host(host: &str) -> &str {
    match host {
        "ssh.github.com" | "www.github.com" => "github.com",
        "altssh.bitbucket.org" | "www.bitbucket.org" => "bitbucket.org",
        "altssh.gitlab.com" | "www.gitlab.com" => "gitlab.com",
        other => other,
    }
}

/// A self-hosted forge on a non-standard HTTP port serves its web UI there
/// too; an SSH port never appears in a browser URL.
fn with_web_port(host: &str, parts: &RemoteUrlParts) -> String {
    match parts.port {
        Some(port) if matches!(parts.scheme, RemoteUrlScheme::Https | RemoteUrlScheme::Http) => {
            format!("{host}:{port}")
        }
        _ => host.to_owned(),
    }
}

/// `detect_forge` only reads the host, so Azure detection can reuse it before
/// a full [`RemoteUrlParts`] exists.
fn host_only(host: &str) -> RemoteUrlParts {
    RemoteUrlParts {
        scheme: RemoteUrlScheme::Unknown,
        host: host.to_owned(),
        port: None,
        path: String::new(),
        owner: None,
        repo: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(url: &str) -> RemoteUrlParts {
        parse_remote_url(url).unwrap_or_else(|| panic!("expected {url} to parse"))
    }

    fn forge_of(url: &str) -> ForgeKind {
        detect_forge(&parse(url))
    }

    fn web_url_of(url: &str) -> Option<String> {
        let parts = parse(url);
        let forge = detect_forge(&parts);
        forge_web_url(&parts, forge)
    }

    #[test]
    fn parses_the_https_form() {
        let parts = parse("https://github.com/ikoli/gitcat.git");
        assert_eq!(parts.scheme, RemoteUrlScheme::Https);
        assert_eq!(parts.host, "github.com");
        assert_eq!(parts.port, None);
        assert_eq!(parts.path, "ikoli/gitcat");
        assert_eq!(parts.owner.as_deref(), Some("ikoli"));
        assert_eq!(parts.repo.as_deref(), Some("gitcat"));
    }

    #[test]
    fn parses_the_abbreviated_ssh_form() {
        let parts = parse("git@github.com:ikoli/gitcat.git");
        assert_eq!(parts.scheme, RemoteUrlScheme::ScpLike);
        assert_eq!(parts.host, "github.com");
        assert_eq!(parts.owner.as_deref(), Some("ikoli"));
        assert_eq!(parts.repo.as_deref(), Some("gitcat"));
    }

    #[test]
    fn reads_a_port_only_from_the_explicit_ssh_form() {
        let explicit = parse("ssh://git@github.com:2222/ikoli/gitcat.git");
        assert_eq!(explicit.port, Some(2222));
        assert_eq!(explicit.path, "ikoli/gitcat");

        // The abbreviated form has no port: Git reads `2222` as a path segment.
        let abbreviated = parse("git@github.com:2222/ikoli/gitcat.git");
        assert_eq!(abbreviated.port, None);
        assert_eq!(abbreviated.path, "2222/ikoli/gitcat");
    }

    #[test]
    fn drops_credentials_including_the_redaction_placeholder() {
        assert_eq!(
            parse("https://***@github.com/ikoli/gitcat.git").host,
            "github.com"
        );
        assert_eq!(
            parse("https://user:token@github.com/ikoli/gitcat").host,
            "github.com"
        );
    }

    #[test]
    fn lower_cases_the_host_but_not_the_path() {
        let parts = parse("https://GitHub.com/Ikoli/GitCat.GIT");
        assert_eq!(parts.host, "github.com");
        assert_eq!(parts.path, "Ikoli/GitCat");
    }

    #[test]
    fn keeps_the_full_group_chain_as_the_owner() {
        let parts = parse("https://gitlab.com/group/subgroup/tool.git");
        assert_eq!(parts.owner.as_deref(), Some("group/subgroup"));
        assert_eq!(parts.repo.as_deref(), Some("tool"));
    }

    #[test]
    fn rejects_local_paths_and_file_urls() {
        for url in [
            "",
            "   ",
            "/srv/git/repo.git",
            "./repo",
            "../repo",
            "~/repo",
            "C:/src/repo",
            "C:\\src\\repo",
            "\\\\server\\share\\repo",
            "file:///srv/git/repo.git",
            "ftp://example.test/repo.git",
        ] {
            assert!(parse_remote_url(url).is_none(), "{url} should not parse");
        }
    }

    #[test]
    fn detects_the_public_forges() {
        assert_eq!(
            forge_of("https://github.com/ikoli/gitcat.git"),
            ForgeKind::GitHub
        );
        assert_eq!(
            forge_of("git@ssh.github.com:ikoli/gitcat.git"),
            ForgeKind::GitHub
        );
        assert_eq!(
            forge_of("https://gitlab.com/group/tool.git"),
            ForgeKind::GitLab
        );
        assert_eq!(
            forge_of("git@bitbucket.org:team/tool.git"),
            ForgeKind::Bitbucket
        );
        assert_eq!(
            forge_of("https://codeberg.org/team/tool.git"),
            ForgeKind::Gitea
        );
        assert_eq!(
            forge_of("https://dev.azure.com/contoso/site/_git/tool"),
            ForgeKind::AzureDevOps
        );
    }

    #[test]
    fn leaves_self_hosted_installs_unknown() {
        assert_eq!(
            forge_of("https://git.example.test/team/tool.git"),
            ForgeKind::Unknown
        );
        assert_eq!(
            forge_of("git@git.example.test:team/tool.git"),
            ForgeKind::Unknown
        );
    }

    #[test]
    fn builds_web_urls_from_every_spelling_of_one_repository() {
        let expected = Some("https://github.com/ikoli/gitcat".to_owned());
        for url in [
            "https://github.com/ikoli/gitcat.git",
            "https://github.com/ikoli/gitcat",
            "git@github.com:ikoli/gitcat.git",
            "ssh://git@github.com/ikoli/gitcat.git",
            "ssh://git@ssh.github.com:443/ikoli/gitcat.git",
            "git://github.com/ikoli/gitcat.git",
        ] {
            assert_eq!(web_url_of(url), expected, "{url}");
        }
    }

    #[test]
    fn keeps_an_http_port_in_the_web_url_but_drops_an_ssh_port() {
        assert_eq!(
            web_url_of("https://git.example.test:8443/team/tool.git"),
            Some("https://git.example.test:8443/team/tool".to_owned())
        );
        assert_eq!(
            web_url_of("ssh://git@git.example.test:2222/team/tool.git"),
            Some("https://git.example.test/team/tool".to_owned())
        );
    }

    #[test]
    fn an_unresolved_ssh_alias_has_no_web_url() {
        let parts = parse("git@gh:ikoli/gitcat.git");
        assert_eq!(parts.host, "gh");
        assert_eq!(parts.owner.as_deref(), Some("ikoli"));
        assert_eq!(forge_web_url(&parts, ForgeKind::Unknown), None);
    }

    #[test]
    fn folds_the_four_azure_spellings_onto_one_repository() {
        let expected = Some("https://dev.azure.com/contoso/site/_git/tool".to_owned());
        for url in [
            "https://dev.azure.com/contoso/site/_git/tool",
            "https://contoso@dev.azure.com/contoso/site/_git/tool",
            "git@ssh.dev.azure.com:v3/contoso/site/tool",
        ] {
            assert_eq!(web_url_of(url), expected, "{url}");
            let parts = parse(url);
            assert_eq!(parts.owner.as_deref(), Some("contoso/site"), "{url}");
            assert_eq!(parts.repo.as_deref(), Some("tool"), "{url}");
        }

        // The legacy account host keeps serving its own domain.
        assert_eq!(
            web_url_of("https://contoso.visualstudio.com/DefaultCollection/site/_git/tool"),
            Some("https://contoso.visualstudio.com/site/_git/tool".to_owned())
        );
        assert_eq!(
            web_url_of("git@vs-ssh.visualstudio.com:v3/contoso/site/tool"),
            Some("https://contoso.visualstudio.com/site/_git/tool".to_owned())
        );
    }

    #[test]
    fn strips_query_and_fragment_from_the_path() {
        assert_eq!(
            parse("https://github.com/ikoli/gitcat.git?ref=main").path,
            "ikoli/gitcat"
        );
        assert_eq!(
            parse("https://github.com/ikoli/gitcat#readme").path,
            "ikoli/gitcat"
        );
    }
}
