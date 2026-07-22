# Core API contract

## Lifecycle

1. Create `GitCliBackend` and `CoreApi`.
2. `probe()` checks Git availability and version.
3. `open_repository(path)`, `init_repository(...)`, or `clone_repository(...)` registers a repository.
4. The returned `RepositoryId` is required for every subsequent call.
5. When the last UI tab closes, `close_repository(id)` releases the registry entry.

The registry canonicalizes the repository root. Read calls can run concurrently. Mutations within a repository are serialized; mutations in separate repositories can run concurrently.

Bare repositories are not supported by this worktree-oriented API; the response is `unsupported_operation`.

## Main read calls

- `snapshot`: HEAD/unborn/detached state, in-progress operation, worktree, LOCAL/REMOTE branches, tags, remotes, and capabilities.
- `history`: topological commit page. Default size is 200, with a hard maximum of 500. The cursor carries the ref generation and graph lane state; a ref change invalidates old cursors.
- `search_commits`: case-insensitive literal fixed-string search across the subject and full body. No regex interpretation.
- `commit_details`: identities, dates, parents, message/body, file list, and statistics.
- `diff`: a single path with structured hunks and line numbers for an inline or split UI.
- `conflict_preflight`: read-only merge prediction between committed HEAD and an explicitly resolved target. It returns `clean`, `conflicting`, or `unavailable` and never changes the index, worktree, refs, or HEAD.
- `conflict_details`: bounded Base/stage-2/stage-3/current-result content plus exact index and worktree identities for guarded resolution.
- `stash_list`: stable stash index/OID/message entries.

History returns DAG/lane data, not pixels or colors. The UI chooses colors by lane number from the configured `graph_palette`.

## Write calls

- stage/unstage, commit/amend/sign-off;
- branch create/checkout/rename/delete, upstream, and merge;
- fetch, pull, push;
- commit checkout, tag, cherry-pick, revert, and reset;
- merge/rebase/cherry-pick/revert continue or abort;
- resolve a conflict from index stage 2/3, stage the reviewed working copy, delete it, save an edited text result, or reuse exact repository-local `rerere` records;
- stash push/apply/pop/drop.

## Pull behavior

`PullMode` is always explicit:

- `merge`: `git pull --no-rebase --ff`
- `fast_forward_only`: `git pull --ff-only --no-rebase`
- `rebase`: `git pull --rebase`

The result never silently depends on the global `pull.rebase` value. `autostash` is a separate option and defaults to false. Network ports accept cancellation tokens; the current Tauri UI does not expose cancellation.

## Commit context menu

Minimum backend support:

- check out a commit in detached HEAD state;
- create a branch or tag at a commit;
- cherry-pick;
- revert;
- reset the current branch: `soft`, `mixed`, guarded `hard`;
- copy SHA: the UI copies the OID it already received.

AI recomposition, historical message editing, drop/reorder, PR creation, cloud sharing, and worktree creation are intentionally outside the MVP scope. `commit_action_availability` lets the UI disable unsafe actions and display a reason.

## Diff contract

`DiffRequest` selects exactly one repository-relative path and one target:

- worktree vs index;
- index vs HEAD;
- worktree vs HEAD;
- commit vs selected parent;
- commit vs commit.

The response contains file status, old/new paths and modes, a binary flag, statistics, hunks, old/new line numbers, a no-newline marker, and truncation state. A request resolving to multiple files is invalid; the UI requests each file's diff separately. Inline/split layout, syntax highlighting, and word-level diffs are UI responsibilities.

## Optimistic safety

A snapshot carries its generation and HEAD. The UI captures it as `ExpectedState` before destructive confirmation. Forced branch deletion, reset, and stash drop require this state; the core rereads the snapshot under the repository mutation lock and rejects stale operations.

Mutations in a shared Git directory are serialized. The same guard can later cover additional mutations without DTO changes.

Conflict editing uses a narrower per-file guard in addition to the repository snapshot. `ConflictExpectedState` carries Base/Ours/Theirs OID+mode identities and the current result's kind, size, SHA-256, line-ending, and Unix mode-bit identity. Every side selection, stage, delete, and edited save rereads these values under the mutation lock and rejects a mismatch as `stale_snapshot`.

Edited conflict text is limited to 1 MiB. Regular-file inspection streams the full SHA-256 in a blocking worker while retaining only a bounded preview. A save writes a temporary file in the destination directory, flushes and syncs it, preserves existing permissions, atomically persists it, and stages only after persistence succeeds. New files use creation-time permissions so Unix umask restrictions remain effective. LF and CRLF can be preserved; an edited mixed-EOL file requires an explicit LF or CRLF policy.

## Stable errors

The UI switches on `ErrorCode`, not raw Git stderr. Important codes:

- `invalid_repository`, `repository_closed`, `invalid_ref_name`, `invalid_revision`;
- `stale_snapshot`, `dirty_worktree`, `conflicts_present`, `operation_in_progress`;
- `upstream_missing`, `authentication_required`, `network_failed`, `non_fast_forward`;
- `protected_operation`, `cancelled`, `timeout`, `output_too_large`.

Diagnostic stderr is bounded, credential-redacted, and available only as optional detail.

## Persistent UI state

`JsonStateStore` atomically saves `PersistedState`:

- repository tab groups, order, collapsed state, and active tab;
- ungrouped repository tabs, per-tab conflict target/disabled state, and tab aliases;
- default pull mode, auto-fetch/prune, and history/diff limits;
- all command keybindings, including unassigned entries;
- semantic colors and graph palette.

The Tauri host provides the `app_data_dir/state.json` path. The core does not invent a path or write outside it.
