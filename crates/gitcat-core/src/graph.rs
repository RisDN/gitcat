use gitcat_contracts::{CommitSummary, GraphCell, GraphEdge, LaneState};

/// Adds deterministic graph lane information to topologically ordered commits.
///
/// Each lane head is the next commit expected in that lane. Keeping `lanes`
/// between calls makes layout identical whether history is processed in one
/// batch or several pages.
pub fn layout_commits(commits: &mut [CommitSummary], lanes: &mut LaneState) {
    for commit in commits {
        let lane = lane_for_commit(&mut lanes.heads, &commit.oid);

        // A malformed or externally supplied cursor may contain the same head
        // more than once. Consume every copy so no phantom lane survives.
        for head in &mut lanes.heads {
            if head.as_deref() == Some(commit.oid.as_str()) {
                *head = None;
            }
        }

        let mut edges = Vec::with_capacity(commit.parent_oids.len());
        for (parent_index, parent_oid) in commit.parent_oids.iter().enumerate() {
            let parent_lane = lanes
                .heads
                .iter()
                .position(|head| head.as_deref() == Some(parent_oid.as_str()))
                .unwrap_or_else(|| {
                    let preferred_lane =
                        (parent_index == 0 && lanes.heads[lane].is_none()).then_some(lane);
                    allocate_lane(&mut lanes.heads, parent_oid, preferred_lane)
                });

            edges.push(GraphEdge {
                parent_oid: parent_oid.clone(),
                from_lane: lane,
                to_lane: parent_lane,
                merge: parent_index > 0,
            });
        }

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
    use gitcat_contracts::{CommitTime, GraphCell, Identity};

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
            graph: GraphCell::default(),
        }
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
}
