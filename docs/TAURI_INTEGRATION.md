# Tauri v2 integration

The adapter lives in `apps/desktop/src-tauri`. It is a thin boundary: it owns the `Arc<CoreApi>` and `JsonStateStore` state, registers typed commands, and returns DTOs to the React client. There is no local HTTP server, shell permission, or general-purpose Git command endpoint.

## Startup

`run()` performs these steps:

1. Initialize `tauri-plugin-dialog`, `tauri-plugin-process`, and `tauri-plugin-updater`.
2. Create a `JsonStateStore` backed by `<app_data_dir>/state.json`.
3. Create `GitCliBackend` and `CoreApi`.
4. Configure `catninth-updater`, retain its polling handle, and register the typed command handler list.
5. Start the main window.

Opening a repository returns:

```ts
interface OpenedRepository {
  repository_id: string;
  info: RepositoryInfo;
}
```

Every subsequent repository call receives a `repository_id`, not an arbitrary working directory.

## Registered commands

Repository:

- `app_metadata`
- `get_update_state`, `check_update`, `install_update`
- `git_probe`
- `repository_open`, `repository_init`, `repository_clone`, `repository_close`
- `repository_snapshot`

History and diff:

- `history_page`, `history_search`
- `commit_details`, `file_diff`
- `conflicts_preflight`, `conflict_details`

Working tree and commit:

- `paths_stage`, `paths_unstage`, `create_commit`
- `conflict_resolve`, `conflict_save_edited`, `conflicts_auto_resolve`

Branch and remote:

- `branch_create`, `branch_checkout`, `branch_rename`, `branch_delete`
- `branch_set_upstream`, `branch_merge`
- `remote_fetch`, `remote_pull`, `remote_push`

Commit operations:

- `commit_checkout`, `tag_create`
- `commit_cherry_pick`, `commit_revert`, `commit_reset`
- `commit_action_availability`

In-progress operation and stash:

- `operation_continue`, `operation_abort`
- `stash_list`, `stash_push`, `stash_apply`, `stash_drop`

Persistent state:

- `persisted_state_load`, `persisted_state_save`

The frontend's typed wrapper is `apps/desktop/src/lib/api.ts`. Rust `snake_case` field names reach TypeScript unchanged.

## Native and browser runtimes

`getGitCatRuntime()` selects automatically:

- Tauri webview: `createTauriGitCatApi()`, real IPC and system Git.
- Standard browser/Vite: `createDemoGitCatApi()`, an in-memory fixture repository and `localStorage` workspace.

This allows the UI to be tested independently, but the browser runtime is not a Git client and does not access local repositories.

## Frontend data flow

When switching repositories, the frontend requests these in parallel:

- snapshot;
- first history page;
- stash list.

When selecting a commit, commit details and action availability arrive in parallel. A diff loads only for the selected repository-relative file. The history cursor carries lane state; after a ref change, the backend may reject a stale cursor.

Conflict preflight is cached by repository HEAD OID, selected target, and target OID. It calls read-only `merge-tree`; active conflict detail/save/resolve commands are serialized mutations with exact index/worktree stale-state guards.

## Persistent workspace

The core writes `state.json` atomically. It contains:

- repository groups, ordering, collapsed state, and active tab;
- ungrouped tabs, aliases, and per-tab conflict comparison target;
- pull mode and performance limits;
- the complete keybind registry;
- semantic UI/diff colors and graph palette.

The frontend saves after a 250 ms debounce. At startup, it reopens tab paths; a missing or moved repository appears as an error while the other tabs continue working.

## Permissions and CSP

`capabilities/default.json` grants the main window only:

- `core:default`
- `dialog:allow-open`
- `dialog:allow-save`
- `process:allow-restart`

There are no shell or filesystem plugin permissions. Only the Rust backend starts Git processes. The production CSP allows only first-party/IPC/asset content; objects, frames, base URIs, and form actions are blocked. The CSP does not need an entry for the update endpoint: the updater's HTTP traffic runs in the Rust process, not in the webview.

## Auto-update

The native integration in `apps/desktop/src-tauri/src/updater.rs` uses
[`catninth-updater`](https://github.com/catninth/updater), pinned to a Git revision in
`Cargo.toml` and `Cargo.lock`. No sibling checkout is required. Windows NSIS and
Linux AppImage, `.deb`, and `.rpm` packages use the stable release channel.

- Repository: `catninth/gitcat`. `CHECK_INTERVAL_MINUTES` is 360, with a four-second first-check delay. Change these consumer constants to configure the source and schedule.
- The library reads the latest stable GitHub release and its Markdown body. It downloads `latest.json` from that exact release tag when the user requests installation, so a later release cannot change the selected version mid-install.
- Update payloads are minisign-signed; the public key lives in `tauri.conf.json` under `plugins.updater.pubkey`. The private key and its passphrase are the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets. The passphrase must not be empty: an empty value is not a settable environment variable on Windows, so the Tauri CLI would fall back to an interactive prompt and the build would hang.
- `bundle.createUpdaterArtifacts` enables signed updater artifacts. The release workflow explicitly signs any Linux package the bundler leaves unsigned. The manifest includes package-specific Linux targets and the legacy `linux-x86_64` AppImage target.
- The native Tauri adapter verifies signatures and selects the installed package type. Linux `.deb`/`.rpm` installation requests elevation through `pkexec`.
- NSIS `installMode` remains `passive`. The Windows before-exit hook releases the single-instance lock before handing off to the installer. On Linux/macOS, the after-install hook releases that lock before restarting. The library supports macOS, but GitCat's release workflow currently builds Windows and Linux only.
- The app version comes from the workspace `Cargo.toml`; `tauri.conf.json` intentionally has no `version` field so there is a single source of truth.

The frontend hook is `apps/desktop/src/lib/updates.ts` (`useAppUpdate`). Its client
subscribes to `app-update` before requesting `get_update_state` and ignores stale
snapshots or command errors after newer events. `check_update` and `install_update`
call the native library; there is no JavaScript updater plugin or polling timer.
The backend prevents overlapping checks and installs and continues polling even
when the frontend remounts. Downloads still require a click in `UpdateIndicator`.
The browser demo remains inert. The native adapter publishes only visible state
changes, including download percentage, installation, and errors.

Native tests cover state mapping, version precedence, retry metadata, and progress.
`npm run test:graph` includes client tests for event/snapshot races, concurrent
actions, errors, and listener cleanup.

The release workflow is `.github/workflows/release.yml`. Triggered manually with `publish: true`, it builds Windows and Linux, merges both signatures into one `latest.json`, and creates the `v<version>` GitHub release with the installer, the AppImage, `.deb`, `.rpm`, the `.sig` files, and the manifest. A daily schedule publishes the same set as a rolling `nightly` pre-release, which the updater ignores because only full releases become `releases/latest`.

Installers are not Authenticode-signed, so SmartScreen warns on each update.

## Error propagation

Commands return `ApiResult<T>`. The frontend handles errors by `ErrorCode`; bounded/redacted `details` are for diagnostics only. Raw stderr is not a control API.

Important: `GIT_TERMINAL_PROMPT=0`. Authentication requires a preconfigured Git Credential Manager or SSH agent; there is no interactive password prompt.

## Current adapter limitations

- Fetch/pull/push/clone receives a fresh `CancellationToken`, but there is no separate cancel command or UI.
- There is no progress/repository-change event stream; the UI requests a new snapshot after an operation.
- Init and clone commands are implemented, but the current welcome UI only opens existing repositories.
- Stash apply/drop and upstream/merge commands are implemented, but the full UI is not yet available.
- Provider-hosted avatars and external merge-tool launching are not integrated.

## Adding a new command

1. Add the DTO to the `gitcat-contracts` crate.
2. Add safety and serialization logic to the `gitcat-core` layer.
3. Put Git-specific details behind the `GitBackend` port and `gitcat-git-cli` adapter.
4. Add a typed `#[tauri::command]`, then include it in the `generate_handler!` list.
5. Add the matching TypeScript type and `GitCatCommands` wrapper.
6. Verify the native adapter, core, and frontend.

Never add a `run_git(cwd, args)` endpoint or shell escape hatch.
