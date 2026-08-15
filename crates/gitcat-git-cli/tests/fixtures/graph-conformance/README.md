# GitKraken graph conformance

GitKraken Desktop is a black-box visual reference for GitCat's commit graph. The
goal of this harness is to turn repeatable observations into semantic fixtures,
then test topology, color allocation, and paint order independently.

## Frozen reference profile

- Product: GitKraken Desktop
- Version: 12.4.0
- Platform: Windows
- Theme: Dark
- Application zoom: reset to 100% with `Ctrl+0`
- Graph history: `Show All Commits in Graph`
- Smart Branch Visibility: off
- Hidden and solo refs: none; show all branches, remotes, tags, and stashes
- Pinned branches: none
- Columns: Branch/Tag, Graph, Commit Message, and SHA visible

For every capture, also record the Windows build, display scaling, application
window size, and graph column width. Capture the state immediately after the
action. Repository reopen and full application restart are manual UI stability
holdouts; repeat them at the end of a scenario or when the immediate state is
ambiguous, not after every action. The automatic Rust replay treats those steps
as boundaries and re-queries the stateless Git backend without reopening a UI
application. These details affect pixel comparisons even when graph semantics
do not.

## Why the oracle is split

A visually wrong route can have four different causes. Record these separately:

1. row order;
2. physical lane and edge topology;
3. logical branch-span color slot;
4. SVG paint order at crossings.

RGB values alone are not a semantic color oracle. The theme supplies pixels;
the graph algorithm supplies stable logical slots.

## Materialize the first scenario

From the repository root, run:

```powershell
cargo test -p gitcat-git-cli --test graph_conformance materialize_checkout_switch_for_gitkraken -- --ignored --nocapture
```

The command prints a repository path below
`target/graph-conformance/manual/`. It also writes a `capture-instructions.txt`
beside that repository. The generated repository uses deterministic commit
contents, identities, timestamps, parent order, and SHA-1 object format.

Open the printed path with:

```powershell
& "$env:LOCALAPPDATA\gitkraken\bin\gitkraken.cmd" -p "<printed repository path>"
```

Execute the listed actions in GitKraken itself. At each `CAPTURE` checkpoint,
save both a full-window screenshot and a close graph crop. Do not perform the
checkout with an external Git command: immediate in-app state is one of the
behaviors being measured.

## Stash index collisions

The collision fixture can still be materialized for audit captures with:

```powershell
cargo test -p gitcat-git-cli --test graph_conformance materialize_stash_index_collision_for_gitkraken -- --ignored --nocapture
```

It creates two distinct unstaged stashes whose visible index-parent SHA is
intentionally identical. GitKraken collapses them to one row and one sidebar
entry. The oldest member supplies the displayed label, while Pop/Apply/Delete
target the newest member. Both `stash-index-collision` and
`disconnected-checkout` are now part of the automatic semantic and presentation
oracle suites.

GitKraken also retains the displayed stash label as the transient WIP title
after Pop. GitCat still renders its generic `// WIP` title, and no collision-row
details-inspector capture exists yet. Those two presentation details remain
explicit holdouts; they do not weaken the verified row identity, action target,
worktree contents, lane, or color assertions.

## Disconnected interior-lane reuse observation

Materialize the manual-only discriminator with:

```powershell
cargo test -p gitcat-git-cli --test graph_conformance materialize_disconnected_interior_reuse_for_gitkraken -- --ignored --nocapture
```

Open the printed repository path in GitKraken using the frozen profile above.
The deterministic row order must be `main-tip`, `side-tip`, `right-tip`,
`side-root`, `target-tip`, `main-root`, `right-root`, `target-root`. At the first
`CAPTURE head-main`, annotate every physical lane, logical color, and edge. In
particular, immediately before `target-tip`, `side-root` has finished the line
in lane 1 while the `main` and `right` lines remain active on either side in
lanes 0 and 2. This makes lane 1 a true bounded interior hole.

Perform both checkouts in GitKraken, not in a terminal, and capture the graph
immediately after each listed checkpoint:

1. capture `head-main`;
2. check out `target`, then capture `head-target`;
3. check out `main`, then capture `head-main-return`.

The three GitKraken 12.4.0 captures establish that `target-tip` does not reuse
the finished lane 1. It opens to the right in lane/color 3 and stays there for
all three checkpoints. The complete lane/color sequence is
`[0, 1, 2, 1, 3, 0, 2, 3]`; all four component edges are straight. Checking out
`target` and then returning to `main` changes only the active ref decoration.

The committed semantic oracle is
`oracles/gitkraken-12.4.0-windows/disconnected-interior-reuse.json`. This
fixture disproves the earlier hypothesis that every finished lane bounded by
active lanes is reusable. Any narrower reuse rule must be derived from an
independent observation such as the existing `sim-orphan` reference case.

## Capture protocol

For every scenario, retain these states when applicable:

- before the action;
- immediately after the in-app action;
- one final repository reopen holdout;
- one final full restart holdout, including GitKraken's tray process.

Annotate each visible row with its symbolic commit id, physical lane, logical
color slot, and outgoing edges. At crossings, record which source route is on
top. The semantic annotation is the committed oracle; screenshots are its audit
evidence.

Never generate or update a GitKraken oracle from GitCat's current output. A
GitCat mismatch is reported by the test assertions. Diagnostic `actual`
artifacts may be written under `target/` during investigation, but they are not
generated automatically and must never be promoted into an oracle. Changing an
oracle requires a new GitKraken observation and review.

## Verification

Scenario schema validation is part of the existing Rust workspace test suite:

```powershell
cargo test -p gitcat-git-cli --test graph_conformance
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

The first scenario isolates checkout stability for a clean worktree. The second
uses the same DAG with an untracked WIP file so WIP placement and checkout can be
measured separately. Later scenarios add stash lifecycle, pagination boundaries,
disconnected histories, palette overflow, octopus merges, and crossing paint
order without combining unrelated rules in one fixture.
