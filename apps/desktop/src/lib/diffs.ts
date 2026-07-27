import type { DiffHunk, DiffLine, FileDiff } from "./types";

function sameLine(a: DiffLine, b: DiffLine): boolean {
  return a.kind === b.kind
    && a.old_line === b.old_line
    && a.new_line === b.new_line
    && a.content === b.content;
}

function sameHunk(a: DiffHunk, b: DiffHunk): boolean {
  if (
    a.header !== b.header
    || a.old_start !== b.old_start
    || a.old_count !== b.old_count
    || a.new_start !== b.new_start
    || a.new_count !== b.new_count
    || a.lines.length !== b.lines.length
  ) return false;

  return a.lines.every((line, index) => sameLine(line, b.lines[index]!));
}

export function sameFileDiff(a: FileDiff, b: FileDiff): boolean {
  if (
    a.new_path !== b.new_path
    || a.old_path !== b.old_path
    || a.old_mode !== b.old_mode
    || a.new_mode !== b.new_mode
    || a.status !== b.status
    || a.binary !== b.binary
    || a.truncated !== b.truncated
    || a.hunks.length !== b.hunks.length
  ) return false;

  return a.hunks.every((hunk, index) => sameHunk(hunk, b.hunks[index]!));
}
