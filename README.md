# GitCat

Lightweight, Windows-first desktop Git client. Tauri v2 + React UI, Rust core, and system-installed Git. No AI, cloud patches, PR/issue panel, or arbitrary shell/Git commands.

> **Status:** functional MVP. `tauri dev` works with real repositories; the standalone Vite development page uses a built-in demo data source.

## Key features

- Repository tabs in folders or ungrouped: drag and drop, app-owned context actions, aliases, browser-style switching, automatic restoration, and reopening the most recently closed tab.
- LOCAL, REMOTE, and TAGS sidebar with filtering, a current-branch marker, remote-grouped remote branches with owner avatars, and a right-click branch menu for pull, push, branch creation, rename, safe deletion, and name copy.
- Compact, column-aligned commit DAG with colored lanes, a reserved HEAD lane so branches ahead of HEAD fork off it, relative time markers behind the lanes, WIP pseudo-node connected to HEAD, initials avatars, arrow-key stepping between the WIP row and history, and loading of older commits.
- Stash entries collapse into a single graph row each instead of the raw index/untracked helper commits.
- Double-click a local branch label in the graph to check that branch out.
- `Ctrl+F` search across commit subjects and full description/body text; matches stay highlighted while the rest of the graph dims.
- Commit details: click-to-copy SHA with full-object tooltip, author, timestamp, parents, statistics, Path/Tree changed files, and in-place commit message editing (reword).
- GitKraken-style structured diff: aligned inline/split views, line numbers, and rename/mode/binary/truncation states.
- WIP/working tree: separate collapsible staged/unstaged trees, optimistic staging with rollback on failure, per-file or bulk actions, separate summary and description fields, amend, sign-off, and discard-all.
- Changed-file context menu: stage/unstage, discard, ignore the file, extension, or folder, stash a single file, copy the path, and save a patch.
- Push and pull quick actions carrying ahead/behind counts, stash push and pop, and explicit pull modes: merge, fast-forward only, or rebase. Fetch and refresh are keybind-driven (`Ctrl+L`, `F5`).
- Commit context menu: detached checkout, branch/tag creation, cherry-pick, revert, a reset submenu (soft, mixed, hard), and full SHA copy.
- Continue or abort an in-progress merge/rebase/cherry-pick/revert.
- Read-only merge-conflict preflight plus an operation-aware Base/Ours/Theirs/result editor, guarded side selection, delete/stage actions, and conservative Git `rerere` reuse.
- Automatic refresh: the active repository's worktree and `.git` metadata are watched on disk, so commits, checkouts, and editor saves made outside GitCat appear without a manual refresh.
- Auto-fetch when a repository is opened and then on a timer (1 minute by default, `0` disables, 60 maximum) keeps ahead/behind counts and remote branches current. It runs silently in the background: no toasts, no blocked toolbar, and failures stay quiet. Switching back to an already-fetched tab reuses the last result until the interval elapses.
- Resizable panels, a persisted Path/Tree changed-files view mode, and customizable semantic UI, diff, and graph-lane colors.
- Hideable side panels, window-centered repository actions, configurable command keybinds, and persistent footer build identity.

Keyboard shortcuts:

- `Ctrl+Tab` / `Ctrl+Shift+Tab`: next / previous repository
- `Ctrl+1` … `Ctrl+9`: select repository by visual order
- `Ctrl+T` / `Ctrl+W` / `Ctrl+Shift+T`: open a new repository tab / close active repository / reopen the last closed repository
- `Ctrl+Shift+O`: open repository
- `Alt+O`: open the active repository's folder in the file explorer
- `Ctrl+F`: search commits
- `Ctrl+,`: settings
- `F5` / `Ctrl+L`: refresh repository / fetch
- `Ctrl+J` / `Ctrl+K`: toggle left / right panel
- `Ctrl+Shift+S` / `Ctrl+Shift+U`: stage all / unstage all
- `Ctrl+Enter`: commit from the working-tree panel
- `Esc`: close the open diff, then any open context menu
- With the graph focused: `↑`, `↓`, `Home`, `End`, `Enter`, `Shift+F10`

All registered shortcuts, including network, branch, stash, diff, conflict, and operation commands, can be changed or cleared under Preferences → Keybinds. See [UX implementation notes](docs/UX_IMPLEMENTATION.md) for the complete default table.

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

- `apps/desktop`: Vite/React UI, Tauri v2 adapter, and the single-repository filesystem watcher.
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
- Conflict-editor writes reject stale index stages or externally changed worktree content, preserve line endings, and atomically replace files before staging.
- External diff tools and textconv are disabled for read-only diffs.
- Allowed remote protocols: `file`, `git`, `http`, `https`, `ssh`; custom remote helpers are disabled.
- Credential prompts are disabled. A preconfigured Git Credential Manager or SSH agent is required.
- Auto-fetch is the only unattended network operation, it only ever runs `git fetch` on the active repository, and it is turned off by setting the interval to `0`.
- `reset --hard`, discarding changes, forced branch deletion, and stash drop require explicit confirmation plus a current matching snapshot. The core rejects stale dialogs.
- Rewording a commit is guarded by the same snapshot check, so it is rejected if the branch moved underneath the panel.
- The filesystem watcher observes one repository — the active one — ignores `.git/objects` and `.git/lfs` churn, debounces bursts, and only asks the UI to reload. It never runs Git on its own.
- GitCat does not modify the global `safe.directory` value or delete `.git/index.lock`.
- The Tauri main window receives only core and directory-open permissions; CSP blocks external object/frame/form content.

## MVP limitations

- The UI currently supports opening existing local repositories. Init/clone core and IPC are implemented, but there is no dedicated UI yet.
- A remote/upstream editor and annotated-tag message UI are not yet available; the core/IPC already partially supports them.
- Stashing is limited to push and popping the latest entry from the toolbar. Applying or dropping an arbitrary stash has core/IPC support but no panel.
- Network operations have no progress or cancel UI; the Tauri adapter currently creates its own cancellation token for each call.
- Diffs use a text, line-level view; syntax highlighting and word-level diffs are not yet available.
- There is no built-in credential dialog or terminal.
- Hosted provider profile pictures are not fetched without provider authentication; initials are used as the avatar fallback.

Detailed contracts: [Core API](docs/CORE_API.md), [Tauri integration](docs/TAURI_INTEGRATION.md), [GitKraken UX research](docs/GITKRAKEN_UX_RESEARCH.md), and [UX implementation notes](docs/UX_IMPLEMENTATION.md).
