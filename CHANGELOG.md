# GitCat 1.2.0

## Features

- Added a repository start page with recent repositories, clone and init flows, a path picker and `.gitignore` templates.
- Added a built-in updater that checks for new releases, surfaces an update indicator in the shell and installs updates in place.
- Added split, inline and hunk diff views, selectable per file, with independently scrollable split panes sized to their content.
- Added syntax highlighting to diffs through a new tokenizer.
- Added a change map to whole-file diff views.
- Added folders to the local branch list, with subfolders expanding together.
- Added fast branch switching for branches that only exist on the remote.
- Added window state persistence, so position and size are restored on the next launch.
- Added the missing repository page to the navigation.
- The selected diff view is now remembered across sessions.
- Commit descriptions are shown in graph rows and co-authors in the details panel.
- Added a 72-character counter to the commit summary input.
- Added a confirmation prompt before destructive branch deletion in the top bar.
- Added bulk conflict resolution: mark every conflicted file resolved, or take one side, for all conflicts or for a folder.
- Added rebase progress to the operation banner, showing the stopped commit and its position in the rebase.
- Added a skip action for the commit a rebase, cherry-pick or revert stopped on.
- Added `scripts/build-all.ps1` and an npm script for one-command builds.

## Improvements

- Improved diff view support when staging commits.
- Replaced the diff view back button with a close icon.
- Aligned the commit message and description to the left.
- Updated the author icon design.
- Removed branding from the top left corner, the dirty blip from tabs, the grab cursor from the diff minimap and focus outlines.

## Fixes

- Fixed syntax highlight flicker on silent diff reloads.
- Fixed hiding the left sidebar.
- Moved folders now stay collapsed by default.
- A reworded commit stays selected after refresh.
- Open worktree diffs reload when the file changes on disk.

## Verification

- Core CI and Windows release workflow passed.
- Installer SHA-256: `<fill in from the release artifact>`
