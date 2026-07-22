/**
 * JSON contracts emitted by `gitcat-contracts` through serde.
 *
 * Field names intentionally stay snake_case. These are payload fields, not
 * Tauri command argument names; changing them to camelCase would break the
 * transport contract.
 */

export type RepositoryId = string;
export type JobId = string;

export interface GitVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export type ObjectFormat = "sha1" | "sha256" | "unknown";

export interface RepositoryInfo {
  root: string;
  git_dir: string;
  common_dir: string;
  name: string;
  is_bare: boolean;
  object_format: ObjectFormat;
}

export interface OpenedRepository {
  repository_id: RepositoryId;
  info: RepositoryInfo;
}

export type HeadState =
  | { kind: "branch"; name: string; oid: string }
  | { kind: "detached"; oid: string }
  | { kind: "unborn"; intended_branch: string };

export type RepositoryOperationState =
  | "normal"
  | "merge"
  | "rebase"
  | "cherry_pick"
  | "revert"
  | "bisect";

export interface RepositoryCapabilities {
  shallow: boolean;
  partial_clone: boolean;
  sparse_checkout: boolean;
  worktree: boolean;
}

export type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type_changed"
  | "unmerged"
  | "untracked"
  | "ignored";

export interface StatusEntry {
  path: string;
  old_path?: string;
  index?: ChangeKind;
  worktree?: ChangeKind;
  conflicted: boolean;
  submodule: boolean;
}

export interface WorktreeStatus {
  clean: boolean;
  ahead: number;
  behind: number;
  stash_count: number;
  entries: StatusEntry[];
}

export type RefKind = "local_branch" | "remote_branch" | "tag";

export interface RefLabel {
  name: string;
  full_name: string;
  kind: RefKind;
  is_head: boolean;
}

export interface BranchInfo {
  name: string;
  full_name: string;
  oid: string;
  kind: RefKind;
  is_head: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export interface RemoteInfo {
  name: string;
  fetch_url: string;
  push_url: string;
}

export interface RepositorySnapshot {
  generation: string;
  head: HeadState;
  operation_state: RepositoryOperationState;
  status: WorktreeStatus;
  local_branches: BranchInfo[];
  remote_branches: BranchInfo[];
  tags: RefLabel[];
  remotes: RemoteInfo[];
  capabilities: RepositoryCapabilities;
}

export interface Identity {
  name: string;
  email: string;
}

export interface CommitTime {
  seconds: number;
  offset_minutes: number;
}

export interface GraphEdge {
  parent_oid: string;
  from_lane: number;
  to_lane: number;
  merge: boolean;
}

export interface GraphCell {
  lane: number;
  edges: GraphEdge[];
}

export interface CommitSummary {
  oid: string;
  short_oid: string;
  parent_oids: string[];
  subject: string;
  body_preview: string;
  author: Identity;
  authored_at: CommitTime;
  committed_at: CommitTime;
  decorations: RefLabel[];
  graph: GraphCell;
}

export interface LaneState {
  heads: Array<string | null>;
}

export interface HistoryCursor {
  generation: string;
  offset: number;
  lanes: LaneState;
}

export type HistoryScope =
  | { kind: "current_branch" }
  | { kind: "all_refs" }
  | { kind: "ref"; value: string };

export interface HistoryQuery {
  scope: HistoryScope;
  cursor: HistoryCursor | null;
  limit: number;
}

export interface HistoryPage {
  generation: string;
  commits: CommitSummary[];
  next_cursor: HistoryCursor | null;
  has_more: boolean;
}

export interface CommitSearchQuery {
  query: string;
  scope: HistoryScope;
  limit: number;
}

export interface CommitSearchHit {
  oid: string;
  subject: string;
  body_excerpt: string | null;
  matched_subject: boolean;
  matched_body: boolean;
}

export interface CommitSearchResult {
  total: number;
  truncated: boolean;
  hits: CommitSearchHit[];
}

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

export interface ChangedFile {
  old_path: string | null;
  new_path: string;
  status: ChangeKind;
  additions: number | null;
  deletions: number | null;
  similarity: number | null;
  binary: boolean;
}

export interface CommitDetails {
  oid: string;
  short_oid: string;
  tree_oid: string;
  parent_oids: string[];
  author: Identity;
  committer: Identity;
  authored_at: CommitTime;
  committed_at: CommitTime;
  subject: string;
  body: string;
  stats: DiffStats;
  files: ChangedFile[];
}

export type DiffTarget =
  | { kind: "worktree" }
  | { kind: "staged" }
  | { kind: "head_to_worktree" }
  | { kind: "commit"; oid: string; parent_index: number }
  | { kind: "between"; base_oid: string; head_oid: string };

export interface DiffRequest {
  target: DiffTarget;
  path: string;
  context_lines: number;
  ignore_whitespace: boolean;
  max_bytes: number;
}

export type DiffLineKind = "context" | "addition" | "deletion" | "no_newline";

export interface DiffLine {
  kind: DiffLineKind;
  old_line: number | null;
  new_line: number | null;
  content: string;
}

export interface DiffHunk {
  header: string;
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  lines: DiffLine[];
}

export interface FileDiff {
  old_path: string | null;
  new_path: string;
  old_mode: string | null;
  new_mode: string | null;
  status: ChangeKind;
  binary: boolean;
  stats: DiffStats;
  hunks: DiffHunk[];
  truncated: boolean;
}

export interface ExpectedState {
  head_oid: string | null;
  generation: string;
}

export type PullMode = "merge" | "fast_forward_only" | "rebase";
export type ResetMode = "soft" | "mixed" | "hard";
export type ContinueOperation = "merge" | "rebase" | "cherry_pick" | "revert";

export interface MutationResult {
  before_oid: string | null;
  after_oid: string | null;
  generation: string;
  conflicts: StatusEntry[];
  needs_user_action: boolean;
}

export interface CloneOptions {
  url: string;
  destination: string;
  branch: string | null;
  depth: number | null;
  filter_blob_none: boolean;
}

export interface CommitOptions {
  message: string;
  amend: boolean;
  signoff: boolean;
}

export interface PullOptions {
  remote: string | null;
  branch: string | null;
  mode: PullMode;
  prune: boolean;
  autostash: boolean;
}

export interface PushOptions {
  remote: string | null;
  branch: string | null;
  set_upstream: boolean;
}

export interface FetchOptions {
  remote: string | null;
  prune: boolean;
  tags: boolean;
}

export interface StashEntry {
  index: number;
  oid: string;
  message: string;
}

export type CommitActionKind =
  | "checkout"
  | "create_branch"
  | "cherry_pick"
  | "revert"
  | "reset"
  | "create_tag"
  | "copy_sha";

export interface CommitActionAvailability {
  kind: CommitActionKind;
  enabled: boolean;
  disabled_reason: string | null;
  requires_confirmation: boolean;
}

export type CoreEvent =
  | { kind: "repository_changed"; repository_id: RepositoryId; generation: string }
  | { kind: "operation_progress"; job_id: JobId; phase: string; message: string }
  | { kind: "operation_completed"; job_id: JobId; repository_id: RepositoryId }
  | { kind: "operation_failed"; job_id: JobId; message: string };

export type ErrorCode =
  | "git_not_found"
  | "unsupported_git_version"
  | "invalid_repository"
  | "repository_closed"
  | "invalid_path"
  | "invalid_request"
  | "invalid_ref_name"
  | "invalid_revision"
  | "stale_snapshot"
  | "repository_busy"
  | "dirty_worktree"
  | "conflicts_present"
  | "operation_in_progress"
  | "upstream_missing"
  | "authentication_required"
  | "network_failed"
  | "non_fast_forward"
  | "protected_operation"
  | "unsupported_operation"
  | "cancelled"
  | "timeout"
  | "output_too_large"
  | "git_command_failed"
  | "io"
  | "invalid_settings"
  | "internal";

export interface RecoveryAction {
  kind: string;
  label: string;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: string;
  recovery_actions?: RecoveryAction[];
}

export interface ThemeColors {
  background: string;
  surface: string;
  panel: string;
  border: string;
  text: string;
  muted_text: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  diff_addition: string;
  diff_deletion: string;
  graph_palette: string[];
}

export interface AppSettings {
  default_pull_mode: PullMode;
  auto_fetch_interval_minutes: number;
  auto_prune: boolean;
  history_page_size: number;
  diff_context_lines: number;
  diff_max_bytes: number;
  theme: ThemeColors;
}

export interface RepositoryTab {
  id: string;
  repository_path: string;
  display_name: string;
  order: number;
}

export interface RepositoryGroup {
  id: string;
  name: string;
  collapsed: boolean;
  order: number;
  tabs: RepositoryTab[];
}

export interface WorkspaceState {
  version: number;
  groups: RepositoryGroup[];
  active_tab_id: string | null;
}

export interface PersistedState {
  settings: AppSettings;
  workspace: WorkspaceState;
}

export interface RepositoryOverview {
  snapshot: RepositorySnapshot;
  history: HistoryPage;
  stashes: StashEntry[];
}

export interface CommitPanelData {
  details: CommitDetails;
  actions: CommitActionAvailability[];
}
