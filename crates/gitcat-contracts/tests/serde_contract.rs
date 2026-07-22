use gitcat_contracts::{
    AppSettings, DiffTarget, ErrorCode, HistoryScope, PullMode, RepositoryId, WorktreeStatus,
};

#[test]
fn pull_mode_is_stable_snake_case() {
    assert_eq!(
        serde_json::to_string(&PullMode::Rebase).unwrap(),
        r#""rebase""#
    );
    assert_eq!(
        serde_json::to_string(&PullMode::FastForwardOnly).unwrap(),
        r#""fast_forward_only""#
    );
}

#[test]
fn tagged_contracts_have_explicit_kinds() {
    let target = DiffTarget::Commit {
        oid: "abc123".into(),
        parent_index: 0,
    };
    let json = serde_json::to_value(target).unwrap();
    assert_eq!(json["kind"], "commit");
    assert_eq!(json["parent_index"], 0);

    let scope = serde_json::to_value(HistoryScope::Ref("main".into())).unwrap();
    assert_eq!(scope["kind"], "ref");
    assert_eq!(scope["value"], "main");
}

#[test]
fn ids_are_json_safe_and_unique() {
    let first = RepositoryId::new();
    let second = RepositoryId::new();
    assert_ne!(first, second);
    let encoded = serde_json::to_string(&first).unwrap();
    let decoded: RepositoryId = serde_json::from_str(&encoded).unwrap();
    assert_eq!(first, decoded);
}

#[test]
fn defaults_include_theme_and_bounded_queries() {
    let settings = AppSettings::default();
    assert_eq!(settings.history_page_size, 200);
    assert_eq!(settings.diff_context_lines, 3);
    assert!(settings.theme.graph_palette.len() >= 4);
    assert!(settings.theme.accent.starts_with('#'));
}

#[test]
fn error_codes_remain_transport_values() {
    assert_eq!(
        serde_json::to_string(&ErrorCode::StaleSnapshot).unwrap(),
        r#""stale_snapshot""#
    );
}

#[test]
fn default_worktree_status_is_clean() {
    let status = WorktreeStatus::default();
    assert!(status.clean);
    assert!(status.entries.is_empty());
}
