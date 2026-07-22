# Tauri v2 integration

The adapter lives in `apps/desktop/src-tauri`. It is a thin boundary: it owns the `Arc<CoreApi>` and `JsonStateStore` state, registers typed commands, and returns DTOs to the React client. There is no local HTTP server, shell permission, or general-purpose Git command endpoint.

## Startup

`run()` performs these steps:

1. Initialize `tauri-plugin-dialog`.
2. Create a `JsonStateStore` backed by `<app_data_dir>/state.json`.
3. Create `GitCliBackend` and `CoreApi`.
4. Register the typed command handler list.
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

- `git_probe`
- `repository_open`, `repository_init`, `repository_clone`, `repository_close`
- `repository_snapshot`

History and diff:

- `history_page`, `history_search`
- `commit_details`, `file_diff`

Working tree and commit:

- `paths_stage`, `paths_unstage`, `create_commit`

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

## Persistent workspace

The core writes `state.json` atomically. It contains:

- repository groups, ordering, collapsed state, and active tab;
- pull mode and performance limits;
- semantic UI/diff colors and graph palette.

The frontend saves after a 250 ms debounce. At startup, it reopens tab paths; a missing or moved repository appears as an error while the other tabs continue working.

## Permissions and CSP

`capabilities/default.json` grants the main window only:

- `core:default`
- `dialog:allow-open`

There are no shell, filesystem, or process plugin permissions. Only the Rust backend starts Git processes. The production CSP allows only first-party/IPC/asset content; objects, frames, base URIs, and form actions are blocked.

## Error propagation

Commands return `ApiResult<T>`. The frontend handles errors by `ErrorCode`; bounded/redacted `details` are for diagnostics only. Raw stderr is not a control API.

Important: `GIT_TERMINAL_PROMPT=0`. Authentication requires a preconfigured Git Credential Manager or SSH agent; there is no interactive password prompt.

## Current adapter limitations

- Fetch/pull/push/clone receives a fresh `CancellationToken`, but there is no separate cancel command or UI.
- There is no progress/repository-change event stream; the UI requests a new snapshot after an operation.
- Init and clone commands are implemented, but the current welcome UI only opens existing repositories.
- Stash apply/drop and upstream/merge commands are implemented, but the full UI is not yet available.

## Adding a new command

1. Add the DTO to the `gitcat-contracts` crate.
2. Add safety and serialization logic to the `gitcat-core` layer.
3. Put Git-specific details behind the `GitBackend` port and `gitcat-git-cli` adapter.
4. Add a typed `#[tauri::command]`, then include it in the `generate_handler!` list.
5. Add the matching TypeScript type and `GitCatCommands` wrapper.
6. Verify the native adapter, core, and frontend.

Never add a `run_git(cwd, args)` endpoint or shell escape hatch.
