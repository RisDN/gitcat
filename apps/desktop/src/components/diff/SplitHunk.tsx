import { memo } from "react";

import type { DiffHunk, DiffLine } from "../../lib/types";
import { HunkHeader, HunkSection, LineContent, displayLineNumber } from "./DiffParts";

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  marker: DiffLine | null;
}

// Pairs each run of deletions with the additions that replaced it, so the two
// sides line up even when the runs have different lengths.
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

export const SplitHunk = memo(function SplitHunk({ hunk, index }: { hunk: DiffHunk; index: number }) {
  const rows = toSplitRows(hunk.lines);

  return (
    <HunkSection label={`gc-split-hunk-${index}`}>
      <HunkHeader id={`gc-split-hunk-${index}`}>{hunk.header}</HunkHeader>
      <table className="gc-diff-table gc-diff-table--split">
        <caption className="sr-only">
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
    </HunkSection>
  );
});
