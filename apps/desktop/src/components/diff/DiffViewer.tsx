import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { cx } from "../../lib";
import type { FileDiff } from "../../lib/types";
import { DiffMinimap } from "./DiffMinimap";
import { ChangeKind, DIFF_VIEW_MODES, DiffState, ModeButton, isWholeFileMode } from "./DiffParts";
import type { DiffViewMode } from "./DiffParts";
import { HighlightContext, useDiffHighlight } from "./highlight";
import { InlineHunk } from "./InlineHunk";
import { SplitHunk } from "./SplitHunk";
import { buildDiffMap } from "./rows";

export interface DiffViewerProps {
  diff: FileDiff | null;
  mode?: DiffViewMode;
  defaultMode?: DiffViewMode;
  loading?: boolean;
  className?: string;
  onModeChange?: (mode: DiffViewMode) => void;
}

export function DiffViewer({
  diff,
  mode: controlledMode,
  defaultMode = "hunk",
  loading = false,
  className,
  onModeChange,
}: DiffViewerProps) {
  const [internalMode, setInternalMode] = useState<DiffViewMode>(defaultMode);
  const mode = controlledMode ?? internalMode;
  const scrollRef = useRef<HTMLDivElement>(null);
  const diffMap = useMemo(
    () => buildDiffMap(diff?.hunks ?? [], mode),
    [diff, mode],
  );
  const highlight = useDiffHighlight(diff);

  const setMode = (nextMode: DiffViewMode) => {
    if (nextMode === mode) return;
    setInternalMode(nextMode);
    onModeChange?.(nextMode);
  };

  const handleModeKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const current = DIFF_VIEW_MODES.indexOf(mode);
    const nextIndex = (current + step + DIFF_VIEW_MODES.length) % DIFF_VIEW_MODES.length;
    const nextMode = DIFF_VIEW_MODES[nextIndex];
    setMode(nextMode);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-diff-mode="${nextMode}"]`)
      ?.focus();
  };

  const rootClass = cx("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background", className);

  if (loading) {
    return (
      <section aria-busy="true" aria-label="Diff viewer" className={rootClass}>
        <DiffState>Loading diff…</DiffState>
      </section>
    );
  }

  if (!diff) {
    return (
      <section aria-label="Diff viewer" className={rootClass}>
        <DiffState>Select a changed file to view its diff.</DiffState>
      </section>
    );
  }

  const oldPath = diff.old_path ?? diff.new_path;
  const renamed = diff.old_path !== null && diff.old_path !== diff.new_path;
  const showHunkHeaders = mode === "hunk" || diff.hunks.length > 1;
  const showMinimap = isWholeFileMode(mode) && !diff.binary && diffMap.marks.length > 0;

  return (
    <section aria-label={`Diff for ${diff.new_path}`} className={rootClass}>
      <header className="flex min-h-12 flex-[0_0_auto] items-center gap-3 border-b border-border bg-[color-mix(in_srgb,var(--gc-panel)_66%,var(--gc-background))] py-1.5 pl-3.25 pr-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.75">
          <h2 className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] font-[550] leading-[1.4] text-foreground" title={diff.new_path}>
            {renamed ? `${oldPath} → ${diff.new_path}` : diff.new_path}
          </h2>
          <ChangeKind status={diff.status} />
          <span aria-label={`${diff.stats.additions} additions`} className="font-mono text-[10px] font-[650] text-success">
            +{diff.stats.additions}
          </span>
          <span aria-label={`${diff.stats.deletions} deletions`} className="font-mono text-[10px] font-[650] text-danger">
            −{diff.stats.deletions}
          </span>
          {diff.old_mode !== diff.new_mode ? (
            <span className="font-mono text-[10px] text-muted">
              {diff.old_mode ?? "none"} → {diff.new_mode ?? "none"}
            </span>
          ) : null}
        </div>
        <div
          aria-label="Diff layout"
          className="flex shrink-0 rounded-[5px] border border-border bg-background p-0.5"
          onKeyDown={handleModeKeys}
          role="group"
        >
          <ModeButton active={mode === "hunk"} mode="hunk" onSelect={setMode}>Hunk</ModeButton>
          <ModeButton active={mode === "inline"} mode="inline" onSelect={setMode}>Inline</ModeButton>
          <ModeButton active={mode === "split"} mode="split" onSelect={setMode}>Split</ModeButton>
        </div>
      </header>

      {diff.truncated ? (
        <div className="border-b border-border bg-[color-mix(in_srgb,var(--gc-warning)_10%,var(--gc-panel))] px-3 py-2 text-[11px] text-warning" role="alert">
          Diff truncated at configured size limit.
        </div>
      ) : null}

      {diff.binary ? (
        <DiffState>Binary file. Text preview is unavailable.</DiffState>
      ) : diff.hunks.length === 0 ? (
        <DiffState>No text changes to display.</DiffState>
      ) : (
        <HighlightContext.Provider value={highlight}>
          <div className="flex min-h-0 min-w-0 flex-1">
            <div
              className={cx("min-w-0 flex-1 overflow-auto", showMinimap && "gc-diff-scroller--mapped")}
              ref={scrollRef}
            >
              {diff.hunks.map((hunk, index) => (
                mode === "split"
                  ? <SplitHunk hunk={hunk} index={index} key={`${hunk.header}:${index}`} showHeader={showHunkHeaders} />
                  : <InlineHunk hunk={hunk} index={index} key={`${hunk.header}:${index}`} showHeader={showHunkHeaders} />
              ))}
            </div>
            {showMinimap ? <DiffMinimap map={diffMap} scrollRef={scrollRef} /> : null}
          </div>
        </HighlightContext.Provider>
      )}
    </section>
  );
}
