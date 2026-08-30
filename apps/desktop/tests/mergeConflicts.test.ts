import assert from "node:assert/strict";
import test from "node:test";

import type { MergeSelection } from "../src/lib/mergeConflicts";
import {
  baseSlices,
  composeMergeResult,
  defaultSelections,
  outputRows,
  parseConflictMarkers,
  sideRows,
  unresolvedConflicts,
} from "../src/lib/mergeConflicts";

function pick(count: number, side: "ours" | "theirs"): MergeSelection[] {
  return Array.from({ length: count }, () => ({ ours: side === "ours", theirs: side === "theirs" }));
}

const MERGED = [
  "context above\n",
  "<<<<<<< HEAD\n",
  "tracked line = local second edit\n",
  "=======\n",
  "tracked line = remote side\n",
  ">>>>>>> b585e3fcd2e101e8784f61234a2c300953e1db80\n",
  "context below\n",
].join("");

const DIFF3 = [
  "<<<<<<< HEAD\n",
  "ours\n",
  "||||||| merged common ancestors\n",
  "base\n",
  "=======\n",
  "theirs\n",
  ">>>>>>> topic\n",
].join("");

test("parses a conflict into common context and both sides", () => {
  const parsed = parseConflictMarkers(MERGED);
  assert.equal(parsed.conflicts.length, 1);
  assert.deepEqual(parsed.segments.map((segment) => segment.kind), ["common", "conflict", "common"]);
  const conflict = parsed.conflicts[0];
  assert.deepEqual(conflict.ours, ["tracked line = local second edit\n"]);
  assert.deepEqual(conflict.theirs, ["tracked line = remote side\n"]);
  assert.equal(conflict.oursLabel, "HEAD");
  assert.equal(conflict.theirsLabel, "b585e3fcd2e101e8784f61234a2c300953e1db80");
});

test("keeps the diff3 base section out of both sides", () => {
  const conflict = parseConflictMarkers(DIFF3).conflicts[0];
  assert.deepEqual(conflict.ours, ["ours\n"]);
  assert.deepEqual(conflict.base, ["base\n"]);
  assert.deepEqual(conflict.theirs, ["theirs\n"]);
});

test("a file without markers is one common segment", () => {
  const parsed = parseConflictMarkers("plain\nfile\n");
  assert.equal(parsed.conflicts.length, 0);
  assert.deepEqual(parsed.segments, [{ kind: "common", lines: ["plain\n", "file\n"] }]);
});

test("an unterminated conflict keeps the collected lines", () => {
  const parsed = parseConflictMarkers("<<<<<<< HEAD\nours\n=======\ntheirs\n");
  assert.equal(parsed.conflicts.length, 1);
  assert.deepEqual(parsed.conflicts[0].theirs, ["theirs\n"]);
});

test("composing writes only the picked sides and drops every marker", () => {
  const parsed = parseConflictMarkers(MERGED);
  const ours = composeMergeResult(parsed.segments, pick(1, "ours"));
  assert.equal(ours, "context above\ntracked line = local second edit\ncontext below\n");
  const theirs = composeMergeResult(parsed.segments, pick(1, "theirs"));
  assert.equal(theirs, "context above\ntracked line = remote side\ncontext below\n");
});

test("both sides picked keep ours first", () => {
  const parsed = parseConflictMarkers(MERGED);
  const text = composeMergeResult(parsed.segments, [{ ours: true, theirs: true }]);
  assert.equal(
    text,
    "context above\ntracked line = local second edit\ntracked line = remote side\ncontext below\n",
  );
});

test("CRLF line endings survive a round trip", () => {
  const source = "a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> topic\r\nb\r\n";
  const parsed = parseConflictMarkers(source);
  assert.equal(
    composeMergeResult(parsed.segments, pick(1, "ours")),
    "a\r\nours\r\nb\r\n",
  );
});

test("an unpicked conflict is reported unresolved and left out of the result", () => {
  const parsed = parseConflictMarkers(MERGED);
  const selections = defaultSelections(parsed.conflicts.length);
  assert.deepEqual(unresolvedConflicts(parsed.conflicts, selections), [0]);
  assert.equal(composeMergeResult(parsed.segments, selections), "context above\ncontext below\n");
});

test("side rows number every line and mark the conflict block", () => {
  const parsed = parseConflictMarkers(MERGED);
  const rows = sideRows(parsed.segments, "theirs");
  assert.deepEqual(rows.map((row) => row.side), [null, "theirs", null]);
  assert.deepEqual(rows.map((row) => row.number), [1, 2, 3]);
  assert.deepEqual(rows.map((row) => row.conflictIndex), [null, 0, null]);
  assert.equal(rows[1].first, true);
  assert.equal(rows[1].text, "tracked line = remote side");
});

test("a side with no lines still gets a row to carry its checkbox", () => {
  const parsed = parseConflictMarkers("<<<<<<< HEAD\nours\n=======\n>>>>>>> topic\n");
  const rows = sideRows(parsed.segments, "theirs");
  assert.deepEqual(rows.map((row) => row.conflictIndex), [0]);
  assert.equal(rows[0].text, "");
});

test("an unresolved conflict shows the base lines it started from", () => {
  const parsed = parseConflictMarkers(MERGED);
  const preview = baseSlices(parsed.segments, "context above\ntracked line = local branch\ncontext below\n");
  assert.deepEqual(preview.get(0), ["tracked line = local branch"]);
  const rows = outputRows(parsed.segments, defaultSelections(1), preview);
  assert.deepEqual(rows.map((row) => row.tone), ["common", "unresolved", "common"]);
  assert.deepEqual(rows.map((row) => row.text), [
    "context above",
    "tracked line = local branch",
    "context below",
  ]);
});

test("diff3 markers give the base preview directly", () => {
  const parsed = parseConflictMarkers(DIFF3);
  assert.deepEqual(baseSlices(parsed.segments, undefined).get(0), ["base\n"]);
});

test("a base region that cannot be located leaves one blank row", () => {
  const parsed = parseConflictMarkers(MERGED);
  const preview = baseSlices(parsed.segments, "nothing in common\n");
  assert.equal(preview.has(0), false);
  const rows = outputRows(parsed.segments, defaultSelections(1), preview);
  assert.deepEqual(rows.map((row) => row.text), ["context above", "", "context below"]);
});

test("output rows tag each picked line with the side it came from", () => {
  const parsed = parseConflictMarkers(MERGED);
  const rows = outputRows(parsed.segments, [{ ours: true, theirs: true }]);
  assert.deepEqual(rows.map((row) => row.side), [null, "ours", "theirs", null]);
  assert.deepEqual(rows.map((row) => row.number), [1, 2, 3, 4]);
});
