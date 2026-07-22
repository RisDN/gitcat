import { memo, useMemo } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import type { CommitSummary } from "../lib/types";

const ROW_HEIGHT = 44;
const LANE_WIDTH = 18;
const GRAPH_PADDING = 12;
const LANE_COLOR_COUNT = 8;

const ROW_RENDER_STYLE: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: `${ROW_HEIGHT}px`,
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export interface CommitContextMenuRequest {
  commit: CommitSummary;
  clientX: number;
  clientY: number;
}

export interface CommitGraphProps {
  commits: readonly CommitSummary[];
  selectedOid: string | null;
  searchMatchOids?: ReadonlySet<string>;
  onSelect: (commit: CommitSummary) => void;
  onCommitContextMenu?: (request: CommitContextMenuRequest) => void;
  className?: string;
  emptyLabel?: string;
  formatTimestamp?: (seconds: number, offsetMinutes: number) => string;
}

interface GraphPath {
  key: string;
  data: string;
  lane: number;
  merge: boolean;
}

interface GraphGeometry {
  paths: GraphPath[];
  width: number;
  height: number;
}

interface CommitRowProps {
  commit: CommitSummary;
  index: number;
  total: number;
  selected: boolean;
  searchMatch: boolean;
  graphWidth: number;
  onSelect: (commit: CommitSummary) => void;
  onCommitContextMenu?: (request: CommitContextMenuRequest) => void;
  formatTimestamp?: (seconds: number, offsetMinutes: number) => string;
}

function laneX(lane: number): number {
  return GRAPH_PADDING + lane * LANE_WIDTH;
}

function rowY(index: number): number {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function laneClass(base: string, lane: number): string {
  return `${base} ${base}--lane-${lane % LANE_COLOR_COUNT}`;
}

function buildGraphGeometry(commits: readonly CommitSummary[]): GraphGeometry {
  const commitIndex = new Map<string, number>();
  let maxLane = 0;

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    commitIndex.set(commit.oid, index);
    maxLane = Math.max(maxLane, commit.graph.lane);

    for (const edge of commit.graph.edges) {
      maxLane = Math.max(maxLane, edge.from_lane, edge.to_lane);
    }
  }

  const paths: GraphPath[] = [];
  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];

    for (let edgeIndex = 0; edgeIndex < commit.graph.edges.length; edgeIndex += 1) {
      const edge = commit.graph.edges[edgeIndex];
      const parentIndex = commitIndex.get(edge.parent_oid);
      const targetIndex = parentIndex !== undefined && parentIndex > index
        ? parentIndex
        : commits.length;
      const startX = laneX(edge.from_lane);
      const startY = rowY(index);
      const endX = laneX(edge.to_lane);
      const endY = Math.min(rowY(targetIndex), commits.length * ROW_HEIGHT);
      const bendY = Math.min(startY + ROW_HEIGHT * 0.55, endY);
      const data = startX === endX
        ? `M ${startX} ${startY} L ${endX} ${endY}`
        : `M ${startX} ${startY} C ${startX} ${bendY}, ${endX} ${bendY}, ${endX} ${endY}`;

      paths.push({
        key: `${commit.oid}:${edge.parent_oid}:${edgeIndex}`,
        data,
        lane: edge.to_lane,
        merge: edge.merge,
      });
    }
  }

  return {
    paths,
    width: GRAPH_PADDING * 2 + maxLane * LANE_WIDTH + LANE_WIDTH,
    height: commits.length * ROW_HEIGHT,
  };
}

function focusRow(current: HTMLElement, index: number): void {
  const listbox = current.closest<HTMLElement>("[data-commit-list]");
  listbox
    ?.querySelector<HTMLElement>(`[data-commit-index="${index}"]`)
    ?.focus();
}

function dateFromUnixSeconds(seconds: number): Date | null {
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function defaultFormatTimestamp(seconds: number): string {
  const date = dateFromUnixSeconds(seconds);
  return date ? dateFormatter.format(date) : "Unknown date";
}

const CommitRow = memo(function CommitRow({
  commit,
  index,
  total,
  selected,
  searchMatch,
  graphWidth,
  onSelect,
  onCommitContextMenu,
  formatTimestamp,
}: CommitRowProps) {
  const openContextMenu = (clientX: number, clientY: number) => {
    onCommitContextMenu?.({ commit, clientX, clientY });
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onCommitContextMenu) return;

    event.preventDefault();
    onSelect(commit);
    openContextMenu(event.clientX, event.clientY);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(event.currentTarget, Math.min(index + 1, total - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(event.currentTarget, Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        focusRow(event.currentTarget, 0);
        break;
      case "End":
        event.preventDefault();
        focusRow(event.currentTarget, total - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onSelect(commit);
        break;
      case "F10":
        if (event.shiftKey && onCommitContextMenu) {
          event.preventDefault();
          onSelect(commit);
          const bounds = event.currentTarget.getBoundingClientRect();
          openContextMenu(bounds.left + Math.min(graphWidth + 24, bounds.width / 2), bounds.top + bounds.height / 2);
        }
        break;
      default:
        break;
    }
  };

  const timestamp = formatTimestamp
    ? formatTimestamp(commit.authored_at.seconds, commit.authored_at.offset_minutes)
    : defaultFormatTimestamp(commit.authored_at.seconds);
  const authoredDate = dateFromUnixSeconds(commit.authored_at.seconds);
  const stateClasses = [
    "gc-commit-row",
    selected ? "gc-commit-row--selected" : "",
    searchMatch ? "gc-commit-row--search-match" : "",
  ].filter(Boolean).join(" ");
  const accessibleLabel = [
    commit.subject,
    `commit ${commit.short_oid}`,
    commit.author.name,
    timestamp,
    searchMatch ? "search result" : "",
  ].filter(Boolean).join(", ");

  return (
    <div
      aria-label={accessibleLabel}
      aria-posinset={index + 1}
      aria-selected={selected}
      aria-setsize={total}
      className={stateClasses}
      data-commit-index={index}
      data-oid={commit.oid}
      onClick={() => onSelect(commit)}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      role="option"
      style={ROW_RENDER_STYLE}
      tabIndex={selected || (index === 0 && !selected) ? 0 : -1}
    >
      <span
        aria-hidden="true"
        className="gc-commit-row__graph-slot"
        style={{ width: graphWidth }}
      />
      <span className="gc-commit-row__content">
        <span className="gc-commit-row__subject" title={commit.subject}>
          {commit.subject || "(no commit message)"}
        </span>
        {commit.decorations.length > 0 ? (
          <span aria-label="References" className="gc-commit-row__decorations">
            {commit.decorations.map((decoration) => (
              <span
                className={`gc-ref-label gc-ref-label--${decoration.kind}${decoration.is_head ? " gc-ref-label--head" : ""}`}
                key={decoration.full_name}
                title={decoration.full_name}
              >
                {decoration.name}
              </span>
            ))}
          </span>
        ) : null}
        <span className="gc-commit-row__metadata">
          <span className="gc-commit-row__author" title={commit.author.email}>
            {commit.author.name}
          </span>
          <time className="gc-commit-row__time" dateTime={authoredDate?.toISOString()}>
            {timestamp}
          </time>
          <span className="gc-commit-row__oid">{commit.short_oid}</span>
        </span>
        {commit.body_preview ? (
          <span className="gc-commit-row__body-preview" title={commit.body_preview}>
            {commit.body_preview}
          </span>
        ) : null}
      </span>
    </div>
  );
});

export function CommitGraph({
  commits,
  selectedOid,
  searchMatchOids,
  onSelect,
  onCommitContextMenu,
  className,
  emptyLabel = "No commits to display.",
  formatTimestamp,
}: CommitGraphProps) {
  const geometry = useMemo(() => buildGraphGeometry(commits), [commits]);

  if (commits.length === 0) {
    return (
      <div className={`gc-commit-graph gc-commit-graph--empty${className ? ` ${className}` : ""}`} role="status">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      aria-label="Commit history"
      className={`gc-commit-graph${className ? ` ${className}` : ""}`}
      data-commit-list
      role="listbox"
    >
      <svg
        aria-hidden="true"
        className="gc-commit-graph__lanes"
        focusable="false"
        height={geometry.height}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        width={geometry.width}
      >
        {geometry.paths.map((path) => (
          <path
            className={`${laneClass("gc-commit-graph__edge", path.lane)}${path.merge ? " gc-commit-graph__edge--merge" : ""}`}
            d={path.data}
            fill="none"
            key={path.key}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {commits.map((commit, index) => (
          <circle
            className={`${laneClass("gc-commit-graph__node", commit.graph.lane)}${commit.oid === selectedOid ? " gc-commit-graph__node--selected" : ""}`}
            cx={laneX(commit.graph.lane)}
            cy={rowY(index)}
            key={commit.oid}
            r={commit.parent_oids.length > 1 ? 5 : 4}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="gc-commit-graph__rows">
        {commits.map((commit, index) => (
          <CommitRow
            commit={commit}
            formatTimestamp={formatTimestamp}
            graphWidth={geometry.width}
            index={index}
            key={commit.oid}
            onCommitContextMenu={onCommitContextMenu}
            onSelect={onSelect}
            searchMatch={searchMatchOids?.has(commit.oid) ?? false}
            selected={commit.oid === selectedOid}
            total={commits.length}
          />
        ))}
      </div>
    </div>
  );
}
