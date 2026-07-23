import { memo, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FolderGit, Monitor, Tag } from "lucide-react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import type { CommitSummary, RefLabel } from "../lib/types";

const ROW_HEIGHT = 28;
const ROW_GAP = 4;
const ROW_STRIDE = ROW_HEIGHT + ROW_GAP;
const LANE_WIDTH = 18;
const GRAPH_PADDING = 24;
const REF_COLUMN_WIDTH = 118;
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
  detachedHeadOid?: string | null;
  remoteIconUrls?: ReadonlyMap<string, string>;
  onSelect: (commit: CommitSummary) => void;
  onNavigateBeforeFirst?: () => void;
  onCommitContextMenu?: (request: CommitContextMenuRequest) => void;
  onCopySha?: (oid: string) => void;
  onRefDoubleClick?: (decoration: RefLabel) => void;
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

type GraphRefLabel = RefLabel & {
  synthetic?: boolean;
};

interface CommitRowProps {
  commit: CommitSummary;
  id: string;
  index: number;
  selected: boolean;
  searchMatch: boolean;
  searchDimmed: boolean;
  hideHeadDecoration: boolean;
  hasMultipleBranches: boolean;
  detachedHeadOid?: string | null;
  remoteIconUrls?: ReadonlyMap<string, string>;
  graphWidth: number;
  onSelect: (commit: CommitSummary) => void;
  onCommitContextMenu?: (request: CommitContextMenuRequest) => void;
  onCopySha?: (oid: string) => void;
  onRefDoubleClick?: (decoration: RefLabel) => void;
  formatTimestamp?: (seconds: number, offsetMinutes: number) => string;
}

function laneX(lane: number): number {
  return GRAPH_PADDING + lane * LANE_WIDTH;
}

export function getCommitLaneX(lane: number): number {
  return laneX(lane);
}

export function getCommitRowBranchOrigin(lane: number): number {
  return REF_COLUMN_WIDTH + laneX(lane) - AVATAR_RADIUS;
}

export function getCommitLaneColorVariable(lane: number): string {
  return `var(--gc-lane-${lane % LANE_COLOR_COUNT})`;
}

function rowY(index: number): number {
  return index * ROW_STRIDE + ROW_HEIGHT / 2;
}

function laneClass(base: string, lane: number): string {
  return `${base} ${base}--lane-${lane % LANE_COLOR_COUNT}`;
}

function isBranchDecoration(decoration: RefLabel): boolean {
  return decoration.kind === "local_branch" || decoration.kind === "remote_branch";
}

function refPriority(decoration: RefLabel): number {
  if (decoration.is_head) return 0;
  if (decoration.kind === "local_branch") return 1;
  if (decoration.kind === "remote_branch") return 2;
  return 3;
}

function sortedDecorations(decorations: readonly GraphRefLabel[]): GraphRefLabel[] {
  return [...decorations].sort((left, right) => (
    refPriority(left) - refPriority(right)
      || left.name.localeCompare(right.name)
      || left.full_name.localeCompare(right.full_name)
  ));
}

function visibleDecorations(
  commit: CommitSummary,
  hideHeadDecoration: boolean,
  detachedHeadOid?: string | null,
): GraphRefLabel[] {
  const decorations: GraphRefLabel[] = commit.decorations
    .filter((decoration) => !hideHeadDecoration || !decoration.is_head);

  if (!hideHeadDecoration && detachedHeadOid === commit.oid && !decorations.some((decoration) => decoration.is_head)) {
    decorations.push({
      name: "HEAD",
      full_name: "HEAD",
      kind: "local_branch",
      is_head: true,
      synthetic: true,
    });
  }

  return sortedDecorations(decorations);
}

function remoteBranchNameWithoutRemote(name: string): string {
  const slashIndex = name.indexOf("/");
  return slashIndex >= 0 ? name.slice(slashIndex + 1) : name;
}

function remoteNameFromBranchName(name: string): string | null {
  const slashIndex = name.indexOf("/");
  return slashIndex > 0 ? name.slice(0, slashIndex) : null;
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

function RefLabelPill({
  decoration,
  inactive,
  linkedRemote,
  remoteIconUrl,
  linkedRemoteIconUrl,
  onDoubleClick,
}: {
  decoration: GraphRefLabel;
  inactive: boolean;
  linkedRemote?: GraphRefLabel;
  remoteIconUrl?: string;
  linkedRemoteIconUrl?: string;
  onDoubleClick?: (decoration: RefLabel) => void;
}) {
  const [remoteImageFailed, setRemoteImageFailed] = useState(false);
  const [linkedRemoteImageFailed, setLinkedRemoteImageFailed] = useState(false);
  const Icon = decoration.kind === "remote_branch"
    ? FolderGit
    : decoration.kind === "tag"
      ? Tag
      : Monitor;
  const classes = [
    "gc-ref-label",
    `gc-ref-label--${decoration.kind}`,
    decoration.is_head ? "gc-ref-label--head" : "",
    inactive ? "gc-ref-label--inactive" : "",
  ].filter(Boolean).join(" ");
  const displayName = decoration.kind === "remote_branch"
    ? remoteBranchNameWithoutRemote(decoration.name)
    : decoration.name;
  const canCheckout = decoration.kind === "local_branch" && !decoration.synthetic;

  return (
    <span
      className={classes}
      onDoubleClick={canCheckout && onDoubleClick ? (event) => {
        event.stopPropagation();
        onDoubleClick(decoration);
      } : undefined}
      title={linkedRemote ? `${decoration.full_name}\n${linkedRemote.full_name}` : decoration.full_name}
    >
      {decoration.is_head ? <Check aria-hidden="true" size={12} strokeWidth={3} /> : null}
      <span className="gc-ref-label__name">{displayName}</span>
      {remoteIconUrl && !remoteImageFailed ? (
        <img
          alt=""
          aria-hidden="true"
          className="gc-ref-label__remote-avatar"
          onError={() => setRemoteImageFailed(true)}
          src={remoteIconUrl}
        />
      ) : (
        <Icon aria-hidden="true" size={decoration.is_head ? 12 : 10} strokeWidth={2.4} />
      )}
      {linkedRemote ? (
        linkedRemoteIconUrl && !linkedRemoteImageFailed ? (
          <img
            alt=""
            aria-hidden="true"
            className="gc-ref-label__remote-avatar gc-ref-label__remote-icon"
            onError={() => setLinkedRemoteImageFailed(true)}
            src={linkedRemoteIconUrl}
          />
        ) : (
          <FolderGit aria-hidden="true" className="gc-ref-label__remote-icon" size={12} strokeWidth={2.4} />
        )
      ) : null}
    </span>
  );
}

function CommitRefStack({
  decorations,
  hasMultipleBranches,
  remoteIconUrls,
  onRefDoubleClick,
}: {
  decorations: readonly GraphRefLabel[];
  hasMultipleBranches: boolean;
  remoteIconUrls?: ReadonlyMap<string, string>;
  onRefDoubleClick?: (decoration: RefLabel) => void;
}) {
  if (decorations.length === 0) return null;

  const hiddenRemoteIndexes = new Set<number>();
  const linkedRemotes = new Map<string, GraphRefLabel>();
  const localBranches = decorations.filter((decoration) => decoration.kind === "local_branch");
  for (const localBranch of localBranches) {
    const remoteIndex = decorations.findIndex((decoration, index) => (
      !hiddenRemoteIndexes.has(index)
        && decoration.kind === "remote_branch"
        && remoteBranchNameWithoutRemote(decoration.name) === localBranch.name
    ));
    if (remoteIndex >= 0) {
      hiddenRemoteIndexes.add(remoteIndex);
      linkedRemotes.set(decorations[remoteIndex].full_name, decorations[remoteIndex]);
      linkedRemotes.set(localBranch.full_name, decorations[remoteIndex]);
    }
  }

  const displayDecorations = decorations.filter((_, index) => !hiddenRemoteIndexes.has(index));
  const branchCount = displayDecorations.filter(isBranchDecoration).length;
  const shouldStack = branchCount > 1;
  const [primary, ...rest] = displayDecorations;
  const isInactive = (decoration: GraphRefLabel) =>
    hasMultipleBranches && decoration.kind === "local_branch" && !decoration.is_head;
  const remoteIconUrl = (decoration?: GraphRefLabel) => {
    if (!decoration) return undefined;
    const remoteName = remoteNameFromBranchName(decoration.name);
    return remoteName ? remoteIconUrls?.get(remoteName) : undefined;
  };

  return (
    <span className={`gc-ref-stack${shouldStack ? " gc-ref-stack--stacked" : ""}`}>
      <RefLabelPill
        decoration={primary}
        inactive={isInactive(primary)}
        linkedRemote={linkedRemotes.get(primary.full_name)}
        linkedRemoteIconUrl={remoteIconUrl(linkedRemotes.get(primary.full_name))}
        onDoubleClick={onRefDoubleClick}
        remoteIconUrl={remoteIconUrl(primary)}
      />
      {rest.length > 0 && shouldStack ? (
        <span className="gc-ref-stack__overflow">
          {rest.map((decoration) => (
            <RefLabelPill
              decoration={decoration}
              inactive={isInactive(decoration)}
              key={decoration.full_name}
              linkedRemote={linkedRemotes.get(decoration.full_name)}
              linkedRemoteIconUrl={remoteIconUrl(linkedRemotes.get(decoration.full_name))}
              onDoubleClick={onRefDoubleClick}
              remoteIconUrl={remoteIconUrl(decoration)}
            />
          ))}
        </span>
      ) : null}
      {rest.length > 0 && !shouldStack ? rest.map((decoration) => (
        <RefLabelPill
          decoration={decoration}
          inactive={isInactive(decoration)}
          key={decoration.full_name}
          linkedRemote={linkedRemotes.get(decoration.full_name)}
          linkedRemoteIconUrl={remoteIconUrl(linkedRemotes.get(decoration.full_name))}
          onDoubleClick={onRefDoubleClick}
          remoteIconUrl={remoteIconUrl(decoration)}
        />
      )) : null}
    </span>
  );
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
  searchDimmed,
  hideHeadDecoration,
  hasMultipleBranches,
  detachedHeadOid,
  remoteIconUrls,
  graphWidth,
  onSelect,
  onCommitContextMenu,
  onCopySha,
  onRefDoubleClick,
  formatTimestamp,
}: CommitRowProps) {
  const openContextMenu = (clientX: number, clientY: number) => {
    onCommitContextMenu?.({ commit, clientX, clientY });
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onCommitContextMenu) return;

    event.preventDefault();
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
    searchDimmed ? "gc-commit-row--search-dimmed" : "",
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
    "--gc-row-branch-color": getCommitLaneColorVariable(commit.graph.lane),
  } as CSSProperties;
  const graphSlotStyle = {
    width: graphWidth,
    "--gc-branch-origin": `${branchOrigin}px`,
    "--gc-branch-interactive-origin": `${branchInteractiveOrigin}px`,
  } as CSSProperties;
  const decorations = visibleDecorations(commit, hideHeadDecoration, detachedHeadOid);

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
        <CommitRefStack
          decorations={decorations}
          hasMultipleBranches={hasMultipleBranches}
          onRefDoubleClick={onRefDoubleClick}
          remoteIconUrls={remoteIconUrls}
        />
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
  detachedHeadOid = null,
  remoteIconUrls,
  onSelect,
  onNavigateBeforeFirst,
  onCommitContextMenu,
  onCopySha,
  onRefDoubleClick,
  className,
  emptyLabel = "No commits to display.",
  formatTimestamp,
}: CommitGraphProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const geometry = useMemo(() => buildGraphGeometry(commits), [commits]);
  const timeMarkers = useMemo(() => buildTimeMarkers(commits, Math.floor(Date.now() / 1_000)), [commits]);
  const hasMultipleBranches = useMemo(() => {
    const branchNames = new Set<string>();
    for (const commit of commits) {
      for (const decoration of commit.decorations) {
        if (isBranchDecoration(decoration)) branchNames.add(decoration.full_name);
      }
    }
    return branchNames.size > 1;
  }, [commits]);
  const selectedIndex = useMemo(
    () => commits.findIndex((commit) => commit.oid === selectedOid),
    [commits, selectedOid],
  );
  const searchActive = (searchMatchOids?.size ?? 0) > 0;
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
      <div aria-hidden="true" className="gc-commit-time-markers gc-commit-time-markers--lines">
        {timeMarkers.map((marker) => (
          <span className="gc-commit-time-marker" key={marker.key} style={{ top: marker.top }} />
        ))}
      </div>
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
            detachedHeadOid={detachedHeadOid}
            formatTimestamp={formatTimestamp}
            graphWidth={geometry.width}
            hasMultipleBranches={hasMultipleBranches}
            hideHeadDecoration={hideHeadDecoration}
            id={`commit-row-${commit.oid}`}
            index={index}
            key={commit.oid}
            onCommitContextMenu={onCommitContextMenu}
            onCopySha={onCopySha}
            onRefDoubleClick={onRefDoubleClick}
            onSelect={onSelect}
            remoteIconUrls={remoteIconUrls}
            searchDimmed={
              searchActive
              && commit.oid !== selectedOid
              && !searchMatchOids?.has(commit.oid)
            }
            searchMatch={searchMatchOids?.has(commit.oid) ?? false}
            selected={commit.oid === selectedOid}
          />
        ))}
      </div>
      <div aria-hidden="true" className="gc-commit-time-markers gc-commit-time-markers--labels">
        {timeMarkers.map((marker) => (
          <span className="gc-commit-time-marker__label" key={marker.key} style={{ top: marker.top }}>
            {marker.label}
          </span>
        ))}
      </div>
    </div>
  );
}
