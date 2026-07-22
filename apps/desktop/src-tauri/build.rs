use std::{
    env, fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

const UNKNOWN_COMMIT: &str = "unknown";

fn main() {
    let repository_root = env::var_os("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .and_then(|path| path.parent()?.parent()?.parent().map(Path::to_path_buf));

    if let Some(root) = repository_root.as_deref() {
        emit_git_rerun_paths(root);
    }

    let commit = repository_root
        .as_deref()
        .and_then(short_git_commit)
        .unwrap_or_else(|| UNKNOWN_COMMIT.to_owned());
    println!("cargo:rustc-env=GITCAT_BUILD_COMMIT={commit}");

    tauri_build::build()
}

fn short_git_commit(repository_root: &Path) -> Option<String> {
    // Do not inherit a parent repository when building an unpacked source tree.
    resolve_git_dir(&repository_root.join(".git"))?;
    let output = Command::new("git")
        .args(["rev-parse", "--short=7", "HEAD"])
        .current_dir(repository_root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let commit = String::from_utf8(output.stdout).ok()?;
    let commit = commit.trim();
    (commit.len() >= 7 && commit.len() <= 64 && commit.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| commit.to_owned())
}

fn emit_git_rerun_paths(repository_root: &Path) {
    let dot_git = repository_root.join(".git");
    let Some(git_dir) = resolve_git_dir(&dot_git) else {
        return;
    };
    let head = git_dir.join("HEAD");
    if !head.is_file() {
        return;
    }

    emit_rerun_path(&head);
    let Ok(head_value) = fs::read_to_string(&head) else {
        return;
    };
    let Some(reference) = head_value.trim().strip_prefix("ref: ") else {
        return;
    };
    if !is_safe_git_reference(reference) {
        return;
    }

    let common_dir = resolve_common_git_dir(&git_dir).unwrap_or(git_dir);
    let reference_path = common_dir.join(reference);
    emit_rerun_path(&reference_path);
    let packed_refs = common_dir.join("packed-refs");
    if packed_refs.is_file() {
        emit_rerun_path(&packed_refs);
    }
}

fn resolve_git_dir(dot_git: &Path) -> Option<PathBuf> {
    if dot_git.is_dir() {
        return Some(dot_git.to_path_buf());
    }

    let value = fs::read_to_string(dot_git).ok()?;
    let path = value.trim().strip_prefix("gitdir: ")?;
    let path = PathBuf::from(path);
    Some(if path.is_absolute() {
        path
    } else {
        dot_git.parent()?.join(path)
    })
}

fn resolve_common_git_dir(git_dir: &Path) -> Option<PathBuf> {
    let path = fs::read_to_string(git_dir.join("commondir")).ok()?;
    let path = PathBuf::from(path.trim());
    Some(if path.is_absolute() {
        path
    } else {
        git_dir.join(path)
    })
}

fn is_safe_git_reference(reference: &str) -> bool {
    let path = Path::new(reference);
    !reference.is_empty()
        && !reference.chars().any(char::is_control)
        && path.is_relative()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn emit_rerun_path(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());
}
