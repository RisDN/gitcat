use std::collections::{HashMap, HashSet};

use gitcat_contracts::{CommitSummary, GraphCell, GraphEdge, LaneState, RefKind};

const STASH_LANE_FLOOR: usize = 1;

/// Adds deterministic graph lane information to topologically ordered commits.
///
/// Each lane head is the next commit expected in that lane. Keeping `lanes`
/// between calls makes layout identical whether history is processed in one
/// batch or several pages. On the first page the checked-out branch owns the
/// primary lane and the conventional default branch owns the secondary lane.
pub fn layout_commits(commits: &mut [CommitSummary], lanes: &mut LaneState) {
    let priority_components = build_priority_components(commits);
    let classify_disconnected_tips = lanes.heads.is_empty() && !priority_components.is_empty();
    let mut materialized_lanes = lanes
        .heads
        .iter()
        .enumerate()
        .filter_map(|(lane, head)| head.is_some().then_some(lane))
        .collect::<HashSet<_>>();
    seed_priority_lanes(commits, &mut lanes.heads);

    let merge_convergences = build_merge_convergences(commits);
    let mut commit_lanes = Vec::with_capacity(commits.len());
    let mut parent_lanes: HashMap<String, usize> = HashMap::new();

    for commit in commits.iter() {
        let disconnected_tip =
            classify_disconnected_tips && !priority_components.contains(commit.oid.as_str());
        let lane = lane_for_commit(
            &mut lanes.heads,
            commit,
            disconnected_tip,
            &materialized_lanes,
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
            let claimed_lane = lanes
                .heads
                .iter()
                .position(|head| head.as_deref() == Some(parent_oid.as_str()));

            let parent_lane = match claimed_lane {
                Some(claimed_lane) => claimed_lane,
                None => {
                    let inherits_lane = parent_index == 0 && commit.stash.is_none();
                    if parent_index > 0 {
                        allocate_after_rightmost(&mut lanes.heads, parent_oid, 0)
                    } else {
                        let preferred_lane =
                            (inherits_lane && lanes.heads[lane].is_none()).then_some(lane);
                        allocate_lane(&mut lanes.heads, parent_oid, preferred_lane, 0)
                    }
                }
            };

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

fn build_priority_components(commits: &[CommitSummary]) -> HashSet<String> {
    let mut adjacent: HashMap<&str, Vec<&str>> = HashMap::new();
    for commit in commits {
        adjacent.entry(commit.oid.as_str()).or_default();
        for parent_oid in &commit.parent_oids {
            adjacent
                .entry(commit.oid.as_str())
                .or_default()
                .push(parent_oid.as_str());
            adjacent
                .entry(parent_oid.as_str())
                .or_default()
                .push(commit.oid.as_str());
        }
    }

    let mut pending = commits
        .iter()
        .filter(|commit| {
            commit.decorations.iter().any(|decoration| {
                decoration.is_head
                    || (decoration.kind == RefKind::LocalBranch
                        && matches!(decoration.name.as_str(), "main" | "master"))
            })
        })
        .map(|commit| commit.oid.as_str())
        .collect::<Vec<_>>();
    let mut connected = HashSet::new();

    while let Some(oid) = pending.pop() {
        if !connected.insert(oid.to_owned()) {
            continue;
        }
        if let Some(neighbors) = adjacent.get(oid) {
            pending.extend(neighbors.iter().copied());
        }
    }

    connected
}

fn seed_priority_lanes(commits: &[CommitSummary], heads: &mut Vec<Option<String>>) {
    if !heads.is_empty() {
        return;
    }

    let checked_out = commits.iter().find(|commit| {
        commit
            .decorations
            .iter()
            .any(|decoration| decoration.is_head)
    });
    let default_branch = commits.iter().find(|commit| {
        commit.decorations.iter().any(|decoration| {
            decoration.kind == RefKind::LocalBranch
                && matches!(decoration.name.as_str(), "main" | "master")
        })
    });

    for commit in [checked_out, default_branch].into_iter().flatten() {
        if !heads
            .iter()
            .any(|head| head.as_deref() == Some(commit.oid.as_str()))
        {
            heads.push(Some(commit.oid.clone()));
        }
    }
}

fn lane_for_commit(
    heads: &mut Vec<Option<String>>,
    commit: &CommitSummary,
    disconnected_tip: bool,
    materialized_lanes: &HashSet<usize>,
) -> usize {
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

    if disconnected_tip {
        return allocate_lane(heads, &commit.oid, None, 0);
    }

    allocate_after_rightmost(heads, &commit.oid, 0)
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

    #[test]
    fn checkout_moves_the_active_branch_and_wip_to_the_primary_lane() {
        let history = vec![
            stash_commit("stash", &["sim-wip"]),
            branch_tip(commit("sim-wip", &["wip-base", "main"]), "sim-wip", true),
            branch_tip(commit("main", &["base"]), "main", false),
            commit("wip-base", &["base"]),
            commit("base", &[]),
        ];
        let mut sim_wip_checked_out = history.clone();
        let mut main_checked_out = history;
        main_checked_out[1].decorations[0].is_head = false;
        main_checked_out[2].decorations[0].is_head = true;

        layout_commits(
            &mut sim_wip_checked_out,
            &mut LaneState { heads: Vec::new() },
        );
        layout_commits(&mut main_checked_out, &mut LaneState { heads: Vec::new() });

        assert_eq!(sim_wip_checked_out[0].graph.lane, 1);
        assert_eq!(sim_wip_checked_out[1].graph.lane, 0);
        assert_eq!(sim_wip_checked_out[2].graph.lane, 1);

        assert_eq!(main_checked_out[0].graph.lane, 1);
        assert_eq!(main_checked_out[1].graph.lane, 1);
        assert_eq!(main_checked_out[2].graph.lane, 0);
    }

    #[test]
    fn a_stash_uses_the_secondary_lane() {
        let mut commits = vec![
            stash_commit("wip", &["base"]),
            commit("tip", &["mid"]),
            commit("mid", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_commits(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, STASH_LANE_FLOOR);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[2].graph.edges[0].to_lane, 0);
        assert_eq!(commits[3].graph.lane, 0);
    }

    #[test]
    fn additional_stashes_stack_to_the_right_of_the_base_lane() {
        let mut commits = vec![
            stash_commit("wip-newer", &["base"]),
            stash_commit("wip-older", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_commits(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 1);
        assert_eq!(commits[1].graph.lane, 2);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[1].graph.edges[0].to_lane, 0);
        assert_eq!(commits[2].graph.lane, 0);
    }

    #[test]
    fn a_stash_skips_a_visible_secondary_branch_lane() {
        let mut commits = vec![
            branch_tip(
                commit("sim-wip-tip", &["sim-wip-base", "main-tip"]),
                "sim-wip",
                true,
            ),
            branch_tip(commit("main-tip", &["main-base"]), "main", false),
            stash_commit("wip", &["sim-wip-base"]),
            commit("main-base", &["base"]),
            commit("sim-wip-base", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_commits(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[2].graph.lane, 2);
        assert_eq!(commits[2].graph.edges[0].to_lane, 0);
    }

    #[test]
    fn a_finished_stash_lane_is_reused_before_later_stashes() {
        let mut commits = vec![
            branch_tip(
                commit("sim-wip-tip", &["wip-base", "main-tip"]),
                "sim-wip",
                true,
            ),
            branch_tip(commit("main-tip", &["main-base"]), "main", false),
            stash_commit("current-wip", &["wip-base"]),
            commit("wip-base", &["shared-base"]),
            stash_commit("older-stash-1", &["shared-base"]),
            stash_commit("older-stash-2", &["shared-base"]),
            stash_commit("older-stash-3", &["shared-base"]),
            branch_tip(commit("sim-ahead", &["shared-base"]), "sim-ahead", false),
            commit("main-base", &["shared-base"]),
            commit("shared-base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_commits(&mut commits, &mut lanes);

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

        layout_commits(&mut commits, &mut lanes);

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

        layout_commits(&mut commits, &mut lanes);

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
    fn new_merge_parent_opens_after_the_rightmost_active_lane() {
        let mut commits = vec![commit("merge", &["first", "second"])];
        let mut lanes = LaneState {
            heads: vec![Some("merge".into()), None, Some("carried".into())],
        };

        layout_commits(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[0].graph.edges[1].to_lane, 3);
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

        layout_commits(&mut commits, &mut lanes);

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
        layout_commits(&mut one_batch, &mut one_batch_lanes);

        let mut first_page = commits[..2].to_vec();
        let mut second_page = commits[2..].to_vec();
        let mut paged_lanes = LaneState { heads: Vec::new() };
        layout_commits(&mut first_page, &mut paged_lanes);
        assert_eq!(
            paged_lanes.heads,
            vec![Some("base".into()), Some("right".into())]
        );
        layout_commits(&mut second_page, &mut paged_lanes);

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

    #[test]
    fn independent_tip_opens_after_the_rightmost_active_lane() {
        let mut lanes = LaneState {
            heads: vec![Some("expected".into()), None, Some("other".into())],
        };
        let mut commits = vec![commit("new-tip", &[])];

        layout_commits(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 3);
        assert_eq!(
            lanes.heads,
            vec![Some("expected".into()), None, Some("other".into()), None,]
        );
    }

    #[test]
    fn disconnected_root_component_reuses_the_lowest_open_lane() {
        let mut heads = (0..12)
            .map(|lane| (lane != 7).then(|| format!("active-{lane}")))
            .collect::<Vec<_>>();
        let lane = lane_for_commit(
            &mut heads,
            &commit("orphan-tip", &["orphan-root"]),
            true,
            &HashSet::new(),
        );

        assert_eq!(lane, 7);
        assert_eq!(heads[7].as_deref(), Some("orphan-tip"));
    }

    #[test]
    fn independent_tip_does_not_reuse_a_rightmost_bending_lane() {
        let mut lanes = LaneState {
            heads: vec![Some("base".into()), None, Some("base".into())],
        };
        let mut commits = vec![
            commit("tip", &["middle"]),
            commit("middle", &["base"]),
            commit("base", &[]),
        ];

        layout_commits(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 3);
        assert_eq!(commits[1].graph.lane, 3);
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

        layout_commits(&mut commits, &mut lanes);

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
        layout_commits(&mut commits, &mut lanes);

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
        layout_commits(&mut swapped, &mut swapped_lanes);

        assert_eq!(swapped[0].graph.lane, 0);
        assert_eq!(swapped[2].graph.lane, 1);
    }

    #[test]
    fn a_stash_and_its_index_keep_the_leftmost_lanes() {
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

        layout_commits(&mut commits, &mut lanes);

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

        layout_commits(&mut commits, &mut lanes);

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
    fn a_stash_taken_from_head_leaves_the_head_lane_alone() {
        let mut commits = vec![
            stash_commit("wip", &["head-tip"]),
            commit("main-tip", &["base"]),
            commit("head-tip", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_commits(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, STASH_LANE_FLOOR);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[2].graph.lane, 0);
        assert_eq!(commits[3].graph.lane, commits[1].graph.lane);
        assert_eq!(commits[2].graph.edges[0].to_lane, commits[3].graph.lane);
    }

    #[test]
    fn a_stash_above_the_head_tip_bends_into_the_head_lane() {
        let mut commits = vec![
            stash_commit("wip", &["main-tip"]),
            commit("main-tip", &["main-1"]),
            commit("main-1", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_commits(&mut commits, &mut lanes);

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

        layout_commits(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[3].graph.lane, 2);
        assert_eq!(commits[4].graph.lane, 2);
    }
}
