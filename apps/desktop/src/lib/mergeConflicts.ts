// Parsing and composition for the three-way merge editor.
//
// Git already wrote the answer into the working copy: a conflicted file is the
// merged result with the disputed regions bracketed by markers. Parsing those
// markers is what lets the editor show one side per pane with matching common
// context, instead of asking the user to read `<<<<<<< HEAD` in a diff.

const OURS_MARKER = /^<{7}(?: (.*))?$/;
const BASE_MARKER = /^\|{7}(?: (.*))?$/;
const SEPARATOR_MARKER = /^={7}$/;
const THEIRS_MARKER = /^>{7}(?: (.*))?$/;

export interface MergeCommonSegment {
  kind: "common";
  lines: string[];
}

export interface MergeConflictSegment {
  kind: "conflict";
  index: number;
  ours: string[];
  theirs: string[];
  base: string[];
  oursLabel: string;
  theirsLabel: string;
}

export type MergeSegment = MergeCommonSegment | MergeConflictSegment;

export interface MergeSelection {
  ours: boolean;
  theirs: boolean;
}

export interface ParsedMergeFile {
  segments: MergeSegment[];
  conflicts: MergeConflictSegment[];
}

export type MergeSide = "ours" | "theirs";

export interface MergeRow {
  key: string;
  number: number | null;
  text: string;
  conflictIndex: number | null;
  first: boolean;
  // Which side the line came from, so the result pane can colour and tag a
  // line the same way as the pane it was picked in.
  side: MergeSide | null;
  tone: "common" | "conflict" | "unresolved";
}

// Trailing newlines stay attached to their line, so composing the result is a
// plain concatenation and CRLF files survive a round trip untouched.
export function splitKeepingLineEndings(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? (text ? [text] : []);
}

export function lineText(line: string): string {
  return line.replace(/\r?\n$/, "");
}

export function parseConflictMarkers(text: string): ParsedMergeFile {
  const segments: MergeSegment[] = [];
  const conflicts: MergeConflictSegment[] = [];
  let common: string[] = [];
  let current: MergeConflictSegment | null = null;
  let side: "ours" | "base" | "theirs" = "ours";

  const flushCommon = () => {
    if (!common.length) return;
    segments.push({ kind: "common", lines: common });
    common = [];
  };
  const closeConflict = () => {
    if (!current) return;
    segments.push(current);
    conflicts.push(current);
    current = null;
  };

  for (const line of splitKeepingLineEndings(text)) {
    const bare = lineText(line);
    const opening = OURS_MARKER.exec(bare);
    if (opening && !current) {
      flushCommon();
      side = "ours";
      current = {
        kind: "conflict",
        index: conflicts.length,
        ours: [],
        theirs: [],
        base: [],
        oursLabel: opening[1]?.trim() ?? "",
        theirsLabel: "",
      };
      continue;
    }
    if (!current) {
      common.push(line);
      continue;
    }
    if (BASE_MARKER.test(bare)) {
      side = "base";
      continue;
    }
    if (SEPARATOR_MARKER.test(bare)) {
      side = "theirs";
      continue;
    }
    const closing = THEIRS_MARKER.exec(bare);
    if (closing) {
      current.theirsLabel = closing[1]?.trim() ?? "";
      closeConflict();
      continue;
    }
    current[side].push(line);
  }

  // An unterminated conflict means the file was hand-edited mid-marker; keep
  // what was collected rather than dropping the tail of the file.
  closeConflict();
  flushCommon();
  return { segments, conflicts };
}

export function defaultSelections(count: number): MergeSelection[] {
  return Array.from({ length: count }, () => ({ ours: false, theirs: false }));
}

function selectionAt(selections: readonly MergeSelection[], index: number): MergeSelection {
  return selections[index] ?? { ours: false, theirs: false };
}

// Both sides selected keeps ours first: that is the order Git itself writes the
// markers in, so a user who wants both halves gets the familiar sequence.
export function conflictLines(
  conflict: MergeConflictSegment,
  selection: MergeSelection,
): string[] {
  return [
    ...(selection.ours ? conflict.ours : []),
    ...(selection.theirs ? conflict.theirs : []),
  ];
}

export function composeMergeResult(
  segments: readonly MergeSegment[],
  selections: readonly MergeSelection[],
): string {
  let text = "";
  for (const segment of segments) {
    if (segment.kind === "common") text += segment.lines.join("");
    else text += conflictLines(segment, selectionAt(selections, segment.index)).join("");
  }
  return text;
}

export function unresolvedConflicts(
  conflicts: readonly MergeConflictSegment[],
  selections: readonly MergeSelection[],
): number[] {
  return conflicts
    .filter((conflict) => {
      const selection = selectionAt(selections, conflict.index);
      return !selection.ours && !selection.theirs;
    })
    .map((conflict) => conflict.index);
}

interface RawRow {
  line: string;
  conflictIndex: number | null;
  first: boolean;
  side: MergeSide | null;
  tone: MergeRow["tone"];
}

function rows(source: RawRow[]): MergeRow[] {
  return source.map((entry, position) => ({
    key: `${position}`,
    number: position + 1,
    text: lineText(entry.line),
    conflictIndex: entry.conflictIndex,
    first: entry.first,
    side: entry.side,
    tone: entry.tone,
  }));
}

export function sideRows(segments: readonly MergeSegment[], side: MergeSide): MergeRow[] {
  const flat: RawRow[] = [];
  for (const segment of segments) {
    if (segment.kind === "common") {
      for (const line of segment.lines) flat.push({ line, conflictIndex: null, first: false, side: null, tone: "common" });
      continue;
    }
    const lines = segment[side];
    if (!lines.length) {
      // An empty side still needs a row, otherwise its checkbox has nowhere to
      // live and the conflict looks absent on that side.
      flat.push({ line: "", conflictIndex: segment.index, first: true, side, tone: "conflict" });
      continue;
    }
    lines.forEach((line, position) => {
      flat.push({ line, conflictIndex: segment.index, first: position === 0, side, tone: "conflict" });
    });
  }
  return rows(flat);
}

export function plainRows(text: string): MergeRow[] {
  return rows(splitKeepingLineEndings(text).map((line) => ({
    line,
    conflictIndex: null,
    first: false,
    side: null,
    tone: "common" as const,
  })));
}

// What an untouched conflict shows in the result pane: the lines as they were
// before either side edited them. `merge` style markers carry no base section,
// so the region is located in the stage-1 blob by the common context around it
// -- a preview, never part of what gets saved. A region that cannot be located
// unambiguously is left blank rather than guessed at.
export function baseSlices(
  segments: readonly MergeSegment[],
  baseText: string | undefined,
): Map<number, string[]> {
  const slices = new Map<number, string[]>();
  const baseLines = baseText === undefined ? [] : splitKeepingLineEndings(baseText).map(lineText);
  let cursor = 0;
  for (let position = 0; position < segments.length; position += 1) {
    const segment = segments[position];
    if (segment.kind !== "conflict") continue;
    if (segment.base.length) {
      slices.set(segment.index, segment.base);
      continue;
    }
    if (!baseLines.length) continue;
    const previous = segments[position - 1];
    const next = segments[position + 1];
    const prefix = previous?.kind === "common" ? previous.lines.slice(-2).map(lineText) : [];
    const suffix = next?.kind === "common" ? next.lines.slice(0, 2).map(lineText) : [];
    const start = prefix.length ? findRun(baseLines, prefix, cursor) : cursor;
    if (start === null) continue;
    const from = prefix.length ? start + prefix.length : start;
    const end = suffix.length ? findRun(baseLines, suffix, from) : baseLines.length;
    if (end === null || end < from) continue;
    slices.set(segment.index, baseLines.slice(from, end));
    cursor = end;
  }
  return slices;
}

function findRun(lines: readonly string[], run: readonly string[], from: number): number | null {
  for (let index = from; index + run.length <= lines.length; index += 1) {
    if (run.every((line, offset) => lines[index + offset] === line)) return index;
  }
  return null;
}

export function outputRows(
  segments: readonly MergeSegment[],
  selections: readonly MergeSelection[],
  basePreview?: ReadonlyMap<number, string[]>,
): MergeRow[] {
  const result: MergeRow[] = [];
  let number = 1;
  for (const segment of segments) {
    if (segment.kind === "common") {
      for (const line of segment.lines) {
        result.push({
          key: `${result.length}`,
          number: number++,
          text: lineText(line),
          conflictIndex: null,
          first: false,
          side: null,
          tone: "common",
        });
      }
      continue;
    }
    const selection = selectionAt(selections, segment.index);
    if (!selection.ours && !selection.theirs) {
      const preview = basePreview?.get(segment.index) ?? [];
      const lines = preview.length ? preview : [""];
      lines.forEach((line, position) => {
        result.push({
          key: `${result.length}`,
          number: number++,
          text: lineText(line),
          conflictIndex: segment.index,
          first: position === 0,
          side: null,
          tone: "unresolved",
        });
      });
      continue;
    }
    const picked: Array<{ line: string; side: MergeSide }> = [
      ...(selection.ours ? segment.ours.map((line) => ({ line, side: "ours" as const })) : []),
      ...(selection.theirs ? segment.theirs.map((line) => ({ line, side: "theirs" as const })) : []),
    ];
    picked.forEach((entry, position) => {
      result.push({
        key: `${result.length}`,
        number: number++,
        text: lineText(entry.line),
        conflictIndex: segment.index,
        first: position === 0,
        side: entry.side,
        tone: "conflict",
      });
    });
  }
  return result;
}
