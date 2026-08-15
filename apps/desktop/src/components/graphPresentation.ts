import { GRAPH_LANE_SLOTS } from "../lib/styles";
import type { CommitSummary } from "../lib/types";

const FIRST_COLOR_SLOT = 0;
const STASH_COLOR_FLOOR_WITH_WIP = 1;

export function getGraphEdgeColor(
  commit: CommitSummary,
  edgeIndex: number,
  colors: ReadonlyMap<string, number>,
): number {
  const commitColor = colors.get(commit.oid) ?? FIRST_COLOR_SLOT;
  return edgeIndex === 0 || commit.stash
    ? commitColor
    : colors.get(commit.graph.edges[edgeIndex].parent_oid) ?? commitColor;
}

function buildPrimaryComponent(commits: readonly CommitSummary[]): Set<string> {
  const adjacent = new Map<string, Set<string>>();
  const connect = (left: string, right: string) => {
    if (!adjacent.has(left)) adjacent.set(left, new Set());
    if (!adjacent.has(right)) adjacent.set(right, new Set());
    adjacent.get(left)?.add(right);
    adjacent.get(right)?.add(left);
  };

  for (const commit of commits) {
    if (!adjacent.has(commit.oid)) adjacent.set(commit.oid, new Set());
    for (const parentOid of commit.parent_oids) connect(commit.oid, parentOid);
  }

  const head = commits.find((commit) => (
    commit.decorations.some((decoration) => decoration.is_head)
  )) ?? commits[0];
  if (!head) return new Set();

  const connected = new Set<string>();
  const pending = [head.oid];
  while (pending.length > 0) {
    const oid = pending.pop();
    if (!oid || connected.has(oid)) continue;
    connected.add(oid);
    for (const neighbor of adjacent.get(oid) ?? []) pending.push(neighbor);
  }
  return connected;
}

// Colors belong to branch spans rather than physical lane numbers. A branch
// can be placed in a high-numbered lane when many older lines are still open;
// using `lane % palette` there shifts and repeats the visible color sequence.
export function buildBranchColors(
  commits: readonly CommitSummary[],
  hasWip: boolean,
): Map<string, number> {
  const rowOf = new Map<string, number>();
  for (let index = 0; index < commits.length; index += 1) rowOf.set(commits[index].oid, index);

  const primaryComponent = buildPrimaryComponent(commits);
  const groupOf = new Map<string, number>();
  const spans: { start: number; end: number; lane: number }[] = [];
  const anchorOf: string[] = [];
  const offPageRow = commits.length;
  const openGroup = (row: number, lane: number, anchor: string): number => {
    spans.push({ start: row, end: row, lane });
    anchorOf.push(anchor);
    return spans.length - 1;
  };
  const extend = (group: number, row: number) => {
    spans[group].start = Math.min(spans[group].start, row);
    spans[group].end = Math.max(spans[group].end, row);
  };
  const parentRow = (parentOid: string) => rowOf.get(parentOid) ?? offPageRow;

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    if (commit.stash) continue;

    let group = groupOf.get(commit.oid);
    if (group === undefined) {
      group = openGroup(index, commit.graph.lane, commit.oid);
      groupOf.set(commit.oid, group);
    }
    extend(group, index);

    for (let edgeIndex = 0; edgeIndex < commit.graph.edges.length; edgeIndex += 1) {
      const edge = commit.graph.edges[edgeIndex];
      const parentOid = edge.parent_oid;

      if (edgeIndex === 0) {
        // At a convergence, the branch that continues vertically through the
        // parent's physical lane owns the parent span. A bending child may
        // provisionally claim an unseen parent, but a later straight route
        // replaces that claim (feature 1 -> base 0, main 0 -> base 0).
        if (!groupOf.has(parentOid) || edge.from_lane === edge.to_lane) {
          groupOf.set(parentOid, group);
        }
        extend(group, parentRow(parentOid));
        continue;
      }

      let mergeGroup = groupOf.get(parentOid);
      if (mergeGroup === undefined) {
        mergeGroup = openGroup(index, edge.to_lane, parentOid);
        groupOf.set(parentOid, mergeGroup);
      }
      extend(mergeGroup, index);
      extend(mergeGroup, parentRow(parentOid));
    }
  }

  const stashGroups = new Set<number>();
  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    if (!commit.stash || groupOf.has(commit.oid)) continue;

    const group = openGroup(index, commit.graph.lane, commit.oid);
    stashGroups.add(group);
    groupOf.set(commit.oid, group);
    for (const edge of commit.graph.edges) extend(group, parentRow(edge.parent_oid));
  }

  const slots = new Array<number>(spans.length);
  const order = spans
    .map((_, group) => group)
    .sort((left, right) => (
      spans[left].start - spans[right].start
        || spans[left].lane - spans[right].lane
        || left - right
    ));
  let restart = 0;

  for (const group of order) {
    const floor = stashGroups.has(group) && hasWip
      ? STASH_COLOR_FLOOR_WITH_WIP
      : FIRST_COLOR_SLOT;
    const lane = spans[group].lane;
    const paletteBlock = Math.floor(lane / GRAPH_LANE_SLOTS);
    const independentComponent = !primaryComponent.has(anchorOf[group]);
    const taken = new Set<number>();
    for (const other of order) {
      if (slots[other] === undefined) continue;
      if (
        !independentComponent
        && Math.floor(spans[other].lane / GRAPH_LANE_SLOTS) !== paletteBlock
      ) continue;
      if (spans[other].start <= spans[group].end && spans[group].start <= spans[other].end) {
        taken.add(slots[other]);
      }
    }

    // The first palette-sized block is canonical: lane 0 is primary, lane 1
    // secondary, and so on. Reusing that color for another span in the same
    // physical lane keeps long-lived trunk/feature lines stable across merges.
    // This remains true when the lane belongs to another Git root component.
    if (lane < GRAPH_LANE_SLOTS && lane >= floor) {
      slots[group] = lane;
      continue;
    }

    // Every overflow block restarts the palette. Within that block a branch
    // moves right only when an overlapping sibling already owns its preferred
    // color. Thus lanes 10-12 restart at 0-2, while overlapping fan-out still
    // spreads across the remaining slots.
    const preferred = Math.max(floor, lane % GRAPH_LANE_SLOTS);
    let chosen: number | undefined;
    for (let offset = 0; offset < GRAPH_LANE_SLOTS; offset += 1) {
      const candidate = (preferred + offset) % GRAPH_LANE_SLOTS;
      if (candidate >= floor && !taken.has(candidate)) {
        chosen = candidate;
        break;
      }
    }

    slots[group] = chosen ?? Math.max(floor, restart % GRAPH_LANE_SLOTS);
    restart += Number(chosen === undefined);
  }

  const colors = new Map<string, number>();
  for (const [oid, group] of groupOf) colors.set(oid, slots[group]);
  return colors;
}
