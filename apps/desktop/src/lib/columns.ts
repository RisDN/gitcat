import type { GraphColumnSettings, GraphColumnWidths } from "./types";

export type GraphColumnKey = keyof GraphColumnSettings;

export const REF_COLUMN_WIDTH = 118;

// The width at which the parking limit lands exactly on lane 0, so every lane
// collapses into a single column of nodes with nothing left standing beside it,
// with a little air between it and the next column. Derived from the graph
// geometry in CommitGraph.tsx: GRAPH_PADDING (24) + AVATAR_RADIUS (11) +
// NODE_END_GAP (6). `parking limit reaches lane zero at the floor` pins it to
// that geometry.
export const MIN_GRAPH_COLUMN_WIDTH = 41;

// Floor of the lane extent, i.e. of the width the graph column picks for itself
// when it has never been dragged. A single-lane history still gets this much
// room, which is what leaves the column something to be dragged through.
export const MIN_GRAPH_LANE_EXTENT = 96;

// Floors for the drag handles. `refs` stops where the head check and the ref
// icon still fit, which is also the width that switches it to icon-only.
export const GRAPH_COLUMN_MIN_WIDTH: Record<GraphColumnKey, number> = {
  refs: 32,
  graph: MIN_GRAPH_COLUMN_WIDTH,
  message: 80,
  author: 48,
  date: 56,
  sha: 52,
};

// Mirrors MAX_COLUMN_WIDTH in crates/gitcat-core/src/state.rs.
export const MAX_GRAPH_COLUMN_WIDTH = 2000;

// Below this the ref column keeps only the head check and the ref icon.
export const REFS_ICON_ONLY_WIDTH = 60;

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

// `graph: null` means "follow the lane extent", which is what the column did
// before it became draggable.
export const DEFAULT_GRAPH_COLUMN_WIDTHS: GraphColumnWidths = {
  refs: REF_COLUMN_WIDTH,
  graph: null,
  message: 300,
  author: 86,
  date: 116,
  sha: 64,
};

export const COMPACT_GRAPH_COLUMN_WIDTHS: GraphColumnWidths = {
  refs: GRAPH_COLUMN_MIN_WIDTH.refs,
  graph: MIN_GRAPH_COLUMN_WIDTH,
  message: GRAPH_COLUMN_MIN_WIDTH.message,
  author: GRAPH_COLUMN_MIN_WIDTH.author,
  date: GRAPH_COLUMN_MIN_WIDTH.date,
  sha: GRAPH_COLUMN_MIN_WIDTH.sha,
};

export function visibleGraphColumns(columns: GraphColumnSettings): GraphColumnKey[] {
  return GRAPH_COLUMNS.filter((column) => columns[column.key]).map((column) => column.key);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

// The graph column can grow until every lane is spread out, and no further:
// past that it would only add empty space to the right of the last lane.
export function effectiveGraphColumnWidth(
  widths: GraphColumnWidths,
  laneExtentWidth: number,
): number {
  const extent = Math.max(MIN_GRAPH_LANE_EXTENT, laneExtentWidth);
  return widths.graph === null ? extent : clamp(widths.graph, MIN_GRAPH_COLUMN_WIDTH, extent);
}

export function graphColumnWidth(
  key: GraphColumnKey,
  widths: GraphColumnWidths,
  laneExtentWidth: number,
): number {
  return key === "graph"
    ? effectiveGraphColumnWidth(widths, laneExtentWidth)
    : clamp(widths[key], GRAPH_COLUMN_MIN_WIDTH[key], MAX_GRAPH_COLUMN_WIDTH);
}

// The last visible column takes whatever is left of the row, so it has no
// handle and no stored width to honour -- only a floor it may not shrink past.
function trailingColumnMinWidth(
  key: GraphColumnKey,
  widths: GraphColumnWidths,
  laneExtentWidth: number,
): number {
  return key === "graph"
    ? effectiveGraphColumnWidth(widths, laneExtentWidth)
    : GRAPH_COLUMN_MIN_WIDTH[key];
}

export function graphColumnsTemplate(
  columns: GraphColumnSettings,
  widths: GraphColumnWidths,
  laneExtentWidth: number,
): string {
  const visible = visibleGraphColumns(columns);
  return visible
    .map((key, index) => (index === visible.length - 1
      ? `minmax(${trailingColumnMinWidth(key, widths, laneExtentWidth)}px, 1fr)`
      : `${graphColumnWidth(key, widths, laneExtentWidth)}px`))
    .join(" ");
}

// Horizontal scroll floor: everything left of the trailing column at its
// dragged width, plus the floor the trailing column itself keeps.
export function graphColumnsMinWidth(
  columns: GraphColumnSettings,
  widths: GraphColumnWidths,
  laneExtentWidth: number,
): number {
  const visible = visibleGraphColumns(columns);
  return visible.reduce(
    (total, key, index) => total + (index === visible.length - 1
      ? trailingColumnMinWidth(key, widths, laneExtentWidth)
      : graphColumnWidth(key, widths, laneExtentWidth)),
    0,
  );
}

// Rows offset their lanes and hover highlight by whatever sits left of the graph.
export function graphColumnOffset(
  columns: GraphColumnSettings,
  widths: GraphColumnWidths = DEFAULT_GRAPH_COLUMN_WIDTHS,
  laneExtentWidth = MIN_GRAPH_LANE_EXTENT,
): number {
  return columns.refs ? graphColumnWidth("refs", widths, laneExtentWidth) : 0;
}

export function isRefColumnIconOnly(
  columns: GraphColumnSettings,
  widths: GraphColumnWidths,
): boolean {
  // A trailing ref column stretches instead of clamping, so it is never compact.
  const visible = visibleGraphColumns(columns);
  if (visible[visible.length - 1] === "refs") return false;
  return graphColumnWidth("refs", widths, MIN_GRAPH_LANE_EXTENT) < REFS_ICON_ONLY_WIDTH;
}
