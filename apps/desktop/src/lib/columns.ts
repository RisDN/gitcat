import type { GraphColumnSettings } from "./types";

export type GraphColumnKey = keyof GraphColumnSettings;

export const REF_COLUMN_WIDTH = 118;

// `track` feeds the grid template; `minWidth` feeds the horizontal scroll floor,
// where the message column claims more than its own minmax minimum so the row
// keeps the same 780px floor it had before columns became hideable.
const COLUMN_TRACKS: Record<GraphColumnKey, { track: string; minWidth: number }> = {
  refs: { track: `${REF_COLUMN_WIDTH}px`, minWidth: REF_COLUMN_WIDTH },
  graph: { track: "var(--gc-graph-column-width, 96px)", minWidth: 0 },
  message: { track: "minmax(180px, 1fr)", minWidth: 300 },
  author: { track: "86px", minWidth: 86 },
  date: { track: "116px", minWidth: 116 },
  sha: { track: "64px", minWidth: 64 },
};

export const GRAPH_COLUMNS: { key: GraphColumnKey; label: string }[] = [
  { key: "refs", label: "Branch / Tag" },
  { key: "graph", label: "Graph" },
  { key: "message", label: "Commit message" },
  { key: "author", label: "Author" },
  { key: "date", label: "Date / Time" },
  { key: "sha", label: "SHA" },
];

export const ALL_GRAPH_COLUMNS: GraphColumnSettings = {
  refs: true,
  graph: true,
  message: true,
  author: true,
  date: true,
  sha: true,
};

export function visibleGraphColumns(columns: GraphColumnSettings): GraphColumnKey[] {
  return GRAPH_COLUMNS.filter((column) => columns[column.key]).map((column) => column.key);
}

export function graphColumnsTemplate(columns: GraphColumnSettings): string {
  return visibleGraphColumns(columns).map((key) => COLUMN_TRACKS[key].track).join(" ");
}

export function graphColumnsMinWidth(columns: GraphColumnSettings, graphWidth: number): number {
  return visibleGraphColumns(columns).reduce(
    (total, key) => total + (key === "graph" ? graphWidth : COLUMN_TRACKS[key].minWidth),
    0,
  );
}

// Rows offset their lanes and hover highlight by whatever sits left of the graph.
export function graphColumnOffset(columns: GraphColumnSettings): number {
  return columns.refs ? REF_COLUMN_WIDTH : 0;
}
