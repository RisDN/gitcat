# GitCat

Lightweight, Windows-first desktop Git client. Tauri v2 + React UI, Rust core, and system-installed Git. No AI, cloud patches, PR/issue panel, or arbitrary shell/Git commands.

> **Status:** functional MVP. `tauri dev` works with real repositories; the standalone Vite development page uses a built-in demo data source.

## Key features

- Repository tabs in groups: drag and drop, collapse, rename, close, and automatic restoration.
- LOCAL, REMOTE, and TAGS sidebar with filtering, branch creation, checkout, rename, and safe deletion.
- Paginated commit DAG with colored lanes, keyboard navigation, and loading of older commits.
- `Ctrl+F` search across commit subjects and full description/body text.
- Commit details: SHA, author, timestamp, parents, statistics, and changed files.
- GitKraken-style structured diff: inline/split view, line numbers, and rename/mode/binary/truncation states.
- Working tree: staged/unstaged lists, per-file or bulk stage/unstage, commit, amend, and sign-off.
- Fetch, push, stash push, and explicit pull modes: merge, fast-forward only, or rebase.
- Commit context menu: detached checkout, branch/tag creation, cherry-pick, revert, reset, and full SHA copy.
- Continue or abort an in-progress merge/rebase/cherry-pick/revert.
- Resizable panels and customizable semantic UI, diff, and graph-lane colors.

Keyboard shortcuts:

- `Ctrl+O`: open repository
- `Ctrl+F`: search commits
- `Ctrl+,`: settings
- `F5`: refresh repository
- With the graph focused: `↑`, `↓`, `Home`, `End`, `Enter`, `Shift+F10`

## Architecture

```text
React 19 + TypeScript + Tailwind CSS 4
              |
       typed GitCatApi
              |
    Tauri v2 invoke commands
              |
         gitcat-core
    registry + repository locks
              |
       GitBackend trait
              |
      gitcat-git-cli
              |
          system Git
```

Workspace:

- `apps/desktop`: Vite/React UI and Tauri v2 adapter.
- `crates/gitcat-contracts`: Serde DTOs, enums, and stable API errors.
- `crates/gitcat-core`: repository registry, operation serialization, DAG layout, and persistent workspace/settings.
- `crates/gitcat-git-cli`: safe system Git runner and porcelain/plumbing parsers.

Using system Git is intentional: it preserves Git Credential Manager, SSH agents, hooks, signing, filters, and user Git configuration.

## Requirements

- Git 2.31+
- Rust 1.85+; Tauri Windows/MSVC prerequisites and WebView2 for native Windows builds
- Node.js 22 LTS and npm

Windows 10/11 is the primary target. Other platforms are neither packaged nor verified in this MVP.

## Development

Frontend dependencies:

```powershell
cd .\apps\desktop
npm.cmd install
```

Real native GitCat:

```powershell
npm.cmd run tauri dev
```

UI only, with demo data:

```powershell
npm.cmd run dev
```

The Vite page does not access the file system or real repositories. Native Git operations always require `tauri dev`.

## Build and verification

Rust workspace:

```powershell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Windows helper for the same checks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

Frontend:

```powershell
cd .\apps\desktop
npm.cmd run typecheck
npm.cmd run build
```

Native release and installer packages:

```powershell
cd .\apps\desktop
npm.cmd run tauri build
```

The web build is written to `apps/desktop/dist`; native artifacts are written under Cargo's `target/release` directory.

## Security model

- Git runs directly as a `tokio::process::Command` process; there is no shell and no general-purpose `run_git(args)` IPC.
- The UI passes a path only when opening a repository. Subsequent calls use a registered, UUID-based repository ID.
- Ref names are validated by Git; revisions are resolved to full object IDs before mutations.
- Pathspec arguments are passed literally after `--`.
- External diff tools and textconv are disabled for read-only diffs.
- Allowed remote protocols: `file`, `git`, `http`, `https`, `ssh`; custom remote helpers are disabled.
- Credential prompts are disabled. A preconfigured Git Credential Manager or SSH agent is required.
- `reset --hard`, forced branch deletion, and stash drop require explicit confirmation plus a current matching snapshot. The core rejects stale dialogs.
- GitCat does not modify the global `safe.directory` value or delete `.git/index.lock`.
- The Tauri main window receives only core and directory-open permissions; CSP blocks external object/frame/form content.

## MVP limitations

- The UI currently supports opening existing local repositories. Init/clone core and IPC are implemented, but there is no dedicated UI yet.
- A remote/upstream editor, stash apply/pop/drop panel, and annotated-tag message UI are not yet available; the core/IPC already partially supports them.
- The auto-fetch interval is persisted, but no background scheduler is wired up yet.
- Network operations have no progress or cancel UI; the Tauri adapter currently creates its own cancellation token for each call.
- Diffs use a text, line-level view; syntax highlighting and word-level diffs are not yet available.
- There is no built-in credential dialog or terminal.

Detailed contracts: [Core API](docs/CORE_API.md), [Tauri integration](docs/TAURI_INTEGRATION.md).
