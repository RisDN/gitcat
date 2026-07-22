import { memo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { DiffHunk, DiffLine, FileDiff } from "../lib/types";

export type DiffViewMode = "inline" | "split";

export interface DiffViewerProps {
  diff: FileDiff | null;
  mode?: DiffViewMode;
  defaultMode?: DiffViewMode;
  loading?: boolean;
  className?: string;
  onModeChange?: (mode: DiffViewMode) => void;
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  marker: DiffLine | null;
}

function linePrefix(kind: DiffLine["kind"]): string {
  switch (kind) {
    case "addition":
      return "+";
    case "deletion":
      return "−";
    case "context":
      return " ";
    case "no_newline":
      return "";
  }
}

function displayLineNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

function toSplitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.kind === "context") {
      rows.push({ left: line, right: line, marker: null });
      index += 1;
      continue;
    }

    if (line.kind === "no_newline") {
      rows.push({ left: null, right: null, marker: line });
      index += 1;
      continue;
    }

    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (
      index < lines.length
      && (lines[index].kind === "deletion" || lines[index].kind === "addition")
    ) {
      const changedLine = lines[index];
      if (changedLine.kind === "deletion") deletions.push(changedLine);
      else additions.push(changedLine);
      index += 1;
    }

    const rowCount = Math.max(deletions.length, additions.length);
    for (let pairIndex = 0; pairIndex < rowCount; pairIndex += 1) {
      rows.push({
        left: deletions[pairIndex] ?? null,
        right: additions[pairIndex] ?? null,
        marker: null,
      });
    }
  }

  return rows;
}

function LineContent({ line }: { line: DiffLine }) {
  return (
    <>
      <span aria-hidden="true" className="gc-diff-line__prefix">
        {linePrefix(line.kind)}
      </span>
      <code className="gc-diff-line__code">{line.content || " "}</code>
    </>
  );
}

const InlineHunk = memo(function InlineHunk({ hunk, index }: { hunk: DiffHunk; index: number }) {
  return (
    <section aria-labelledby={`gc-inline-hunk-${index}`} className="gc-diff-hunk gc-diff-hunk--inline">
      <h3 className="gc-diff-hunk__header" id={`gc-inline-hunk-${index}`}>
        <code>{hunk.header}</code>
      </h3>
      <table className="gc-diff-table gc-diff-table--inline">
        <caption className="gc-sr-only">
          Unified diff hunk: old lines {hunk.old_start}–{hunk.old_start + Math.max(0, hunk.old_count - 1)}, new lines {hunk.new_start}–{hunk.new_start + Math.max(0, hunk.new_count - 1)}
        </caption>
        <tbody>
          {hunk.lines.map((line, lineIndex) => {
            if (line.kind === "no_newline") {
              return (
                <tr className="gc-diff-line gc-diff-line--no-newline" key={`${lineIndex}:${line.content}`}>
                  <td aria-hidden="true" className="gc-diff-line__number" />
                  <td aria-hidden="true" className="gc-diff-line__number" />
                  <td className="gc-diff-line__content">
                    <LineContent line={line} />
                  </td>
                </tr>
              );
            }

            return (
              <tr className={`gc-diff-line gc-diff-line--${line.kind}`} key={`${lineIndex}:${line.old_line ?? ""}:${line.new_line ?? ""}`}>
                <td aria-label={line.old_line === null ? undefined : `Old line ${line.old_line}`} className="gc-diff-line__number gc-diff-line__number--old">
                  {displayLineNumber(line.old_line)}
                </td>
                <td aria-label={line.new_line === null ? undefined : `New line ${line.new_line}`} className="gc-diff-line__number gc-diff-line__number--new">
                  {displayLineNumber(line.new_line)}
                </td>
                <td className="gc-diff-line__content">
                  <LineContent line={line} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
});

function SplitCell({ line, side }: { line: DiffLine | null; side: "old" | "new" }) {
  const number = side === "old" ? line?.old_line : line?.new_line;
  const kindClass = line ? ` gc-diff-line__content--${line.kind}` : " gc-diff-line__content--empty";

  return (
    <>
      <td
        aria-label={number == null ? undefined : `${side === "old" ? "Old" : "New"} line ${number}`}
        className={`gc-diff-line__number gc-diff-line__number--${side}`}
      >
        {displayLineNumber(number ?? null)}
      </td>
      <td className={`gc-diff-line__content gc-diff-line__content--${side}${kindClass}`}>
        {line ? <LineContent line={line} /> : null}
      </td>
    </>
  );
}

const SplitHunk = memo(function SplitHunk({ hunk, index }: { hunk: DiffHunk; index: number }) {
  const rows = toSplitRows(hunk.lines);

  return (
    <section aria-labelledby={`gc-split-hunk-${index}`} className="gc-diff-hunk gc-diff-hunk--split">
      <h3 className="gc-diff-hunk__header" id={`gc-split-hunk-${index}`}>
        <code>{hunk.header}</code>
      </h3>
      <table className="gc-diff-table gc-diff-table--split">
        <caption className="gc-sr-only">
          Side-by-side diff hunk: old lines {hunk.old_start}–{hunk.old_start + Math.max(0, hunk.old_count - 1)}, new lines {hunk.new_start}–{hunk.new_start + Math.max(0, hunk.new_count - 1)}
        </caption>
        <thead className="gc-diff-table__head">
          <tr>
            <th className="gc-diff-table__line-heading" scope="col">Line</th>
            <th className="gc-diff-table__side-heading" scope="col">Before</th>
            <th className="gc-diff-table__line-heading" scope="col">Line</th>
            <th className="gc-diff-table__side-heading" scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            if (row.marker) {
              return (
                <tr className="gc-diff-line gc-diff-line--no-newline" key={`marker:${rowIndex}`}>
                  <td className="gc-diff-line__content" colSpan={4}>
                    <LineContent line={row.marker} />
                  </td>
                </tr>
              );
            }

            const rowKind = row.left?.kind === "deletion" || row.right?.kind === "addition"
              ? "change"
              : "context";
            return (
              <tr className={`gc-diff-line gc-diff-line--${rowKind}`} key={`line:${rowIndex}`}>
                <SplitCell line={row.left} side="old" />
                <SplitCell line={row.right} side="new" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
});

function DiffState({ modifier, children }: { modifier: string; children: string }) {
  return (
    <div className={`gc-diff-viewer__state gc-diff-viewer__state--${modifier}`} role="status">
      {children}
    </div>
  );
}

export function DiffViewer({
  diff,
  mode: controlledMode,
  defaultMode = "inline",
  loading = false,
  className,
  onModeChange,
}: DiffViewerProps) {
  const [internalMode, setInternalMode] = useState<DiffViewMode>(defaultMode);
  const mode = controlledMode ?? internalMode;

  const setMode = (nextMode: DiffViewMode) => {
    if (nextMode === mode) return;
    setInternalMode(nextMode);
    onModeChange?.(nextMode);
  };

  const handleModeKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const nextMode = event.key === "ArrowLeft" ? "inline" : "split";
    setMode(nextMode);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-diff-mode="${nextMode}"]`)
      ?.focus();
  };

  const rootClass = `gc-diff-viewer${className ? ` ${className}` : ""}`;

  if (loading) {
    return (
      <section aria-busy="true" aria-label="Diff viewer" className={`${rootClass} gc-diff-viewer--loading`}>
        <DiffState modifier="loading">Loading diff…</DiffState>
      </section>
    );
  }

  if (!diff) {
    return (
      <section aria-label="Diff viewer" className={`${rootClass} gc-diff-viewer--empty`}>
        <DiffState modifier="unselected">Select a changed file to view its diff.</DiffState>
      </section>
    );
  }

  const oldPath = diff.old_path ?? diff.new_path;
  const renamed = diff.old_path !== null && diff.old_path !== diff.new_path;

  return (
    <section aria-label={`Diff for ${diff.new_path}`} className={rootClass}>
      <header className="gc-diff-viewer__header">
        <div className="gc-diff-viewer__file">
          <h2 className="gc-diff-viewer__path" title={diff.new_path}>
            {renamed ? `${oldPath} → ${diff.new_path}` : diff.new_path}
          </h2>
          <span className={`gc-change-kind gc-change-kind--${diff.status}`}>{diff.status.replaceAll("_", " ")}</span>
          <span aria-label={`${diff.stats.additions} additions`} className="gc-diff-viewer__additions">
            +{diff.stats.additions}
          </span>
          <span aria-label={`${diff.stats.deletions} deletions`} className="gc-diff-viewer__deletions">
            −{diff.stats.deletions}
          </span>
          {diff.old_mode !== diff.new_mode ? (
            <span className="gc-diff-viewer__mode-change">
              {diff.old_mode ?? "none"} → {diff.new_mode ?? "none"}
            </span>
          ) : null}
        </div>
        <div
          aria-label="Diff layout"
          className="gc-diff-viewer__mode-switch"
          onKeyDown={handleModeKeys}
          role="group"
        >
          <button
            aria-pressed={mode === "inline"}
            className={`gc-diff-viewer__mode-button${mode === "inline" ? " gc-diff-viewer__mode-button--active" : ""}`}
            data-diff-mode="inline"
            onClick={() => setMode("inline")}
            type="button"
          >
            Inline
          </button>
          <button
            aria-pressed={mode === "split"}
            className={`gc-diff-viewer__mode-button${mode === "split" ? " gc-diff-viewer__mode-button--active" : ""}`}
            data-diff-mode="split"
            onClick={() => setMode("split")}
            type="button"
          >
            Split
          </button>
        </div>
      </header>

      {diff.truncated ? (
        <div className="gc-diff-viewer__notice gc-diff-viewer__notice--truncated" role="alert">
          Diff truncated at configured size limit.
        </div>
      ) : null}

      {diff.binary ? (
        <DiffState modifier="binary">Binary file. Text preview is unavailable.</DiffState>
      ) : diff.hunks.length === 0 ? (
        <DiffState modifier="no-changes">No text changes to display.</DiffState>
      ) : (
        <div className={`gc-diff-viewer__hunks gc-diff-viewer__hunks--${mode}`}>
          {diff.hunks.map((hunk, index) => (
            mode === "inline"
              ? <InlineHunk hunk={hunk} index={index} key={`${hunk.header}:${index}`} />
              : <SplitHunk hunk={hunk} index={index} key={`${hunk.header}:${index}`} />
          ))}
        </div>
      )}
    </section>
  );
}
