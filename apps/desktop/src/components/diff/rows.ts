import type { DiffHunk, DiffLine } from "../../lib/types";
import type { DiffViewMode } from "./DiffParts";

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  marker: DiffLine | null;
}

export type MarkKind = "addition" | "deletion" | "change";

export interface DiffMark {
  kind: MarkKind;
  start: number;
  length: number;
}

export interface DiffMap {
  marks: DiffMark[];
  totalRows: number;
}

// Pairs each run of deletions with the additions that replaced it, so the two
// sides line up even when the runs have different lengths.
export function toSplitRows(lines: readonly DiffLine[]): SplitRow[] {
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

function rowKinds(hunks: readonly DiffHunk[], mode: DiffViewMode): (MarkKind | null)[] {
  const kinds: (MarkKind | null)[] = [];

  for (const hunk of hunks) {
    if (mode === "split") {
      for (const row of toSplitRows(hunk.lines)) {
        const removed = row.left?.kind === "deletion";
        const added = row.right?.kind === "addition";
        kinds.push(removed && added ? "change" : removed ? "deletion" : added ? "addition" : null);
      }
      continue;
    }

    for (const line of hunk.lines) {
      kinds.push(
        line.kind === "addition" ? "addition" : line.kind === "deletion" ? "deletion" : null,
      );
    }
  }

  return kinds;
}

export function buildDiffMap(hunks: readonly DiffHunk[], mode: DiffViewMode): DiffMap {
  const kinds = rowKinds(hunks, mode);
  const marks: DiffMark[] = [];

  for (let index = 0; index < kinds.length; index += 1) {
    const kind = kinds[index];
    if (!kind) continue;

    const start = index;
    while (index + 1 < kinds.length && kinds[index + 1] === kind) index += 1;
    marks.push({ kind, start, length: index - start + 1 });
  }

  return { marks, totalRows: kinds.length };
}
