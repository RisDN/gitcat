use std::collections::{HashMap, HashSet};

use gitcat_contracts::{CommitSummary, GraphCell, GraphEdge, LaneState};

const STASH_LANE_FLOOR: usize = 0;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GraphLayoutContext {
    pub wip_head_oid: Option<String>,
}

/// Adds deterministic clean-worktree graph lane information to topologically ordered commits.
///
/// Each lane head is the next commit expected in that lane. Keeping `lanes`
/// between calls carries still-active routes across history pages.
pub fn layout_commits(commits: &mut [CommitSummary], lanes: &mut LaneState) {
    layout_commits_with_context(commits, lanes, &GraphLayoutContext::default());
}

/// Adds deterministic graph lane information with repository presentation context.
///
/// Clean graphs follow row order. When worktree changes add a WIP row, its HEAD
/// commit and first-parent span own the primary lane.
pub fn layout_commits_with_context(
    commits: &mut [CommitSummary],
    lanes: &mut LaneState,
    context: &GraphLayoutContext,
) {
    seed_wip_lane(context, &mut lanes.heads);
    let mut materialized_lanes = lanes
        .heads
        .iter()
        .enumerate()
        .filter_map(|(lane, head)| head.is_some().then_some(lane))
        .collect::<HashSet<_>>();

    let merge_convergences = build_merge_convergences(commits);
    let mut commit_lanes = Vec::with_capacity(commits.len());
    let mut parent_lanes: HashMap<String, usize> = HashMap::new();

    let mut terminated_lanes: HashSet<usize> = HashSet::new();
    let mut merge_reserved: HashMap<String, usize> = HashMap::new();

    for commit in commits.iter() {
        let lane = lane_for_commit(
            &mut lanes.heads,
            commit,
            &materialized_lanes,
            &terminated_lanes,
            &merge_reserved,
        );

        // A malformed or externally supplied cursor may contain the same head
        // more than once. Consume every copy so no phantom lane survives.
        for head in &mut lanes.heads {
            if head.as_deref() == Some(commit.oid.as_str()) {
                *head = None;
            }
        }

        commit_lanes.push(lane);
        materialized_lanes.insert(lane);

        for (parent_index, parent_oid) in commit.parent_oids.iter().enumerate() {
            let anchors_wip_span =
                parent_index == 0 && context.wip_head_oid.as_deref() == Some(commit.oid.as_str());
            let claimed_lane = lanes
                .heads
                .iter()
                .position(|head| head.as_deref() == Some(parent_oid.as_str()));
            let merge_reserved_lane = merge_reserved.get(parent_oid.as_str()).copied();
            let pulls_first_parent_left = parent_index == 0
                && commit.stash.is_none()
                && lanes.heads[lane].is_none()
                && merge_reserved_lane != claimed_lane
                && claimed_lane.is_some_and(|claimed_lane| lane < claimed_lane);

            let parent_lane = if anchors_wip_span || pulls_first_parent_left {
                // A branch rendered above this row may already have claimed
                // the shared ancestor on a lane to the right. Keep that
                // duplicate head alive so its bend cannot be reused early,
                // while moving the shared endpoint onto the lower branch lane.
                lanes.heads[lane] = Some(parent_oid.clone());
                lane
            } else {
                match claimed_lane {
                    Some(claimed_lane) => claimed_lane,
                    None => {
                        let inherits_lane = parent_index == 0 && commit.stash.is_none();
                        if parent_index > 0 {
                            let allocated =
                                allocate_lane(&mut lanes.heads, parent_oid, None, lane + 1);
                            merge_reserved.insert(parent_oid.clone(), allocated);
                            allocated
                        } else {
                            let preferred_lane =
                                (inherits_lane && lanes.heads[lane].is_none()).then_some(lane);
                            allocate_lane(&mut lanes.heads, parent_oid, preferred_lane, 0)
                        }
                    }
                }
            };

            let steps_out_to_a_merge_lane = parent_index == 0
                && commit.stash.is_none()
                && parent_lane > lane
                && merge_reserved_lane == Some(parent_lane)
                && merge_reserved.get(commit.oid.as_str()) != Some(&lane);
            if steps_out_to_a_merge_lane && lanes.heads[lane].is_none() {
                lanes.heads[lane] = Some(parent_oid.clone());
            }

            parent_lanes.insert(parent_oid.clone(), parent_lane);
        }

        if let Some(convergence) = merge_convergences.get(commit.oid.as_str()) {
            let already_reserved = lanes
                .heads
                .iter()
                .any(|head| head.as_deref() == Some(convergence.as_str()));
            if !already_reserved {
                if let Some(open_lane) = lanes.heads.iter().position(Option::is_none) {
                    if open_lane < lane {
                        lanes.heads[open_lane] = Some(convergence.clone());
                    }
                }
            }
        }

        if lanes.heads[lane].is_none() {
            let bending_parent = commit.parent_oids.iter().find(|parent_oid| {
                parent_lanes
                    .get(parent_oid.as_str())
                    .is_some_and(|parent_lane| *parent_lane < lane)
            });
            if let Some(parent_oid) = bending_parent {
                lanes.heads[lane] = Some(parent_oid.clone());
            }
        }

        // A lane emptied by a convergence is recycled: its route continued in
        // another lane. A lane whose own route simply ended stays dead.
        for (index, head) in lanes.heads.iter().enumerate() {
            if head.is_some() {
                terminated_lanes.remove(&index);
            }
        }
        if lanes.heads[lane].is_none() {
            terminated_lanes.insert(lane);
        }
    }

    for (index, commit) in commits.iter_mut().enumerate() {
        let lane = commit_lanes[index];
        let edges = commit
            .parent_oids
            .iter()
            .enumerate()
            .map(|(parent_index, parent_oid)| GraphEdge {
                parent_oid: parent_oid.clone(),
                from_lane: lane,
                to_lane: parent_lanes.get(parent_oid).copied().unwrap_or(lane),
                merge: parent_index > 0,
            })
            .collect();

        commit.graph = GraphCell { lane, edges };
    }
}

fn build_merge_convergences(commits: &[CommitSummary]) -> HashMap<String, String> {
    let parents: HashMap<&str, &[String]> = commits
        .iter()
        .map(|commit| (commit.oid.as_str(), commit.parent_oids.as_slice()))
        .collect();
    let mut result = HashMap::new();

    for (index, commit) in commits.iter().enumerate() {
        let Some((first_parent, other_parents)) = commit.parent_oids.split_first() else {
            continue;
        };
        if other_parents.is_empty() {
            continue;
        }

        let mut common = reachable_ancestors(first_parent, &parents);
        for parent in other_parents {
            let ancestors = reachable_ancestors(parent, &parents);
            common.retain(|oid| ancestors.contains(oid));
        }

        if let Some(convergence) = commits[index + 1..]
            .iter()
            .find(|candidate| common.contains(candidate.oid.as_str()))
        {
            result.insert(commit.oid.clone(), convergence.oid.clone());
        }
    }

    result
}

fn reachable_ancestors<'a>(
    start: &'a str,
    parents: &HashMap<&'a str, &'a [String]>,
) -> HashSet<&'a str> {
    let mut reachable = HashSet::new();
    let mut pending = vec![start];

    while let Some(oid) = pending.pop() {
        if !reachable.insert(oid) {
            continue;
        }
        if let Some(parent_oids) = parents.get(oid) {
            pending.extend(parent_oids.iter().map(String::as_str));
        }
    }

    reachable
}

fn seed_wip_lane(context: &GraphLayoutContext, heads: &mut Vec<Option<String>>) {
    if !heads.is_empty() {
        return;
    }

    if let Some(wip_head_oid) = &context.wip_head_oid {
        heads.push(Some(wip_head_oid.clone()));
    }
}

fn lane_for_commit(
    heads: &mut Vec<Option<String>>,
    commit: &CommitSummary,
    materialized_lanes: &HashSet<usize>,
    terminated_lanes: &HashSet<usize>,
    merge_reserved: &HashMap<String, usize>,
) -> usize {
    if let Some(lane) = merge_reserved.get(commit.oid.as_str()) {
        if heads
            .get(*lane)
            .is_some_and(|head| head.as_deref() == Some(commit.oid.as_str()))
        {
            return *lane;
        }
    }

    if let Some(lane) = heads
        .iter()
        .position(|head| head.as_deref() == Some(commit.oid.as_str()))
    {
        return lane;
    }

    // Stashes are short-lived side lines above their base commit. They may
    // temporarily share a lane reserved for a branch that has no row yet, but
    // must skip a branch line that is already visible and still active.
    // Keeping stashes out of `heads` preserves branch reservations.
    if commit.stash.is_some() {
        let mut lane = STASH_LANE_FLOOR;
        while materialized_lanes.contains(&lane) && heads.get(lane).is_some_and(Option::is_some) {
            lane += 1;
        }
        if lane >= heads.len() {
            heads.resize(lane + 1, None);
        }
        return lane;
    }

    allocate_interior_hole_or_after_rightmost(heads, &commit.oid, 0, terminated_lanes)
}

fn allocate_interior_hole_or_after_rightmost(
    heads: &mut Vec<Option<String>>,
    oid: &str,
    floor: usize,
    terminated_lanes: &HashSet<usize>,
) -> usize {
    let leftmost_active = heads.iter().position(Option::is_some);
    let rightmost_active = heads.iter().rposition(Option::is_some);
    let interior_hole = leftmost_active
        .zip(rightmost_active)
        .and_then(|(left, right)| {
            ((left + 1).max(floor)..right)
                .find(|lane| heads[*lane].is_none() && !terminated_lanes.contains(lane))
        });

    if let Some(lane) = interior_hole {
        heads[lane] = Some(oid.to_owned());
        lane
    } else {
        allocate_after_rightmost(heads, oid, floor)
    }
}

fn allocate_after_rightmost(heads: &mut Vec<Option<String>>, oid: &str, floor: usize) -> usize {
    if let Some(rightmost_lane) = heads.iter().rposition(Option::is_some) {
        let lane = (rightmost_lane + 1).max(floor);
        if lane == heads.len() {
            heads.push(Some(oid.to_owned()));
        } else {
            heads.resize(lane + 1, None);
            heads[lane] = Some(oid.to_owned());
        }
        return lane;
    }

    heads.resize(floor + 1, None);
    heads[floor] = Some(oid.to_owned());
    floor
}

fn allocate_lane(
    heads: &mut Vec<Option<String>>,
    oid: &str,
    preferred_lane: Option<usize>,
    floor: usize,
) -> usize {
    let lane = preferred_lane
        .filter(|lane| *lane >= floor && heads.get(*lane).is_some_and(Option::is_none))
        .or_else(|| {
            heads
                .iter()
                .skip(floor)
                .position(Option::is_none)
                .map(|lane| lane + floor)
        })
        .unwrap_or_else(|| {
            heads.resize(floor.max(heads.len()) + 1, None);
            heads.len() - 1
        });

    heads[lane] = Some(oid.to_owned());
    lane
}

#[cfg(test)]
mod tests {
    use gitcat_contracts::{CommitTime, GraphCell, Identity, RefKind, RefLabel, StashRef};

    use super::*;

    fn commit(oid: &str, parents: &[&str]) -> CommitSummary {
        CommitSummary {
            oid: oid.into(),
            short_oid: oid.into(),
            parent_oids: parents.iter().map(|parent| (*parent).into()).collect(),
            subject: oid.into(),
            body_preview: String::new(),
            author: Identity {
                name: "Test".into(),
                email: "test@example.com".into(),
            },
            authored_at: CommitTime {
                seconds: 0,
                offset_minutes: 0,
            },
            committed_at: CommitTime {
                seconds: 0,
                offset_minutes: 0,
            },
            decorations: Vec::new(),
            stash: None,
            graph: GraphCell::default(),
        }
    }

    fn stash_commit(oid: &str, parents: &[&str]) -> CommitSummary {
        CommitSummary {
            stash: Some(StashRef {
                index: 0,
                selector: "stash@{0}".into(),
                oid: format!("{oid}-outer"),
            }),
            ..commit(oid, parents)
        }
    }

    fn branch_tip(mut commit: CommitSummary, name: &str, is_head: bool) -> CommitSummary {
        commit.decorations.push(RefLabel {
            name: name.into(),
            full_name: format!("refs/heads/{name}"),
            kind: RefKind::LocalBranch,
            is_head,
        });
        commit
    }

    fn layout_clean(commits: &mut [CommitSummary], lanes: &mut LaneState) {
        layout_commits(commits, lanes);
    }

    fn layout_with_wip(commits: &mut [CommitSummary], lanes: &mut LaneState, wip_head_oid: &str) {
        layout_commits_with_context(
            commits,
            lanes,
            &GraphLayoutContext {
                wip_head_oid: Some(wip_head_oid.into()),
            },
        );
    }

    #[test]
    fn clean_checkout_does_not_override_row_order() {
        let history = vec![
            branch_tip(commit("feature", &["base"]), "feature", false),
            branch_tip(commit("main", &["base"]), "main", true),
            commit("base", &[]),
        ];
        let mut main_checked_out = history.clone();
        let mut feature_checked_out = history;
        feature_checked_out[0].decorations[0].is_head = true;
        feature_checked_out[1].decorations[0].is_head = false;

        layout_clean(&mut main_checked_out, &mut LaneState { heads: Vec::new() });
        layout_clean(
            &mut feature_checked_out,
            &mut LaneState { heads: Vec::new() },
        );

        for commits in [&main_checked_out, &feature_checked_out] {
            assert_eq!(commits[0].graph.lane, 0);
            assert_eq!(commits[1].graph.lane, 1);
            assert_eq!(commits[2].graph.lane, 0);
            assert_eq!(commits[0].graph.edges[0].to_lane, 0);
            assert_eq!(commits[1].graph.edges[0].to_lane, 0);
        }
    }

    #[test]
    fn wip_checkout_anchors_the_active_branch_span_to_lane_zero() {
        let history = vec![
            branch_tip(commit("feature", &["base"]), "feature", false),
            branch_tip(commit("main", &["base"]), "main", true),
            commit("base", &[]),
        ];
        let mut main_checked_out = history.clone();
        let mut feature_checked_out = history;
        feature_checked_out[0].decorations[0].is_head = true;
        feature_checked_out[1].decorations[0].is_head = false;

        layout_with_wip(
            &mut main_checked_out,
            &mut LaneState { heads: Vec::new() },
            "main",
        );
        layout_with_wip(
            &mut feature_checked_out,
            &mut LaneState { heads: Vec::new() },
            "feature",
        );

        assert_eq!(main_checked_out[0].graph.lane, 1);
        assert_eq!(main_checked_out[1].graph.lane, 0);
        assert_eq!(main_checked_out[2].graph.lane, 0);
        assert_eq!(main_checked_out[0].graph.edges[0].to_lane, 0);
        assert_eq!(main_checked_out[1].graph.edges[0].to_lane, 0);

        assert_eq!(feature_checked_out[0].graph.lane, 0);
        assert_eq!(feature_checked_out[1].graph.lane, 1);
        assert_eq!(feature_checked_out[2].graph.lane, 0);
        assert_eq!(feature_checked_out[0].graph.edges[0].to_lane, 0);
        assert_eq!(feature_checked_out[1].graph.edges[0].to_lane, 0);
    }

    #[test]
    fn a_hidden_detached_wip_head_reserves_lane_zero_on_the_first_page() {
        // LaneState carries future lane heads, but not the parent-lane map used
        // to paint rows already returned on an earlier page. This regression
        // therefore covers the hidden WIP anchor only; cross-page convergence
        // needs a richer cursor contract before it can be asserted faithfully.
        let mut first_page = vec![commit("visible-tip", &["visible-parent"])];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_with_wip(&mut first_page, &mut lanes, "detached-head");

        assert_eq!(first_page[0].graph.lane, 1);
        assert_eq!(lanes.heads[0].as_deref(), Some("detached-head"));
        assert_eq!(lanes.heads[1].as_deref(), Some("visible-parent"));
    }

    #[test]
    fn a_clean_single_stash_uses_lane_zero() {
        let mut commits = vec![
            stash_commit("stash", &["base"]),
            commit("tip", &["mid"]),
            commit("mid", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[2].graph.edges[0].to_lane, 0);
        assert_eq!(commits[3].graph.lane, 0);
    }

    #[test]
    fn a_clean_stash_anchors_its_parent_branch_and_shared_base_to_lane_zero() {
        let mut commits = vec![
            stash_commit("main-stash", &["main"]),
            branch_tip(commit("feature", &["base"]), "feature", false),
            branch_tip(commit("main", &["base"]), "main", true),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[2].graph.lane, 0);
        assert_eq!(commits[3].graph.lane, 0);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[1].graph.edges[0].to_lane, 0);
        assert_eq!(commits[2].graph.edges[0].to_lane, 0);
    }

    #[test]
    fn additional_stashes_stack_to_the_right_of_the_base_lane() {
        let mut commits = vec![
            stash_commit("stash-newer", &["base"]),
            stash_commit("stash-older", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[1].graph.edges[0].to_lane, 0);
        assert_eq!(commits[2].graph.lane, 0);
    }

    #[test]
    fn wip_reserves_lane_zero_and_moves_a_foreign_stash_to_lane_one() {
        let mut commits = vec![
            stash_commit("main-stash", &["main"]),
            branch_tip(commit("feature", &["base"]), "feature", true),
            branch_tip(commit("main", &["base"]), "main", false),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_with_wip(&mut commits, &mut lanes, "feature");

        assert_eq!(commits[0].graph.lane, 1);
        assert_eq!(commits[0].graph.edges[0].to_lane, 1);
        assert_eq!(commits[1].graph.lane, 0);
        assert_eq!(commits[2].graph.lane, 1);
        assert_eq!(commits[3].graph.lane, 0);
    }

    #[test]
    fn wip_moves_consecutive_stashes_one_lane_to_the_right() {
        let mut commits = vec![
            stash_commit("stash-a", &["feature"]),
            stash_commit("stash-b", &["feature"]),
            branch_tip(commit("feature", &["base"]), "feature", true),
            branch_tip(commit("main", &["base"]), "main", false),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_with_wip(&mut commits, &mut lanes, "feature");

        assert_eq!(commits[0].graph.lane, 1);
        assert_eq!(commits[1].graph.lane, 2);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[1].graph.edges[0].to_lane, 0);
        assert_eq!(commits[2].graph.lane, 0);
        assert_eq!(commits[3].graph.lane, 1);
        assert_eq!(commits[4].graph.lane, 0);
    }

    #[test]
    fn clean_stash_lanes_match_across_page_boundaries() {
        let history = vec![
            stash_commit("stash-a", &["base"]),
            stash_commit("stash-c", &["base"]),
            stash_commit("stash-b", &["base"]),
            commit("base", &[]),
        ];
        let mut one_batch = history.clone();
        let mut one_batch_lanes = LaneState { heads: Vec::new() };
        layout_clean(&mut one_batch, &mut one_batch_lanes);

        let mut paged_lanes = LaneState { heads: Vec::new() };
        let mut pages = history
            .into_iter()
            .map(|commit| vec![commit])
            .collect::<Vec<_>>();
        for page in &mut pages {
            layout_clean(page, &mut paged_lanes);
        }

        let paged_graphs = pages
            .iter()
            .flatten()
            .map(|commit| commit.graph.clone())
            .collect::<Vec<_>>();
        let one_batch_graphs = one_batch
            .iter()
            .map(|commit| commit.graph.clone())
            .collect::<Vec<_>>();

        assert_eq!(paged_graphs, one_batch_graphs);
        assert_eq!(paged_lanes, one_batch_lanes);
        assert_eq!(one_batch[0].graph.lane, 0);
        assert_eq!(one_batch[1].graph.lane, 1);
        assert_eq!(one_batch[2].graph.lane, 2);
    }

    #[test]
    fn a_stash_skips_two_materialized_branch_lanes() {
        let mut commits = vec![
            branch_tip(
                commit("feature-tip", &["feature-base", "main-tip"]),
                "feature",
                true,
            ),
            branch_tip(commit("main-tip", &["main-base"]), "main", false),
            stash_commit("stash", &["feature-base"]),
            commit("main-base", &["base"]),
            commit("feature-base", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[2].graph.lane, 2);
        assert_eq!(commits[2].graph.edges[0].to_lane, 0);
    }

    #[test]
    fn a_finished_stash_lane_is_reused_before_later_stashes() {
        let mut commits = vec![
            branch_tip(
                commit("feature-tip", &["feature-base", "main-tip"]),
                "feature",
                true,
            ),
            branch_tip(commit("main-tip", &["main-base"]), "main", false),
            stash_commit("current-stash", &["feature-base"]),
            commit("feature-base", &["shared-base"]),
            stash_commit("older-stash-1", &["shared-base"]),
            stash_commit("older-stash-2", &["shared-base"]),
            stash_commit("older-stash-3", &["shared-base"]),
            branch_tip(commit("sim-ahead", &["shared-base"]), "sim-ahead", false),
            commit("main-base", &["shared-base"]),
            commit("shared-base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[2].graph.lane, 2);
        assert_eq!(commits[4].graph.lane, 2);
        assert_eq!(commits[5].graph.lane, 3);
        assert_eq!(commits[6].graph.lane, 4);
        assert_eq!(commits[7].graph.lane, 5);
    }

    #[test]
    fn linear_history_stays_in_one_lane() {
        let mut commits = vec![commit("a", &["b"]), commit("b", &["c"]), commit("c", &[])];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert!(commits.iter().all(|commit| commit.graph.lane == 0));
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[1].graph.edges[0].to_lane, 0);
        assert_eq!(lanes.heads, vec![None]);
    }

    #[test]
    fn merge_parents_get_distinct_edges_and_converge() {
        let mut commits = vec![
            commit("merge", &["left", "right"]),
            commit("left", &["base"]),
            commit("right", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[0].graph.edges.len(), 2);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert!(!commits[0].graph.edges[0].merge);
        assert_eq!(commits[0].graph.edges[1].to_lane, 1);
        assert!(commits[0].graph.edges[1].merge);
        assert_eq!(commits[2].graph.lane, 1);
        assert_eq!(commits[2].graph.edges[0].to_lane, 0);
        assert_eq!(lanes.heads, vec![None, None]);
    }

    #[test]
    fn new_merge_parent_opens_beside_its_merge_not_past_unrelated_lanes() {
        let mut commits = vec![commit("merge", &["first", "second"])];
        let mut lanes = LaneState {
            heads: vec![Some("merge".into()), None, Some("carried".into())],
        };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[0].graph.edges[1].to_lane, 1);
    }

    #[test]
    fn repeated_merges_of_one_trunk_step_it_right_lane_by_lane() {
        let mut commits = vec![
            commit("side-1", &["side-2"]),
            commit("filler-a", &["filler-a1"]),
            commit("filler-b", &["filler-b1"]),
            commit("trunk-a", &["trunk-b"]),
            commit("side-2", &["side-3", "trunk-c"]),
            commit("side-3", &["side-4", "trunk-d"]),
            commit("trunk-b", &["trunk-c"]),
            commit("side-4", &["side-5", "trunk-e"]),
            commit("trunk-c", &["trunk-d"]),
            commit("trunk-d", &["trunk-e"]),
            commit("trunk-e", &[]),
            commit("side-5", &[]),
            commit("filler-a1", &[]),
            commit("filler-b1", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[3].graph.lane, 3, "trunk-a");
        assert_eq!(commits[6].graph.lane, 3, "trunk-b");
        assert_eq!(commits[8].graph.lane, 4, "trunk-c");
        assert_eq!(commits[9].graph.lane, 5, "trunk-d");
        assert_eq!(commits[10].graph.lane, 6, "trunk-e");
        assert_eq!(commits[7].graph.edges[1].to_lane, 6, "side-4 merge edge");
    }

    #[test]
    fn a_stash_shares_the_first_unrendered_rung_of_a_merge_ladder() {
        let ladder = || {
            vec![
                commit("side-1", &["side-2"]),
                commit("filler-a", &["filler-a1"]),
                commit("filler-b", &["filler-b1"]),
                commit("trunk-a", &["trunk-b"]),
                commit("side-2", &["side-3", "trunk-c"]),
                commit("side-3", &["side-4", "trunk-d"]),
                commit("trunk-b", &["trunk-c"]),
                commit("side-4", &["side-5", "trunk-e"]),
                commit("trunk-c", &["trunk-d"]),
                commit("trunk-d", &["trunk-e"]),
                commit("trunk-e", &[]),
                commit("side-5", &[]),
                commit("filler-a1", &[]),
                commit("filler-b1", &[]),
            ]
        };
        const STASH_ROW: usize = 8;

        let mut without_stash = ladder();
        layout_clean(&mut without_stash, &mut LaneState { heads: Vec::new() });

        let mut with_stash = ladder();
        with_stash.insert(STASH_ROW, stash_commit("stash", &["trunk-e"]));
        layout_clean(&mut with_stash, &mut LaneState { heads: Vec::new() });

        for (row, commit) in without_stash.iter().enumerate() {
            let shifted = row + usize::from(row >= STASH_ROW);
            assert_eq!(
                with_stash[shifted].graph.lane, commit.graph.lane,
                "{} moved when a stash was inserted",
                commit.oid
            );
        }

        let stash_lane = with_stash[STASH_ROW].graph.lane;
        assert_eq!(stash_lane, 4, "stash");
        assert_eq!(with_stash[STASH_ROW + 1].graph.lane, stash_lane, "trunk-c");
        assert_eq!(with_stash[7].graph.lane, 0, "side-4");
        assert_eq!(with_stash[6].graph.lane, 3, "trunk-b");
    }

    #[test]
    #[ignore = "known open limitation: the merge-line reservation map is page-local, see docs/graph-layout-agent-handoff.md"]
    fn paged_layout_matches_one_batch_across_a_merge_ladder() {
        let commits = vec![
            commit("side-1", &["side-2"]),
            commit("filler-a", &["filler-a1"]),
            commit("filler-b", &["filler-b1"]),
            commit("trunk-a", &["trunk-b"]),
            commit("side-2", &["side-3", "trunk-c"]),
            commit("side-3", &["side-4", "trunk-d"]),
            commit("trunk-b", &["trunk-c"]),
            commit("side-4", &["side-5", "trunk-e"]),
            commit("trunk-c", &["trunk-d"]),
            commit("trunk-d", &["trunk-e"]),
            commit("trunk-e", &[]),
            commit("side-5", &[]),
            commit("filler-a1", &[]),
            commit("filler-b1", &[]),
        ];

        let mut one_batch = commits.clone();
        let mut one_batch_lanes = LaneState { heads: Vec::new() };
        layout_clean(&mut one_batch, &mut one_batch_lanes);

        for split in 1..commits.len() {
            let mut first_page = commits[..split].to_vec();
            let mut second_page = commits[split..].to_vec();
            let mut paged_lanes = LaneState { heads: Vec::new() };
            layout_clean(&mut first_page, &mut paged_lanes);
            layout_clean(&mut second_page, &mut paged_lanes);

            let paged_graphs: Vec<_> = first_page
                .iter()
                .chain(&second_page)
                .map(|commit| commit.graph.clone())
                .collect();
            let one_batch_graphs: Vec<_> = one_batch
                .iter()
                .map(|commit| commit.graph.clone())
                .collect();

            assert_eq!(paged_graphs, one_batch_graphs, "split at {split}");
        }
    }

    #[test]
    fn merge_convergence_reserves_an_open_lane_to_the_left() {
        let mut commits = vec![
            commit("merge", &["left", "right"]),
            commit("left", &["base"]),
            commit("right", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState {
            heads: vec![None, Some("merge".into())],
        };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 1);
        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[2].graph.lane, 2);
        assert_eq!(commits[3].graph.lane, 0);
        assert_eq!(commits[1].graph.edges[0].to_lane, 0);
        assert_eq!(commits[2].graph.edges[0].to_lane, 0);
    }

    #[test]
    fn page_carry_matches_single_batch_layout() {
        let commits = vec![
            commit("merge", &["left", "right"]),
            commit("left", &["base"]),
            commit("right", &["base"]),
            commit("base", &[]),
        ];

        let mut one_batch = commits.clone();
        let mut one_batch_lanes = LaneState { heads: Vec::new() };
        layout_clean(&mut one_batch, &mut one_batch_lanes);

        let mut first_page = commits[..2].to_vec();
        let mut second_page = commits[2..].to_vec();
        let mut paged_lanes = LaneState { heads: Vec::new() };
        layout_clean(&mut first_page, &mut paged_lanes);
        assert_eq!(
            paged_lanes.heads,
            vec![Some("base".into()), Some("right".into())]
        );
        layout_clean(&mut second_page, &mut paged_lanes);

        let paged_graphs: Vec<_> = first_page
            .iter()
            .chain(&second_page)
            .map(|commit| commit.graph.clone())
            .collect();
        let one_batch_graphs: Vec<_> = one_batch
            .iter()
            .map(|commit| commit.graph.clone())
            .collect();

        assert_eq!(paged_graphs, one_batch_graphs);
        assert_eq!(paged_lanes, one_batch_lanes);
    }

    // Mirrors the `convergence-lane-reuse` GitKraken conformance fixture: four
    // sibling branches (cluster-b1..b4) converge back onto the same merge
    // commit simultaneously, and an extra merge parent (feature-tip) opens
    // its lane right after. `layout_commits` clears every `LaneState.heads`
    // entry that points at a newly-reached commit in one pass, so several
    // lanes can free at once on the convergence row. This was the row order
    // pagination would most plausibly disturb, since it is the one page
    // boundary where the "rightmost active lane" that `allocate_after_rightmost`
    // reads depends on several unrelated lanes having just closed together.
    #[test]
    fn paged_layout_matches_one_batch_across_a_simultaneous_multi_lane_convergence() {
        let commits = vec![
            commit("final-merge", &["trunk-continues", "long-runner-tip"]),
            commit("trunk-continues", &["s-merge"]),
            commit("cluster-b4", &["s-merge"]),
            commit("cluster-b3", &["s-merge"]),
            commit("cluster-b2", &["s-merge"]),
            commit("cluster-b1", &["s-merge"]),
            commit("s-merge", &["t-older", "feature-tip"]),
            commit("feature-tip", &["t-older"]),
            commit("t-older", &["long-base"]),
            commit("long-runner-tip", &["long-base"]),
            commit("long-base", &["root"]),
            commit("root", &[]),
        ];

        let mut one_batch = commits.clone();
        let mut one_batch_lanes = LaneState { heads: Vec::new() };
        layout_clean(&mut one_batch, &mut one_batch_lanes);

        assert_eq!(
            one_batch
                .iter()
                .map(|commit| commit.graph.lane)
                .collect::<Vec<_>>(),
            vec![0, 0, 2, 3, 4, 5, 0, 2, 0, 1, 0, 0],
            "sanity check: one-batch lanes should match the GitKraken oracle"
        );

        for split in 1..commits.len() {
            let mut first_page = commits[..split].to_vec();
            let mut second_page = commits[split..].to_vec();
            let mut paged_lanes = LaneState { heads: Vec::new() };
            layout_clean(&mut first_page, &mut paged_lanes);
            layout_clean(&mut second_page, &mut paged_lanes);

            let paged_graphs: Vec<_> = first_page
                .iter()
                .chain(&second_page)
                .map(|commit| commit.graph.clone())
                .collect();
            let one_batch_graphs: Vec<_> = one_batch
                .iter()
                .map(|commit| commit.graph.clone())
                .collect();

            assert_eq!(
                paged_graphs, one_batch_graphs,
                "page split at row {split} diverged from the one-batch layout"
            );
            assert_eq!(
                paged_lanes, one_batch_lanes,
                "page split at row {split} left a different final LaneState"
            );
        }
    }

    #[test]
    fn independent_tip_opens_after_the_rightmost_active_lane() {
        let mut lanes = LaneState {
            heads: vec![Some("expected".into()), Some("other".into())],
        };
        let mut commits = vec![commit("new-tip", &[])];

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 2);
        assert_eq!(
            lanes.heads,
            vec![Some("expected".into()), Some("other".into()), None]
        );
    }

    #[test]
    fn independent_tip_reuses_a_lane_emptied_by_a_convergence() {
        let mut commits = vec![
            commit("trunk", &["trunk-base"]),
            commit("side", &["trunk-base"]),
            commit("right", &["right-base"]),
            commit("trunk-base", &["root"]),
            commit("new-tip", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[3].graph.lane, 0);
        assert_eq!(commits[4].graph.lane, 1);
    }

    #[test]
    fn disconnected_root_component_reuses_a_never_materialized_interior_lane() {
        let mut heads = (0..12)
            .map(|lane| (lane != 7).then(|| format!("active-{lane}")))
            .collect::<Vec<_>>();
        let materialized_lanes = (0..12).filter(|lane| *lane != 7).collect::<HashSet<_>>();
        let lane = lane_for_commit(
            &mut heads,
            &commit("orphan-tip", &["orphan-root"]),
            &materialized_lanes,
            &HashSet::new(),
            &HashMap::new(),
        );

        assert_eq!(lane, 7);
        assert_eq!(heads[7].as_deref(), Some("orphan-tip"));
    }

    #[test]
    fn disconnected_component_does_not_reuse_a_finished_materialized_lane() {
        fn history(head: &str) -> Vec<CommitSummary> {
            vec![
                branch_tip(commit("main-tip", &["main-root"]), "main", head == "main"),
                branch_tip(commit("side-tip", &["side-root"]), "side", head == "side"),
                branch_tip(
                    commit("right-tip", &["right-root"]),
                    "right",
                    head == "right",
                ),
                commit("side-root", &[]),
                branch_tip(
                    commit("target-tip", &["target-root"]),
                    "target",
                    head == "target",
                ),
                commit("main-root", &[]),
                commit("right-root", &[]),
                commit("target-root", &[]),
            ]
        }

        for head in ["main", "target"] {
            let mut commits = history(head);
            let mut lanes = LaneState { heads: Vec::new() };

            layout_clean(&mut commits, &mut lanes);

            assert_eq!(
                commits
                    .iter()
                    .map(|commit| commit.graph.lane)
                    .collect::<Vec<_>>(),
                vec![0, 1, 2, 1, 3, 0, 2, 3],
                "checkout of {head} changed disconnected component lanes"
            );
            assert_eq!(
                commits
                    .iter()
                    .flat_map(|commit| &commit.graph.edges)
                    .map(|edge| (edge.from_lane, edge.to_lane))
                    .collect::<Vec<_>>(),
                vec![(0, 0), (1, 1), (2, 2), (3, 3)],
                "checkout of {head} changed disconnected component edges"
            );
        }
    }

    #[test]
    fn disconnected_checkout_only_changes_the_head_decoration() {
        fn history(head: &str) -> Vec<CommitSummary> {
            vec![
                branch_tip(commit("main-tip", &["main-root"]), "main", head == "main"),
                branch_tip(commit("side-tip", &["side-root"]), "side", head == "side"),
                commit("main-root", &[]),
                branch_tip(
                    commit("target-tip", &["target-root"]),
                    "target",
                    head == "target",
                ),
                commit("target-root", &[]),
                commit("side-root", &[]),
            ]
        }

        for head in ["main", "target"] {
            let mut commits = history(head);
            let mut lanes = LaneState { heads: Vec::new() };

            layout_clean(&mut commits, &mut lanes);

            assert_eq!(
                commits
                    .iter()
                    .map(|commit| commit.graph.lane)
                    .collect::<Vec<_>>(),
                vec![0, 1, 0, 2, 2, 1],
                "checkout of {head} changed disconnected component lanes"
            );
            assert_eq!(
                commits
                    .iter()
                    .flat_map(|commit| &commit.graph.edges)
                    .map(|edge| (edge.from_lane, edge.to_lane))
                    .collect::<Vec<_>>(),
                vec![(0, 0), (1, 1), (2, 2)],
                "checkout of {head} changed disconnected component edges"
            );
        }
    }

    #[test]
    fn independent_tip_does_not_reuse_a_rightmost_bending_lane() {
        let mut lanes = LaneState {
            heads: vec![Some("base".into()), Some("base".into())],
        };
        let mut commits = vec![
            commit("tip", &["middle"]),
            commit("middle", &["base"]),
            commit("base", &[]),
        ];

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 2);
        assert_eq!(commits[1].graph.lane, 2);
        assert_eq!(commits[1].graph.edges[0].to_lane, 0);
    }

    #[test]
    fn a_descendant_tip_shares_the_lane_of_its_first_parent() {
        let mut commits = vec![
            commit("tip", &["head"]),
            commit("head", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert!(commits.iter().all(|commit| commit.graph.lane == 0));
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
    }

    #[test]
    fn row_order_decides_lane_order() {
        let history = vec![
            commit("first-tip", &["first-1"]),
            commit("first-1", &["base"]),
            commit("second-tip", &["second-1"]),
            commit("second-1", &["base"]),
            commit("base", &[]),
        ];

        let mut commits = history.clone();
        let mut lanes = LaneState { heads: Vec::new() };
        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[2].graph.lane, 1);

        let mut swapped = vec![
            history[2].clone(),
            history[3].clone(),
            history[0].clone(),
            history[1].clone(),
            history[4].clone(),
        ];
        let mut swapped_lanes = LaneState { heads: Vec::new() };
        layout_clean(&mut swapped, &mut swapped_lanes);

        assert_eq!(swapped[0].graph.lane, 0);
        assert_eq!(swapped[2].graph.lane, 1);
    }

    #[test]
    fn a_two_parent_tip_and_its_second_parent_keep_the_leftmost_lanes() {
        let mut commits = vec![
            commit("stash", &["base", "index"]),
            commit("index", &["base"]),
            commit("tip", &["main-1"]),
            commit("main-1", &["base"]),
            commit("other-tip", &["other-1"]),
            commit("other-1", &["older"]),
            commit("base", &["older"]),
            commit("older", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[2].graph.lane, 2);
        assert_eq!(commits[3].graph.lane, 2);
        assert_eq!(commits[3].graph.edges[0].to_lane, 0);
        assert_eq!(commits[6].graph.lane, 0);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[1].graph.edges[0].to_lane, 0);
    }

    // A branch merged by its own upstream keeps a first parent far below the
    // merge row. Nothing about that shape may depend on which tip is checked
    // out, or the two branches collapse onto one lane when one of them is.
    #[test]
    fn a_merged_branch_keeps_its_own_lane() {
        let mut commits = vec![
            commit("origin-tip", &["origin-1"]),
            commit("origin-1", &["merge"]),
            commit("merge", &["update-tip", "main-tip"]),
            commit("main-tip", &["main-1"]),
            commit("main-1", &["base"]),
            commit("update-tip", &["update-1"]),
            commit("update-1", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        let lane_of = |oid: &str| {
            commits
                .iter()
                .find(|commit| commit.oid == oid)
                .expect("commit is laid out")
                .graph
                .lane
        };
        assert_eq!(lane_of("origin-tip"), 0);
        assert_eq!(lane_of("update-tip"), 0);
        assert_ne!(lane_of("main-tip"), lane_of("origin-tip"));
    }

    #[test]
    fn a_stash_ancestry_keeps_the_shared_base_on_lane_zero() {
        let mut commits = vec![
            stash_commit("stash", &["head-tip"]),
            commit("main-tip", &["base"]),
            commit("head-tip", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, STASH_LANE_FLOOR);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[2].graph.lane, 0);
        assert_eq!(commits[3].graph.lane, 0);
        assert_eq!(commits[1].graph.edges[0].to_lane, 0);
        assert_eq!(commits[2].graph.edges[0].to_lane, 0);
    }

    #[test]
    fn a_stash_above_the_head_tip_bends_into_the_head_lane() {
        let mut commits = vec![
            stash_commit("stash", &["main-tip"]),
            commit("main-tip", &["main-1"]),
            commit("main-1", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, STASH_LANE_FLOOR);
        assert_eq!(commits[0].graph.edges[0].from_lane, STASH_LANE_FLOOR);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[1].graph.lane, 0);
        assert_eq!(commits[2].graph.lane, 0);
    }

    #[test]
    fn unrelated_tip_skips_a_lane_that_still_carries_a_bend() {
        let mut commits = vec![
            commit("stash", &["base"]),
            commit("tip", &["main-1"]),
            commit("main-1", &["base"]),
            commit("other-tip", &["other-1"]),
            commit("other-1", &["older"]),
            commit("base", &["older"]),
            commit("older", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_clean(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[3].graph.lane, 2);
        assert_eq!(commits[4].graph.lane, 2);
    }
}
