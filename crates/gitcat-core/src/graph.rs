use std::collections::HashMap;

use gitcat_contracts::{CommitSummary, GraphCell, GraphEdge, LaneState};

/// Adds deterministic graph lane information to topologically ordered commits.
///
/// Each lane head is the next commit expected in that lane. Keeping `lanes`
/// between calls makes layout identical whether history is processed in one
/// batch or several pages. Lanes follow row order alone, so checking out a
/// different branch never moves a line sideways.
pub fn layout_commits(commits: &mut [CommitSummary], lanes: &mut LaneState) {
    let mut commit_lanes = Vec::with_capacity(commits.len());
    let mut parent_lanes: HashMap<String, usize> = HashMap::new();

    for commit in commits.iter() {
        let lane = lane_for_commit(&mut lanes.heads, &commit.oid);

        // A malformed or externally supplied cursor may contain the same head
        // more than once. Consume every copy so no phantom lane survives.
        for head in &mut lanes.heads {
            if head.as_deref() == Some(commit.oid.as_str()) {
                *head = None;
            }
        }

        commit_lanes.push(lane);

        for (parent_index, parent_oid) in commit.parent_oids.iter().enumerate() {
            let claimed_lane = lanes
                .heads
                .iter()
                .position(|head| head.as_deref() == Some(parent_oid.as_str()));

            let parent_lane = match claimed_lane {
                Some(claimed_lane) => {
                    let takes_over =
                        parent_index == 0 && claimed_lane > lane && lanes.heads[lane].is_none();
                    if takes_over {
                        lanes.heads[lane] = Some(parent_oid.clone());
                        lane
                    } else {
                        claimed_lane
                    }
                }
                None => {
                    let preferred_lane =
                        (parent_index == 0 && lanes.heads[lane].is_none()).then_some(lane);
                    allocate_lane(&mut lanes.heads, parent_oid, preferred_lane)
                }
            };

            parent_lanes.insert(parent_oid.clone(), parent_lane);
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

fn lane_for_commit(heads: &mut Vec<Option<String>>, oid: &str) -> usize {
    heads
        .iter()
        .position(|head| head.as_deref() == Some(oid))
        .unwrap_or_else(|| allocate_lane(heads, oid, None))
}

fn allocate_lane(
    heads: &mut Vec<Option<String>>,
    oid: &str,
    preferred_lane: Option<usize>,
) -> usize {
    let lane = preferred_lane
        .filter(|lane| heads.get(*lane).is_some_and(Option::is_none))
        .or_else(|| heads.iter().position(Option::is_none))
        .unwrap_or_else(|| {
            heads.push(None);
            heads.len() - 1
        });

    heads[lane] = Some(oid.to_owned());
    lane
}

#[cfg(test)]
mod tests {
    use gitcat_contracts::{CommitTime, GraphCell, Identity, StashRef};

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

    #[test]
    fn a_stash_row_keeps_the_leftmost_lane() {
        let mut commits = vec![
            stash_commit("wip", &["base"]),
            commit("tip", &["mid"]),
            commit("mid", &["base"]),
            commit("base", &[]),
        ];
        let mut lanes = LaneState { heads: Vec::new() };

        layout_commits(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 0);
        assert_eq!(commits[0].graph.edges[0].to_lane, 0);
        assert_eq!(commits[1].graph.lane, 1);
        assert_eq!(commits[2].graph.lane, 1);
        assert_eq!(commits[2].graph.edges[0].to_lane, 0);
        assert_eq!(commits[3].graph.lane, 0);
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
    fn independent_tip_reuses_lowest_empty_lane() {
        let mut lanes = LaneState {
            heads: vec![Some("expected".into()), None, Some("other".into())],
        };
        let mut commits = vec![commit("new-tip", &[])];

        layout_commits(&mut commits, &mut lanes);

        assert_eq!(commits[0].graph.lane, 1);
        assert_eq!(
            lanes.heads,
            vec![Some("expected".into()), None, Some("other".into())]
        );
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
