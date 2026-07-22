import { memo, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import type { CommitSummary } from "../lib/types";

const ROW_HEIGHT = 28;
const ROW_GAP = 4;
const ROW_STRIDE = ROW_HEIGHT + ROW_GAP;
const LANE_WIDTH = 18;
const GRAPH_PADDING = 24;
const REF_COLUMN_WIDTH = 140;
const MIN_GRAPH_WIDTH = 96;
const LANE_COLOR_COUNT = 8;
const AVATAR_RADIUS = 11;

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
  beforeFirstSelected?: boolean;
  searchMatchOids?: ReadonlySet<string>;
  hideHeadDecoration?: boolean;
  onSelect: (commit: CommitSummary) => void;
  onNavigateBeforeFirst?: () => void;
  onCommitContextMenu?: (request: CommitContextMenuRequest) => void;
  onCopySha?: (oid: string) => void;
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

interface TimeMarker {
  key: string;
  label: string;
  top: number;
}

interface CommitRowProps {
  commit: CommitSummary;
  id: string;
  index: number;
  selected: boolean;
  searchMatch: boolean;
  hideHeadDecoration: boolean;
  graphWidth: number;
  onSelect: (commit: CommitSummary) => void;
  onCommitContextMenu?: (request: CommitContextMenuRequest) => void;
  onCopySha?: (oid: string) => void;
  formatTimestamp?: (seconds: number, offsetMinutes: number) => string;
}

function laneX(lane: number): number {
  return GRAPH_PADDING + lane * LANE_WIDTH;
}

function rowY(index: number): number {
  return index * ROW_STRIDE + ROW_HEIGHT / 2;
}

function laneClass(base: string, lane: number): string {
  return `${base} ${base}--lane-${lane % LANE_COLOR_COUNT}`;
}

export function getCommitGraphWidth(commits: readonly CommitSummary[]): number {
  let maxLane = 0;

  for (const commit of commits) {
    maxLane = Math.max(maxLane, commit.graph.lane);
    for (const edge of commit.graph.edges) {
      maxLane = Math.max(maxLane, edge.from_lane, edge.to_lane);
    }
  }

  return Math.max(MIN_GRAPH_WIDTH, GRAPH_PADDING * 2 + maxLane * LANE_WIDTH + LANE_WIDTH);
}

function buildGraphGeometry(commits: readonly CommitSummary[]): GraphGeometry {
  const commitIndex = new Map<string, number>();

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    commitIndex.set(commit.oid, index);
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
      const endY = Math.min(rowY(targetIndex), commits.length * ROW_STRIDE - ROW_GAP);
      const bendY = Math.min(startY + ROW_STRIDE * 0.55, endY);
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
    width: getCommitGraphWidth(commits),
    height: commits.length * ROW_STRIDE - ROW_GAP,
  };
}

function dateFromUnixSeconds(seconds: number): Date | null {
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function defaultFormatTimestamp(seconds: number): string {
  const date = dateFromUnixSeconds(seconds);
  return date ? dateFormatter.format(date) : "Unknown date";
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

function relativeTimeMarkerLabel(seconds: number, nowSeconds: number): string {
  const elapsedSeconds = Math.max(0, nowSeconds - seconds);
  const elapsedHours = Math.floor(elapsedSeconds / 3_600);
  const elapsedDays = Math.floor(elapsedSeconds / 86_400);

  // Coarse buckets like GitKraken: no sub-hour subdivision, so a batch of
  // commits made minutes apart shares one bucket and produces no divider.
  if (elapsedHours < 1) return "less than an hour ago";
  if (elapsedDays < 1) return elapsedHours === 1 ? "an hour ago" : plural(elapsedHours, "hour");
  if (elapsedDays === 1) return "yesterday";
  if (elapsedDays < 7) return plural(elapsedDays, "day");
  if (elapsedDays < 14) return "a week ago";
  if (elapsedDays < 30) return plural(Math.floor(elapsedDays / 7), "week");
  if (elapsedDays < 60) return "a month ago";
  if (elapsedDays < 365) return plural(Math.floor(elapsedDays / 30), "month");
  if (elapsedDays < 730) return "a year ago";
  return plural(Math.floor(elapsedDays / 365), "year");
}

function buildTimeMarkers(commits: readonly CommitSummary[], nowSeconds: number): TimeMarker[] {
  const markers: TimeMarker[] = [];
  let previousLabel: string | null = null;

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    const label = relativeTimeMarkerLabel(commit.authored_at.seconds, nowSeconds);
    if (index > 0 && label !== previousLabel) {
      markers.push({
        key: `${commit.oid}:${label}`,
        label,
        top: Math.max(0, index * ROW_STRIDE - ROW_GAP / 2),
      });
    }
    previousLabel = label;
  }

  return markers;
}

function RowShaButton({ oid, shortOid, onCopy }: { oid: string; shortOid: string; onCopy: (oid: string) => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);
  const showTooltip = () => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(340, window.innerWidth - 16);
    const left = Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8));
    const top = bounds.bottom + 58 <= window.innerHeight ? bounds.bottom + 7 : Math.max(8, bounds.top - 55);
    setTooltipPosition({ left, top });
  };

  return (
    <>
      <button
        aria-label={`Copy full commit SHA ${oid}`}
        className="gc-sha-copy gc-sha-copy--row"
        onBlur={() => setTooltipPosition(null)}
        onClick={(event) => {
          event.stopPropagation();
          onCopy(oid);
        }}
        onFocus={showTooltip}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setTooltipPosition(null)}
        ref={buttonRef}
        type="button"
      >
        {shortOid}
      </button>
      {tooltipPosition ? createPortal(
        <span className="gc-sha-row-tooltip" role="tooltip" style={tooltipPosition}>
          <code>{oid}</code>
          <small>Click to copy</small>
        </span>,
        document.body,
      ) : null}
    </>
  );
}

const CommitRow = memo(function CommitRow({
  commit,
  id,
  index,
  selected,
  searchMatch,
  hideHeadDecoration,
  graphWidth,
  onSelect,
  onCommitContextMenu,
  onCopySha,
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

  const timestamp = formatTimestamp
    ? formatTimestamp(commit.authored_at.seconds, commit.authored_at.offset_minutes)
    : defaultFormatTimestamp(commit.authored_at.seconds);
  const authoredDate = dateFromUnixSeconds(commit.authored_at.seconds);
  const initials = commit.author.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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
  const branchOrigin = laneX(commit.graph.lane);
  const branchHoverOrigin = branchOrigin - AVATAR_RADIUS;
  const branchInteractiveOrigin = branchOrigin + AVATAR_RADIUS;
  const rowStyle = {
    "--gc-branch-row-origin": `${REF_COLUMN_WIDTH + branchHoverOrigin}px`,
    "--gc-row-branch-color": `var(--gc-lane-${commit.graph.lane % LANE_COLOR_COUNT})`,
  } as CSSProperties;
  const graphSlotStyle = {
    width: graphWidth,
    "--gc-branch-origin": `${branchOrigin}px`,
    "--gc-branch-interactive-origin": `${branchInteractiveOrigin}px`,
  } as CSSProperties;

  return (
    <div
      aria-label={accessibleLabel}
      aria-rowindex={index + 1}
      aria-selected={selected}
      className={stateClasses}
      data-commit-index={index}
      data-oid={commit.oid}
      id={id}
      onClick={(event) => {
        event.currentTarget.closest<HTMLElement>("[data-commit-list]")?.focus();
        onSelect(commit);
      }}
      onContextMenu={handleContextMenu}
      role="row"
      style={rowStyle}
    >
      <span aria-label="References" className="gc-commit-row__decorations" role="cell">
        {commit.decorations.filter((decoration) => !hideHeadDecoration || !decoration.is_head).map((decoration) => (
          <span
            className={`gc-ref-label gc-ref-label--${decoration.kind}${decoration.is_head ? " gc-ref-label--head" : ""}`}
            key={decoration.full_name}
            title={decoration.full_name}
          >
            {decoration.name}
          </span>
        ))}
      </span>
      <span
        aria-label="Graph"
        className={laneClass("gc-commit-row__graph-slot", commit.graph.lane)}
        role="cell"
        style={graphSlotStyle}
      >
        <span
          aria-hidden="true"
          className={`gc-commit-row__avatar${selected ? " gc-commit-row__avatar--selected" : ""}`}
          style={{ left: laneX(commit.graph.lane) }}
        >
          {initials.slice(0, 1) || "?"}
        </span>
      </span>
      <span className="gc-commit-row__subject" role="cell" title={commit.body_preview || commit.subject}>
        {commit.subject || "(no commit message)"}
      </span>
      <span className="gc-commit-row__author" role="cell" title={commit.author.email}>
        {commit.author.name}
      </span>
      <time className="gc-commit-row__time" dateTime={authoredDate?.toISOString()} role="cell" title={timestamp}>
        {timestamp}
      </time>
      <span className="gc-commit-row__oid-wrap" role="cell">
        {onCopySha ? (
          <RowShaButton oid={commit.oid} onCopy={onCopySha} shortOid={commit.short_oid} />
        ) : <span className="gc-commit-row__oid">{commit.short_oid}</span>}
      </span>
    </div>
  );
});

export function CommitGraph({
  commits,
  selectedOid,
  beforeFirstSelected = false,
  searchMatchOids,
  hideHeadDecoration = false,
  onSelect,
  onNavigateBeforeFirst,
  onCommitContextMenu,
  onCopySha,
  className,
  emptyLabel = "No commits to display.",
  formatTimestamp,
}: CommitGraphProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const geometry = useMemo(() => buildGraphGeometry(commits), [commits]);
  const timeMarkers = useMemo(() => buildTimeMarkers(commits, Math.floor(Date.now() / 1_000)), [commits]);
  const selectedIndex = useMemo(
    () => commits.findIndex((commit) => commit.oid === selectedOid),
    [commits, selectedOid],
  );
  const activeCommit = selectedIndex >= 0 ? commits[selectedIndex] : beforeFirstSelected ? undefined : commits[0];
  const activeDescendant = activeCommit ? `commit-row-${activeCommit.oid}` : undefined;

  const selectIndex = (index: number) => {
    const commit = commits[index];
    if (!commit) return;

    onSelect(commit);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-commit-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;

    const currentIndex = selectedIndex >= 0 ? selectedIndex : beforeFirstSelected ? -1 : 0;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        selectIndex(Math.min(currentIndex + 1, commits.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        if (currentIndex <= 0 && onNavigateBeforeFirst) onNavigateBeforeFirst();
        else selectIndex(Math.max(currentIndex - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        selectIndex(0);
        break;
      case "End":
        event.preventDefault();
        selectIndex(commits.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectIndex(currentIndex);
        break;
      case "F10":
        if (event.shiftKey && onCommitContextMenu) {
          event.preventDefault();
          const selectedCommit = activeCommit ?? commits[0];
          const selectedRow = listRef.current
            ?.querySelector<HTMLElement>(`[data-oid="${selectedCommit.oid}"]`);
          const bounds = selectedRow?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
          onSelect(selectedCommit);
          onCommitContextMenu({
            commit: selectedCommit,
            clientX: bounds.left + Math.min(geometry.width + 24, bounds.width / 2),
            clientY: bounds.top + bounds.height / 2,
          });
        }
        break;
      default:
        break;
    }
  };

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
      aria-activedescendant={activeDescendant}
      aria-rowcount={commits.length}
      className={`gc-commit-graph${className ? ` ${className}` : ""}`}
      data-commit-list
      onKeyDown={handleKeyDown}
      ref={listRef}
      role="grid"
      tabIndex={0}
    >
      <svg
        aria-hidden="true"
        className="gc-commit-graph__lanes"
        focusable="false"
        height={geometry.height}
        style={{ left: REF_COLUMN_WIDTH }}
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
            hideHeadDecoration={hideHeadDecoration}
            id={`commit-row-${commit.oid}`}
            index={index}
            key={commit.oid}
            onCommitContextMenu={onCommitContextMenu}
            onCopySha={onCopySha}
            onSelect={onSelect}
            searchMatch={searchMatchOids?.has(commit.oid) ?? false}
            selected={commit.oid === selectedOid}
          />
        ))}
      </div>
      <div aria-hidden="true" className="gc-commit-time-markers">
        {timeMarkers.map((marker) => (
          <span className="gc-commit-time-marker" key={marker.key} style={{ top: marker.top }}>
            <span>{marker.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
