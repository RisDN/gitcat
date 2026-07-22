use std::{
    ffi::OsString,
    io,
    path::{Path, PathBuf},
    process::{ExitStatus, Stdio},
    time::Duration,
};

use gitcat_contracts::{ApiError, ApiResult, ErrorCode};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    sync::mpsc,
};
use tokio_util::sync::CancellationToken;

const DEFAULT_OUTPUT_CAP: usize = 16 * 1024 * 1024;
const ABSOLUTE_OUTPUT_CAP: usize = 128 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = 1024 * 1024;
const STDERR_DETAILS_CAP: usize = 8 * 1024;

struct ProcessTree {
    #[cfg(windows)]
    job: Option<windows_job::Job>,
}

impl ProcessTree {
    fn attach(child: &Child) -> io::Result<Self> {
        #[cfg(windows)]
        {
            Ok(Self {
                job: windows_job::Job::assign(child)?,
            })
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(Self {})
        }
    }

    fn terminate(&self, child: &mut Child) {
        #[cfg(windows)]
        if let Some(job) = &self.job {
            job.terminate();
        }
        let _ = child.start_kill();
    }
}

#[cfg(windows)]
mod windows_job {
    use std::{ffi::c_void, io, mem::size_of, ptr};

    use tokio::process::Child;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject,
        },
    };

    pub(super) struct Job(HANDLE);

    // The handle is uniquely owned and Windows job APIs are thread-safe.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub(super) fn assign(child: &Child) -> io::Result<Option<Self>> {
            let Some(process) = child.raw_handle() else {
                return Ok(None);
            };
            // SAFETY: every pointer passed here is either null as permitted by
            // the API or points to a live value for the duration of the call.
            unsafe {
                let handle = CreateJobObjectW(ptr::null(), ptr::null());
                if handle.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let job = Self(handle);
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    (&raw const limits).cast::<c_void>(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) == 0
                {
                    return Err(io::Error::last_os_error());
                }
                if AssignProcessToJobObject(handle, process as HANDLE) == 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(Some(job))
            }
        }

        pub(super) fn terminate(&self) {
            // SAFETY: self owns a valid job handle until Drop.
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // KILL_ON_JOB_CLOSE also removes any helper that outlived git.exe.
            // SAFETY: the owned handle is closed exactly once here.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct GitRunner {
    executable: PathBuf,
    default_output_cap: usize,
    default_timeout: Option<Duration>,
}

#[derive(Debug, Clone)]
pub(crate) struct GitRunOptions {
    pub read_only: bool,
    pub output_cap: usize,
    pub timeout: Option<Duration>,
    pub allow_failure: bool,
    pub allow_stdout_truncation: bool,
    /// Extra process environment applied after the sanitized baseline. Used to
    /// preserve authorship (`GIT_AUTHOR_*`) when rebuilding commit objects.
    pub extra_env: Vec<(OsString, OsString)>,
}

impl GitRunOptions {
    pub fn read_only(output_cap: usize) -> Self {
        Self {
            read_only: true,
            output_cap,
            timeout: Some(Duration::from_secs(30)),
            allow_failure: false,
            allow_stdout_truncation: false,
            extra_env: Vec::new(),
        }
    }

    pub fn mutation(output_cap: usize) -> Self {
        Self {
            read_only: false,
            output_cap,
            timeout: Some(Duration::from_secs(120)),
            allow_failure: false,
            allow_stdout_truncation: false,
            extra_env: Vec::new(),
        }
    }

    pub fn network(output_cap: usize) -> Self {
        Self {
            read_only: false,
            output_cap,
            timeout: None,
            allow_failure: false,
            allow_stdout_truncation: false,
            extra_env: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub(crate) struct GitCommandOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub stdout_truncated: bool,
}

impl GitCommandOutput {
    pub fn success(&self) -> bool {
        self.status.success()
    }

    pub fn stdout_lossy(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    pub fn stderr_lossy_redacted(&self) -> String {
        redact_sensitive(&String::from_utf8_lossy(&self.stderr))
    }
}

impl Default for GitRunner {
    fn default() -> Self {
        Self::new("git")
    }
}

impl GitRunner {
    pub fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            default_output_cap: DEFAULT_OUTPUT_CAP,
            default_timeout: Some(Duration::from_secs(30)),
        }
    }

    pub async fn run(
        &self,
        cwd: Option<&Path>,
        args: &[OsString],
        stdin: Option<&[u8]>,
        cancellation: CancellationToken,
        mut options: GitRunOptions,
    ) -> ApiResult<GitCommandOutput> {
        options.output_cap = if options.output_cap == 0 {
            self.default_output_cap
        } else {
            options.output_cap
        }
        .clamp(1, ABSOLUTE_OUTPUT_CAP);
        if options.timeout.is_none() && options.read_only {
            options.timeout = self.default_timeout;
        }

        let mut command = Command::new(&self.executable);
        command
            .arg("--no-pager")
            .arg("-c")
            .arg("color.ui=false")
            .arg("-c")
            .arg("core.quotepath=false")
            .args(args)
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .env("GIT_PAGER", "cat")
            .env("PAGER", "cat")
            .env("TERM", "dumb")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_LITERAL_PATHSPECS", "1")
            .env("GIT_MERGE_AUTOEDIT", "no");

        if options.read_only {
            command.env("GIT_OPTIONAL_LOCKS", "0");
        } else {
            command.env_remove("GIT_OPTIONAL_LOCKS");
        }
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }

        sanitize_git_environment(&mut command);
        // Core operations are non-interactive. Reusing a configured editor can
        // open an invisible process and leave merge/rebase continuations hung.
        command
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            // Reject external remote helpers, including URLs rewritten through
            // url.<base>.insteadOf. These are the transports GitCat supports.
            .env("GIT_ALLOW_PROTOCOL", "file:git:http:https:ssh");

        // Caller-supplied environment (e.g. preserved authorship) is applied
        // last so it wins over the sanitized baseline. Keys collide only with
        // GIT_AUTHOR_* / GIT_COMMITTER_* which the sanitizer never touches.
        for (key, value) in &options.extra_env {
            command.env(key, value);
        }

        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|error| spawn_error(&self.executable, error))?;
        let process_tree = ProcessTree::attach(&child).map_err(|error| {
            let _ = child.start_kill();
            ApiError::new(ErrorCode::Io, "Git process tree could not be isolated")
                .with_details(error.to_string())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            ApiError::new(ErrorCode::Internal, "Git stdout pipe could not be opened")
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            ApiError::new(ErrorCode::Internal, "Git stderr pipe could not be opened")
        })?;

        let (cap_tx, mut cap_rx) = mpsc::channel(2);
        let stdout_task = tokio::spawn(read_capped(
            stdout,
            options.output_cap,
            StreamKind::Stdout,
            cap_tx.clone(),
        ));
        let stderr_task = tokio::spawn(read_capped(
            stderr,
            options.output_cap,
            StreamKind::Stderr,
            cap_tx,
        ));

        if let Some(input) = stdin {
            if input.len() > MAX_INPUT_BYTES {
                process_tree.terminate(&mut child);
                let _ = child.wait().await;
                return Err(ApiError::new(
                    ErrorCode::OutputTooLarge,
                    "Git command input exceeded the safety limit",
                ));
            }
            if let Some(mut child_stdin) = child.stdin.take() {
                let write = async {
                    child_stdin.write_all(input).await?;
                    child_stdin.shutdown().await
                };
                tokio::select! {
                    result = write => result.map_err(io_error)?,
                    _ = cancellation.cancelled() => {
                        process_tree.terminate(&mut child);
                        let _ = child.wait().await;
                        return Err(ApiError::new(ErrorCode::Cancelled, "Git operation was cancelled"));
                    }
                }
            }
        }

        let deadline = options
            .timeout
            .map(|timeout| tokio::time::Instant::now() + timeout);
        let timeout_future = async move {
            if let Some(deadline) = deadline {
                tokio::time::sleep_until(deadline).await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::pin!(timeout_future);
        let mut cap_channel_open = true;
        let status = loop {
            tokio::select! {
                result = child.wait() => break result.map_err(io_error)?,
                _ = cancellation.cancelled() => {
                    process_tree.terminate(&mut child);
                    let _ = child.wait().await;
                    let _ = stdout_task.await;
                    let _ = stderr_task.await;
                    return Err(ApiError::new(ErrorCode::Cancelled, "Git operation was cancelled"));
                }
                _ = &mut timeout_future => {
                    process_tree.terminate(&mut child);
                    let _ = child.wait().await;
                    let _ = stdout_task.await;
                    let _ = stderr_task.await;
                    return Err(ApiError::new(ErrorCode::Timeout, "Git operation timed out"));
                }
                capped = cap_rx.recv(), if cap_channel_open => {
                    match capped {
                        Some(StreamKind::Stdout) if options.allow_stdout_truncation => {
                            // Keep draining without growing memory; original timeout remains active.
                        }
                        Some(_) => {
                            process_tree.terminate(&mut child);
                            let _ = child.wait().await;
                            let _ = stdout_task.await;
                            let _ = stderr_task.await;
                            return Err(ApiError::new(
                                ErrorCode::OutputTooLarge,
                                "Git command output exceeded the safety limit",
                            ));
                        }
                        None => cap_channel_open = false,
                    }
                }
            }
        };

        let stdout = join_reader(stdout_task).await?;
        let stderr = join_reader(stderr_task).await?;
        if stderr.truncated {
            return Err(ApiError::new(
                ErrorCode::OutputTooLarge,
                "Git diagnostic output exceeded the safety limit",
            ));
        }
        let output = GitCommandOutput {
            status,
            stdout: stdout.bytes,
            stderr: stderr.bytes,
            stdout_truncated: stdout.truncated,
        };

        if output.stdout_truncated && !options.allow_stdout_truncation {
            return Err(ApiError::new(
                ErrorCode::OutputTooLarge,
                "Git command output exceeded the safety limit",
            ));
        }
        if !output.status.success() && !options.allow_failure {
            return Err(self.failure_error(&output));
        }
        Ok(output)
    }

    pub fn failure_error(&self, output: &GitCommandOutput) -> ApiError {
        git_failure_error(output)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamKind {
    Stdout,
    Stderr,
}

struct CappedBytes {
    bytes: Vec<u8>,
    truncated: bool,
}

async fn read_capped<R: AsyncRead + Unpin>(
    mut reader: R,
    cap: usize,
    stream: StreamKind,
    cap_tx: mpsc::Sender<StreamKind>,
) -> io::Result<CappedBytes> {
    let mut bytes = Vec::with_capacity(cap.min(64 * 1024));
    let mut chunk = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        let remaining = cap.saturating_sub(bytes.len());
        if remaining > 0 {
            bytes.extend_from_slice(&chunk[..read.min(remaining)]);
        }
        if read > remaining && !truncated {
            truncated = true;
            let _ = cap_tx.try_send(stream);
        }
    }
    Ok(CappedBytes { bytes, truncated })
}

async fn join_reader(
    task: tokio::task::JoinHandle<io::Result<CappedBytes>>,
) -> ApiResult<CappedBytes> {
    task.await
        .map_err(|error| {
            ApiError::new(ErrorCode::Internal, "Git output task failed")
                .with_details(error.to_string())
        })?
        .map_err(io_error)
}

fn sanitize_git_environment(command: &mut Command) {
    const EXACT: &[&str] = &[
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_COMMON_DIR",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_NAMESPACE",
        "GIT_PREFIX",
        "GIT_SHALLOW_FILE",
        "GIT_REPLACE_REF_BASE",
        "GIT_CONFIG",
        "GIT_CONFIG_SYSTEM",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_PARAMETERS",
        "GIT_EXEC_PATH",
        "GIT_SSH",
        "GIT_SSH_COMMAND",
        "GIT_PROXY_COMMAND",
        "GIT_ASKPASS",
        "SSH_ASKPASS",
        "GIT_EDITOR",
        "GIT_SEQUENCE_EDITOR",
        "GIT_EXTERNAL_DIFF",
        "GIT_CURL_VERBOSE",
        "GIT_ALLOW_PROTOCOL",
    ];
    for key in EXACT {
        command.env_remove(key);
    }
    for (key, _) in std::env::vars_os() {
        let upper = key.to_string_lossy().to_ascii_uppercase();
        if upper.starts_with("GIT_CONFIG_KEY_")
            || upper.starts_with("GIT_CONFIG_VALUE_")
            || upper.starts_with("GIT_TRACE")
        {
            command.env_remove(key);
        }
    }
}

fn spawn_error(executable: &Path, error: io::Error) -> ApiError {
    let code = if error.kind() == io::ErrorKind::NotFound {
        ErrorCode::GitNotFound
    } else {
        ErrorCode::Io
    };
    ApiError::new(code, "Git executable could not be started").with_details(format!(
        "{}: {}",
        executable.display(),
        error
    ))
}

fn io_error(error: io::Error) -> ApiError {
    ApiError::new(ErrorCode::Io, "Git process I/O failed").with_details(error.to_string())
}

fn git_failure_error(output: &GitCommandOutput) -> ApiError {
    let stderr = output.stderr_lossy_redacted();
    let stdout = redact_sensitive(&output.stdout_lossy());
    let lower = format!("{stderr}\n{stdout}").to_ascii_lowercase();
    let (code, message) = if lower.contains("not a git repository") {
        (
            ErrorCode::InvalidRepository,
            "The selected folder is not a Git repository",
        )
    } else if lower.contains("index.lock") || lower.contains("another git process") {
        (
            ErrorCode::RepositoryBusy,
            "The repository is locked by another Git process",
        )
    } else if lower.contains("no tracking information")
        || lower.contains("has no upstream branch")
        || lower.contains("no upstream configured")
    {
        (
            ErrorCode::UpstreamMissing,
            "The branch has no upstream configured",
        )
    } else if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("permission denied (publickey)")
        || lower.contains("terminal prompts disabled")
    {
        (
            ErrorCode::AuthenticationRequired,
            "Remote authentication failed",
        )
    } else if lower.contains("non-fast-forward") || lower.contains("fetch first") {
        (
            ErrorCode::NonFastForward,
            "The remote rejected a non-fast-forward update",
        )
    } else if lower.contains("would be overwritten") || lower.contains("local changes") {
        (
            ErrorCode::DirtyWorktree,
            "Local changes prevent this Git operation",
        )
    } else if lower.contains("conflict") || lower.contains("unmerged") {
        (
            ErrorCode::ConflictsPresent,
            "Git stopped because conflicts require attention",
        )
    } else if lower.contains("could not resolve host")
        || lower.contains("failed to connect")
        || lower.contains("unable to access")
        || lower.contains("connection timed out")
        || lower.contains("connection reset")
    {
        (ErrorCode::NetworkFailed, "The remote could not be reached")
    } else if lower.contains("bad revision")
        || lower.contains("unknown revision")
        || lower.contains("needed a single revision")
        || lower.contains("ambiguous argument")
    {
        (
            ErrorCode::InvalidRevision,
            "The selected Git revision is invalid",
        )
    } else {
        (ErrorCode::GitCommandFailed, "Git command failed")
    };

    let exit = output.status.code().map_or_else(
        || "terminated".to_owned(),
        |code| format!("exit code {code}"),
    );
    let details = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    let details = tail_chars(&details, STDERR_DETAILS_CAP);
    let details = if details.trim().is_empty() {
        exit
    } else {
        format!("{exit}: {}", details.trim())
    };
    ApiError::new(code, message).with_details(details)
}

pub(crate) fn redact_sensitive(input: &str) -> String {
    let mut result = input.to_owned();
    for scheme in ["https://", "http://", "ssh://"] {
        let mut search_from = 0;
        while let Some(relative_start) = result[search_from..].find(scheme) {
            let credentials_start = search_from + relative_start + scheme.len();
            let tail = &result[credentials_start..];
            let authority_end = tail
                .find(['/', '\\', ' ', '\n', '\r', '\t'])
                .unwrap_or(tail.len());
            let authority = &tail[..authority_end];
            let Some(at) = authority.rfind('@') else {
                search_from = credentials_start + authority_end;
                continue;
            };
            let credentials_end = credentials_start + at;
            result.replace_range(credentials_start..credentials_end, "***");
            search_from = credentials_start + 3 + 1;
        }
    }
    for marker in [
        "token=",
        "access_token=",
        "password=",
        "passwd=",
        "secret=",
        "token:",
        "password:",
        "authorization: bearer ",
        "bearer ",
    ] {
        redact_after_marker(&mut result, marker);
    }
    result
}

fn redact_after_marker(value: &mut String, marker: &str) {
    let mut search_from = 0;
    loop {
        let lower = value.to_ascii_lowercase();
        let Some(relative) = lower[search_from..].find(marker) else {
            break;
        };
        let secret_start = search_from + relative + marker.len();
        let secret_end = value[secret_start..]
            .find(|character: char| {
                character.is_whitespace()
                    || matches!(character, '&' | ';' | ',' | '\'' | '"' | '<' | '>')
            })
            .map_or(value.len(), |relative_end| secret_start + relative_end);
        if secret_start == secret_end {
            search_from = secret_start;
            continue;
        }
        value.replace_range(secret_start..secret_end, "***");
        search_from = secret_start + 3;
    }
}

fn tail_chars(input: &str, max_bytes: usize) -> String {
    if input.len() <= max_bytes {
        return input.to_owned();
    }
    let mut start = input.len() - max_bytes;
    while !input.is_char_boundary(start) {
        start += 1;
    }
    input[start..].to_owned()
}

pub(crate) fn os_args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_url_userinfo() {
        let value = redact_sensitive(
            "fatal: unable to access 'https://alice:secret@example.test/repo': denied",
        );
        assert_eq!(
            value,
            "fatal: unable to access 'https://***@example.test/repo': denied"
        );
    }

    #[test]
    fn keeps_safe_urls() {
        assert_eq!(
            redact_sensitive("https://example.test/repo"),
            "https://example.test/repo"
        );
    }

    #[test]
    fn redacts_tokens_passwords_and_bearer_values() {
        let value =
            redact_sensitive("Authorization: Bearer abc.def token=secret&password=hunter2 next");
        assert_eq!(
            value,
            "Authorization: Bearer *** token=***&password=*** next"
        );
    }
}
