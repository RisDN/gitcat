# GitKraken UX research and GitCat decisions

Research date: 2026-07-22

This is the research and design record, so some bullets describe the recommended complete product surface rather than the exact scope of this delivery. The implemented subset and verified behavior are tracked in [UX implementation notes](UX_IMPLEMENTATION.md).

This document separates three kinds of evidence:

- **Verified GitKraken behavior** comes from current GitKraken help pages or product pages.
- **Reference-capture observation** comes from the screenshots supplied with this task. Pixel values are approximate, not published GitKraken design tokens.
- **GitCat decision** is the behavior GitCat should implement. It may intentionally improve on or differ from GitKraken.

## Summary

- Use one compact, fixed-height row model for commit text, graph nodes, selection, and WIP. Selecting a row must never change graph geometry.
- Make the abbreviated commit hash itself the copy control. Hover/focus shows the full object ID and copy instruction.
- Suppress WebView/browser context menus globally. Repository tabs get an application-owned menu, including move to folder and no-folder placement.
- Keep repository-folder support as a GitCat feature. GitKraken groups repositories through Workspaces, but current documentation does not show browser-style tab folders.
- Mirror GitKraken's WIP model: a pseudo-node above HEAD plus a commit panel split into Unstaged Files, Staged Files, and commit message.
- Offer Path and Tree presentations over one changed-file data model.
- Add proactive conflict status and an operation-aware resolver. Never silently choose one side of an ambiguous conflict.
- Center repository action buttons against the full window, not the remaining space between side content.
- Add a complete Keybinds settings section backed by a central command registry.
- Show GitCat version and build commit in the footer. This is build identity, not the selected repository's HEAD.

## 1. Commit hash copy interaction

### Verified GitKraken behavior

GitKraken can display a SHA column in the graph, and its commit context menu includes `Copy commit SHA`. Current official material does not document clicking the visible SHA to copy it, nor a full-SHA hover tooltip.

Sources:

- [GitKraken interface: graph columns](https://help.gitkraken.com/gitkraken-desktop/interface/)
- [GitKraken Commit Graph: context-menu copy actions](https://www.gitkraken.com/features/commit-graph)

### GitCat decision

- Remove the separate copy icon next to the commit hash.
- Render the abbreviated hash as a semantic button with monospace text and `cursor: pointer`.
- Hover and keyboard focus show a tooltip containing:
  - the complete object ID returned by Git, without assuming a fixed 40-character length;
  - `Click to copy` or the localized equivalent.
- Click, `Enter`, or `Space` copies the complete object ID, never the abbreviated label.
- Confirm success with a short `Commit hash copied` toast and an optional transient `Copied` tooltip state.
- Show an error toast if clipboard access fails.
- Accessible name: `Copy full commit hash <abbreviated-hash>`.

This is a requested GitCat improvement, not claimed GitKraken parity.

## 2. Repository tabs, folders, and context menus

### Verified GitKraken behavior

GitKraken repository tabs can be reordered with drag-and-drop. It supports new/close tab shortcuts, direct `Ctrl/Cmd+1-9` selection, middle-click close, path tooltips, and a right-click `Alias repository` action. Local and Cloud Workspaces group repositories in Repository Management and support names, colors, reordering, and bulk actions.

GitKraken does **not** currently document browser-style tab groups or folders. Its official feedback item for grouped tabs remains `Under consideration`. Therefore, GitCat's existing foldered top bar must not be described as exact GitKraken behavior.

Sources:

- [GitKraken interface: tabs and aliases](https://help.gitkraken.com/gitkraken-desktop/interface/)
- [GitKraken Workspaces](https://help.gitkraken.com/gitkraken-desktop/workspaces/)
- [Official GitKraken feedback: groups of tabs](https://feedback.gitkraken.com/suggestions/200670/support-groups-of-tabs)

### GitCat decision

Suppress the WebView/browser menu for every `contextmenu` event. Components may replace it with GitCat menus. Right-clicking empty/non-interactive UI does nothing. Text inputs may use a GitCat-owned edit menu (`Undo`, `Redo`, `Cut`, `Copy`, `Paste`, `Select all`) so native editing actions are not lost.

Right-clicking an open repository tab opens this application menu:

1. `Move to folder`
   - `No folder`
   - each existing folder, with the current destination checked/disabled
   - separator
   - `New folder...`
2. `Rename / alias...`
3. `Reveal in File Explorer` (platform-localized label)
4. separator
5. `Close`
6. `Close other repositories`
7. `Close repositories to the right`

Menu behavior:

- Anchor at pointer position; keep inside viewport.
- Close on selection, outside click, `Escape`, or tab removal.
- Support keyboard navigation and `Shift+F10`/Context Menu key.
- Moving a tab changes workspace organization only. It must never move the repository directory on disk.
- `No folder` is a real root state, not a user-visible folder named "No folder".
- Persist folder, tab order, collapsed state, and active tab.

### Pre-implementation GitCat model implication

Before this implementation, GitCat stored tabs only inside repository groups. A true no-folder state therefore needed either:

- a flat tab collection with nullable `group_id` (**preferred**), or
- a reserved internal root bucket that renders without a folder label.

Do not overload the first normal group as "ungrouped"; users must be able to rename/delete/reorder normal folders without changing root semantics.

## 3. Repository keyboard navigation

### Verified GitKraken behavior

GitKraken documents:

- next open tab: `Ctrl+Tab` / `Cmd+Tab`;
- previous open tab: `Ctrl+Shift+Tab` / `Cmd+Shift+Tab`;
- tab 1-9: `Ctrl/Cmd+1-9`;
- new tab: `Ctrl/Cmd+T`;
- close tab: `Ctrl/Cmd+W`.

Source: [GitKraken keyboard shortcuts](https://help.gitkraken.com/gitkraken-desktop/keyboard-shortcuts/)

### GitCat decision

- `Ctrl+Tab` selects the next open repository in visual workspace order and wraps at the end.
- `Ctrl+Shift+Tab` selects the previous repository and wraps at the start.
- Include tabs inside collapsed folders. Activating one must make its identity visible; expanding the destination folder is the clearest behavior.
- Prevent the WebView default after a matching command executes.
- Do not disable tab switching because a text field is focused. Do disable it while the keybinding recorder is capturing a new shortcut.
- Use the same command path for mouse selection, direct tab shortcuts, and next/previous navigation.

## 4. Compact commit rows, graph alignment, and avatars

### Verified GitKraken behavior

GitKraken describes each graph row as one commit and exposes rearrangeable Branch/Tag, Graph, Commit Message, Author, Date/Time, and SHA columns. Column selections, widths, and order are saved per repository. Avatar display can be changed to initials in UI preferences.

Sources:

- [GitKraken interface: Commit Graph and columns](https://help.gitkraken.com/gitkraken-desktop/interface/)
- [GitKraken profiles and avatar behavior](https://help.gitkraken.com/gitkraken-desktop/profiles/)

### Reference-capture observation

Approximate dimensions in the supplied GitKraken captures:

- row height: `28px`;
- graph/avatar node: `20px`;
- graph line: `2px`;
- column header: about `22px`;
- selected background spans the entire row without moving the graph lane.

These are targets, not authoritative GitKraken tokens.

### GitCat decision

- Define one shared row-height constant for DOM rows, graph SVG/canvas, WIP, virtualization, focus outline, and selection overlay.
- Place every graph node at `rowIndex * rowHeight + rowHeight / 2`.
- Calculate lane X only from graph topology and column/lane widths. Selected state, text length, branch pills, and side-panel state must not affect it.
- Selection changes color only. Use an absolutely positioned overlay or inset shadow; never add margin, padding, or a new border that changes layout.
- Render all columns in the same CSS grid row, or use explicitly synchronized row geometry if graph and text are separate layers.
- Vertically center commit message, author, date, and hash on one baseline. Truncate long values rather than increasing row height.
- Put author avatar/initials inside the commit node, matching the supplied GitKraken reference. Keep a generic node fallback when no image is available.
- Add a visual regression test: node center X before and after selecting a commit must differ by exactly `0px`.

## 5. WIP node and staged/unstaged workflow

### Verified GitKraken behavior

GitKraken shows a WIP node at the top of the Commit Graph when working-directory changes exist. Selecting it opens the Commit Panel. The panel order is:

1. Unstaged Files
2. Staged Files
3. Commit Message

Whole files, hunks, or selected lines can be staged/unstaged. GitKraken provides stage-all and unstage-all actions.

Sources:

- [GitKraken committing workflow](https://help.gitkraken.com/gitkraken-desktop/commits/)
- [GitKraken staging workflow](https://help.gitkraken.com/gitkraken-desktop/staging/)
- [GitKraken interface: Commit Panel](https://help.gitkraken.com/gitkraken-desktop/interface/)

### GitCat decision

Graph WIP row:

- Exists only when staged or unstaged changes exist.
- Uses the same compact row geometry as commits.
- Shows a dashed/hollow WIP node connected vertically to HEAD.
- Message is `// WIP` plus a change icon and total changed-file count.
- Selecting it opens the staging panel and highlights the full WIP row.

Right commit panel:

- Header shows total file changes and current branch.
- `Unstaged Files (N)` and `Staged Files (N)` are independently collapsible.
- Unstaged header exposes `Stage all changes`; staged header exposes `Unstage all changes`.
- File hover/context actions stage, unstage, discard, ignore, or open diff according to state.
- Commit summary and description remain below both lists.
- Graph WIP count and panel counts must derive from the same repository snapshot.
- A clean working tree removes the WIP pseudo-row and shows a clear empty state in the commit panel.

## 6. Changed files: Path and Tree views

### Verified/observed GitKraken behavior

GitKraken documentation explicitly refers to Tree view in the staging panel and `View all files`; the supplied captures show a segmented `Path | Tree` control, alphabetical sorting, expandable directories, `Expand All`, and aggregate change counts.

Sources:

- [GitKraken staging and Tree view](https://help.gitkraken.com/gitkraken-desktop/staging/)
- [GitKraken add/delete/filter files](https://help.gitkraken.com/gitkraken-desktop/adding-and-removing/)

### GitCat decision

- Use one segmented `Path | Tree` control in both historical Changed Files and WIP staging lists.
- Path view is a flat, alphabetically sortable list of repository-relative paths.
- Tree view splits paths by `/`, renders directories before files, aggregates descendant change counts/status, and supports expand/collapse plus `Expand all`/`Collapse all`.
- Never infer the tree from truncated display text; build it from complete normalized repository-relative paths.
- Keep file selection and opened diff stable when switching view mode.
- Persist the preferred mode, preferably per repository.
- Tree folder actions apply to descendant files, with confirmation for discard operations.

## 7. Collapsible left and right panels

### Verified GitKraken behavior

GitKraken documents `Ctrl/Cmd+J` for the Left Panel and `Ctrl/Cmd+K` for the Commit Detail panel. Left Panel sections can also be resized, collapsed/expanded, hidden through a context menu, and maximized by double-clicking a header.

Sources:

- [GitKraken keyboard shortcuts](https://help.gitkraken.com/gitkraken-desktop/keyboard-shortcuts/)
- [GitKraken interface: Left Panel](https://help.gitkraken.com/gitkraken-desktop/interface/)

### GitCat decision

- Add visible collapse buttons on both outer panel edges.
- `Ctrl+J` toggles the full left panel; `Ctrl+K` toggles the full right details/commit panel.
- Persist collapsed state and last non-zero width. Expanding restores the previous width.
- Keep resize handles available only while expanded.
- Commit graph takes released space immediately; graph rows and lane X remain internally consistent.
- Tooltips include configured shortcuts, not hard-coded labels.

## 8. Conflict indicator, preflight detection, and resolution

### Verified GitKraken behavior

GitKraken Conflict Prevention displays an alert/status icon, checks the current branch against a target branch, and offers early merge/rebase actions. During an active conflict, the Commit Panel lists conflicted files. Its resolver displays current content on the left, incoming/target content on the right, and editable output below. Users can select lines from either side, save the output, or quick-resolve a file with `Take current` / `Take incoming`.

GitKraken's AI auto-resolve generates a **suggestion** with explanation and confidence; users review, edit, accept, or discard it. It is not evidence for silently applying arbitrary conflict choices.

Sources:

- [GitKraken Conflict Prevention](https://help.gitkraken.com/gitkraken-desktop/conflict-prevention/)
- [GitKraken merge and conflict editor](https://help.gitkraken.com/gitkraken-desktop/branching-and-merging/)
- [GitKraken AI conflict resolution](https://help.gitkraken.com/gitkraken-desktop/gkd-gitkraken-ai/)

### GitCat decision

Conflict toolbar indicator states:

- checking;
- no predicted conflicts, with tooltip naming the comparison target;
- predicted conflicts, with warning color and file count;
- active merge/rebase/cherry-pick conflicts, with stronger danger state and unresolved count;
- target unavailable/not configured.

Target selection order:

1. explicit repository merge target;
2. provider/PR target when available;
3. remote default branch (`origin/HEAD`);
4. unavailable state rather than guessing a destructive target.

Use `git merge-tree --write-tree` for read-only preflight where supported. It performs merge logic without touching the working tree or index and reports clean/conflicted status plus conflict records. Parse stable machine output (`-z` where available), not localized human messages.

Source: [Git `merge-tree` documentation](https://git-scm.com/docs/git-merge-tree.html)

Active resolver:

- List unresolved index entries and conflict type.
- Show Base / Current branch / Incoming branch data where available, with branch/commit names.
- Offer per-hunk selection and an editable result.
- Offer per-file `Take <branch-name>` quick actions and external merge-tool launch.
- For binary conflicts, offer side selection or external tool; no text editor.
- Saving a reviewed result stages the file and decrements unresolved count.
- When all files are resolved, expose the operation-specific Continue/Commit action and Abort.

Important: raw `ours`/`theirs` labels are unsafe during rebase because their meaning is reversed from many users' expectation. Always show concrete branch/commit labels. Git documents that `--ours` and `--theirs` appear swapped during rebase/pull-rebase.

Source: [Git checkout conflict-side semantics](https://git-scm.com/docs/git-checkout)

Automatic resolution policy:

- Let Git apply every clean three-way merge automatically.
- Support `rerere` only behind an explicit **Auto-resolve** action. GitCat may request `rerere.autoupdate` so an exact, previously recorded resolution is staged, but must keep the staged diff reviewable and must not continue/commit the operation automatically.
- Never silently choose current or incoming for a genuinely ambiguous conflict.
- AI output, if ever added, is a suggestion requiring review.

Source: [Git `rerere` documentation](https://git-scm.com/docs/git-rerere)

## 9. Toolbar placement

### Verified GitKraken behavior

GitKraken's main toolbar exposes Undo, Redo, Pull, Push, Branch, Stash, and Pop Stash; Fetch is available from the Pull/Fetch control. Official text describes contents but does not publish an exact centering rule.

Source: [GitKraken interface: toolbar](https://help.gitkraken.com/gitkraken-desktop/interface/)

### GitCat decision

- Keep repository/branch identity left.
- Keep operation state, search, and settings right.
- Center Refresh/Fetch/Pull/Push/Branch/Stash against the **full window viewport**, not the flexible space remaining between left and right content.
- Use a three-layer layout: left content, absolutely centered primary action cluster (`left: 50%`, translate X), and right content.
- At narrow widths, collapse labels or move lower-priority actions into overflow before the centered cluster overlaps either side.
- Side-panel collapse must not move the action cluster.

Exact pixel centering is a GitCat requirement inferred from the supplied reference, not a documented GitKraken contract.

## 10. Configurable keybindings

### Verified GitKraken behavior and divergence

GitKraken publishes built-in shortcuts, but current preferences documentation does not describe user remapping. Its official customization request remains `Under consideration`. GitCat should implement configurable keybindings rather than copy that limitation.

Sources:

- [GitKraken keyboard shortcuts](https://help.gitkraken.com/gitkraken-desktop/keyboard-shortcuts/)
- [Official GitKraken feedback: customize keyboard shortcuts](https://feedback.gitkraken.com/suggestions/284988/customize-keyboard-shortcuts)

### GitCat settings UX

- Add a dedicated `Keybinds` settings section.
- Back it with one command registry used by toolbar buttons, menus, tooltips, and keyboard dispatch.
- Group commands: General, Repositories/Tabs, Graph, Panels, Working Tree, Diff/Merge.
- Provide search, record/edit, clear, per-command reset, and reset-all.
- Detect conflicts before save. Allow duplicate keys only for explicitly disjoint focus contexts.
- During recording: show pressed modifiers, `Escape` cancels, `Backspace/Delete` clears.
- Do not trigger single-letter graph/file commands while an input, textarea, select, or contenteditable element has focus.
- Reserve OS-level shortcuts such as `Alt+F4`, `Ctrl+Alt+Delete`, and `Cmd+Q` from reassignment.
- Render platform labels (`Ctrl` on Windows/Linux, `Cmd` on macOS) from one canonical binding representation.
- Tooltips must read live bindings.

Recommended Windows/Linux defaults, aligned with GitKraken where it has an equivalent:

| Command | Default |
| --- | --- |
| Next repository | `Ctrl+Tab` |
| Previous repository | `Ctrl+Shift+Tab` |
| Repository 1-9 | `Ctrl+1` ... `Ctrl+9` |
| New repository tab | `Ctrl+T` |
| Close repository | `Ctrl+W` |
| Open repository | `Ctrl+Shift+O` |
| Search commits / focused file | `Ctrl+F` |
| Open settings | `Ctrl+,` |
| Open keyboard shortcuts | `Ctrl+/` |
| Command palette, if present | `Ctrl+P` |
| Refresh repository | `F5` |
| Create branch | `Ctrl+B` |
| Fetch all | `Ctrl+L` |
| Stage current file | `S` |
| Stage all | `Ctrl+Shift+S` |
| Unstage current file | `U` |
| Unstage all | `Ctrl+Shift+U` |
| Commit staged files | `Ctrl+Enter` |
| Stage all and commit | `Ctrl+Shift+Enter` |
| Focus commit message | `Ctrl+Shift+M` |
| Open diff / merge tool | `Ctrl+D` |
| Toggle left panel | `Ctrl+J` |
| Toggle right panel | `Ctrl+K` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Y`, alternate `Ctrl+Shift+Z` |
| Full screen | `F11` |
| Close active overlay/panel | `Escape` |

Destructive commands such as discard, hard reset, branch deletion, and abort should be configurable but unassigned by default. `Unassigned` is the safest default, not a missing implementation.

## 11. Footer version and build commit

### GitKraken comparison

GitKraken documentation mentions status-bar controls such as zoom and Launchpad, but current official material does not establish a persistent app-version plus build-commit label. This is a GitCat-specific requirement.

### GitCat decision

- Always show `GitCat v<semver> · build <short-oid>` in the bottom status bar.
- Tooltip shows full build object ID and, if available, build timestamp.
- Label it `build` so it cannot be confused with the active repository's HEAD.
- Read version from one authoritative package/build source. Keep Cargo, Tauri config, and package metadata synchronized.
- Inject build commit during build/CI. Do not run `git` at packaged-app runtime because `.git` may be absent.
- If build identity is unavailable, show `build unknown` without breaking startup.
- Optional: clicking build SHA uses the same full-hash copy interaction as commit hashes.

## 12. Avatar exception

GitKraken uses provider avatars when a supported integration is connected; otherwise it falls back to the Gravatar associated with the profile email. Users can choose initials instead.

Source: [GitKraken profiles and avatars](https://help.gitkraken.com/gitkraken-desktop/profiles/)

The missing GitCat provider avatar may therefore be caused by the lack of GitHub/provider authentication, as suspected. Per request, provider login and avatar fetching are out of scope for this work. Keep the existing deterministic initials fallback. Do not block compact graph-row work on remote avatar support.

## Acceptance checks

- Clicking any commit does not move any graph lane or change any row height.
- SHA hover/focus shows full object ID; click copies full value; no separate copy button remains.
- Native browser context menu never appears. Repository tabs show the GitCat menu.
- A repository can move between every folder and root/no-folder state, and placement survives restart.
- `Ctrl+Tab` and `Ctrl+Shift+Tab` wrap through all open repositories.
- WIP and right-panel staged/unstaged counts always agree.
- Path/Tree toggle preserves selected file and opened diff.
- Left/right panels restore previous width after collapse/expand.
- Conflict preflight never mutates index or working tree.
- Ambiguous conflicts require explicit user choice; reused resolutions remain reviewable as staged diffs and never auto-continue the operation.
- Toolbar primary actions remain at viewport center while side panels change.
- Every displayed shortcut comes from current settings, and duplicate bindings are rejected or explicitly scoped.
- Footer version/build identity is present in packaged builds without requiring a `.git` directory.
