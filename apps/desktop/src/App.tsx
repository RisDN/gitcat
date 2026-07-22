import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  FolderInput,
  FolderPlus,
  FolderX,
  GitBranchPlus,
  GitCommitHorizontal,
  GitPullRequestArrow,
  LoaderCircle,
  RotateCcw,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CommitDetails } from "./components/CommitDetails";
import { ConflictResolverDialog } from "./components/ConflictResolverDialog";
import {
  CommitGraph,
  getCommitGraphWidth,
  type CommitContextMenuRequest,
} from "./components/CommitGraph";
import { ContextMenu, type ContextAction } from "./components/ContextMenu";
import { DiffViewer, type DiffViewMode } from "./components/DiffViewer";
import { Button, IconButton, Spinner } from "./components/Primitives";
import { PromptDialog } from "./components/PromptDialog";
import { RefSidebar } from "./components/RefSidebar";
import { ResetDialog } from "./components/ResetDialog";
import { SearchBar } from "./components/SearchBar";
import { SettingsDialog } from "./components/SettingsDialog";
import { ToastRegion, type ToastMessage } from "./components/ToastRegion";
import { Toolbar, type ConflictIndicator } from "./components/Toolbar";
import {
  TopTabs,
  type RepositoryTabContextMenuRequest,
  type TabGroupView,
  type TabView,
} from "./components/TopTabs";
import { WelcomeView } from "./components/WelcomeView";
import { WorktreePanel, type CommitDraft } from "./components/WorktreePanel";
import { getApiError, gitcatApi } from "./lib/api";
import { conflictOperationLabel } from "./lib/conflicts";
import {
  DEFAULT_KEYBINDS,
  duplicateKeybinds,
  isEditableTarget,
  isPlainTypingKeybind,
  keybindValidationError,
  matchesKeybind,
} from "./lib/keybinds";
import type {
  AppMetadata,
  AppSettings,
  BranchInfo,
  ChangeKind,
  ChangedFile,
  CommitActionAvailability,
  CommitSummary,
  ConflictFileDetails,
  ConflictPreflightResult,
  ConflictResolution,
  ContinueOperation,
  DiffRequest,
  ExpectedState,
  FileDiff,
  HistoryPage,
  KeybindSettings,
  MutationResult,
  OpenedRepository,
  PersistedState,
  PullMode,
  RepositoryInfo,
  RepositorySnapshot,
  RepositoryTab,
  ResetMode,
  StatusEntry,
  StashEntry,
} from "./lib/types";

const DEFAULT_SETTINGS: AppSettings = {
  default_pull_mode: "merge",
  auto_fetch_interval_minutes: 0,
  auto_prune: true,
  history_page_size: 200,
  diff_context_lines: 3,
  diff_max_bytes: 8 * 1024 * 1024,
  keybinds: DEFAULT_KEYBINDS,
  theme: {
    background: "#17191f",
    surface: "#1d2027",
    panel: "#242832",
    border: "#343946",
    text: "#f2f4f8",
    muted_text: "#9aa3b2",
    accent: "#20b8d8",
    success: "#4dbd74",
    warning: "#f0ad4e",
    danger: "#e05d6f",
    diff_addition: "#244d33",
    diff_deletion: "#562e32",
    graph_palette: ["#17b8d4", "#7c4dff", "#c42df0", "#ff9f43", "#4dbd74", "#ef5b8c"],
  },
};

const EMPTY_STATE: PersistedState = {
  settings: DEFAULT_SETTINGS,
  workspace: { version: 2, ungrouped_tabs: [], groups: [], active_tab_id: null },
};

const EMPTY_COMMIT_DRAFT: CommitDraft = { message: "", amend: false, signoff: false };

interface RuntimeRepository {
  repository_id: string;
  info: RepositoryInfo;
}

type PromptState =
  | { kind: "create_group"; tabId?: string }
  | { kind: "rename_group"; groupId: string; current: string }
  | { kind: "alias_tab"; tabId: string; current: string }
  | { kind: "create_branch"; startOid: string }
  | { kind: "remote_branch"; branch: BranchInfo }
  | { kind: "rename_branch"; branch: BranchInfo }
  | { kind: "create_tag"; oid: string }
  | null;

interface CommitMenuState {
  x: number;
  y: number;
  commit: CommitSummary;
}

interface TabMenuState {
  x: number;
  y: number;
  tab: TabView;
  groupId: string | null;
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isMutationResult(value: unknown): value is MutationResult {
  if (typeof value !== "object" || value === null) return false;
  return Array.isArray((value as Partial<MutationResult>).conflicts)
    && typeof (value as Partial<MutationResult>).needs_user_action === "boolean";
}

function workspaceTabs(state: PersistedState["workspace"]): RepositoryTab[] {
  return [
    ...(state.ungrouped_tabs ?? []),
    ...state.groups.flatMap((group) => group.tabs),
  ];
}

function normalizePersistedKeybinds(
  keybinds: Partial<KeybindSettings> | undefined,
): KeybindSettings {
  const actions = Object.keys(DEFAULT_KEYBINDS) as (keyof KeybindSettings)[];
  const normalized = { ...DEFAULT_KEYBINDS };
  for (const action of actions) {
    const candidate = keybinds?.[action];
    normalized[action] = typeof candidate === "string" && !keybindValidationError(candidate)
      ? candidate
      : DEFAULT_KEYBINDS[action];
  }
  for (let pass = 0; pass < actions.length; pass += 1) {
    const duplicates = duplicateKeybinds(normalized);
    if (!duplicates.size) break;
    for (const action of duplicates) normalized[action] = DEFAULT_KEYBINDS[action];
  }
  return normalized;
}

function normalizePersistedState(state: PersistedState): PersistedState {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...state.settings,
      keybinds: normalizePersistedKeybinds(state.settings?.keybinds),
      theme: { ...DEFAULT_SETTINGS.theme, ...state.settings?.theme },
    },
    workspace: {
      version: 2,
      active_tab_id: state.workspace?.active_tab_id ?? null,
      groups: state.workspace?.groups ?? [],
      ungrouped_tabs: state.workspace?.ungrouped_tabs ?? [],
    },
  };
}

function expectedState(snapshot: RepositorySnapshot): ExpectedState {
  return {
    generation: snapshot.generation,
    head_oid: snapshot.head.kind === "unborn" ? null : snapshot.head.oid,
  };
}

function currentBranch(snapshot: RepositorySnapshot | null): string {
  if (!snapshot) return "—";
  if (snapshot.head.kind === "branch") return snapshot.head.name;
  if (snapshot.head.kind === "detached") return `detached @ ${snapshot.head.oid.slice(0, 7)}`;
  return snapshot.head.intended_branch;
}

function defaultConflictPreflightTarget(snapshot: RepositorySnapshot | null): string | null {
  return snapshot?.default_conflict_target ?? null;
}

function continuableOperation(
  operation: RepositorySnapshot["operation_state"],
): ContinueOperation | null {
  switch (operation) {
    case "merge":
    case "rebase":
    case "cherry_pick":
    case "revert":
      return operation;
    case "normal":
    case "bisect":
      return null;
  }
}

type WorktreeStageAction = "stage" | "unstage";

function stagedKindFromWorktree(kind: ChangeKind): ChangeKind {
  return kind === "untracked" || kind === "ignored" ? "added" : kind;
}

function worktreeKindFromIndex(kind: ChangeKind): ChangeKind {
  if (kind === "added" || kind === "copied") return "untracked";
  if (kind === "renamed") return "modified";
  return kind;
}

function matchesStatusPath(entry: StatusEntry, paths: Set<string>): boolean {
  return paths.has(entry.path) || (entry.old_path ? paths.has(entry.old_path) : false);
}

function compactStatusEntries(entries: StatusEntry[]): StatusEntry[] {
  return entries.filter((entry) => entry.conflicted || entry.index || entry.worktree);
}

function optimisticWorktreeSnapshot(
  current: RepositorySnapshot,
  action: WorktreeStageAction,
  paths: string[],
): RepositorySnapshot {
  const selected = new Set(paths);
  if (!selected.size) return current;

  const entries = compactStatusEntries(current.status.entries.map((entry) => {
    if (entry.conflicted || !matchesStatusPath(entry, selected)) return entry;

    if (action === "stage") {
      if (!entry.worktree) return entry;
      return {
        ...entry,
        index: stagedKindFromWorktree(entry.worktree),
        worktree: undefined,
      };
    }

    if (!entry.index) return entry;
    return {
      ...entry,
      index: undefined,
      old_path: entry.index === "renamed" ? undefined : entry.old_path,
      worktree: entry.worktree ?? worktreeKindFromIndex(entry.index),
    };
  }));

  return {
    ...current,
    status: {
      ...current.status,
      clean: entries.length === 0,
      entries,
    },
  };
}

function optimisticWorktreeSelection(
  current: { path: string; staged: boolean } | null,
  action: WorktreeStageAction,
  paths: string[],
): { path: string; staged: boolean } | null {
  if (!current || !paths.includes(current.path)) return current;
  return { ...current, staged: action === "stage" };
}

function applyTheme(settings: AppSettings): void {
  const root = document.documentElement;
  const theme = settings.theme;
  const variables: Record<string, string> = {
    "--gc-background": theme.background,
    "--gc-surface": theme.surface,
    "--gc-panel": theme.panel,
    "--gc-border": theme.border,
    "--gc-text": theme.text,
    "--gc-muted": theme.muted_text,
    "--gc-accent": theme.accent,
    "--gc-success": theme.success,
    "--gc-warning": theme.warning,
    "--gc-danger": theme.danger,
    "--gc-diff-add": theme.diff_addition,
    "--gc-diff-delete": theme.diff_deletion,
  };
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  for (let index = 0; index < 8; index += 1) {
    root.style.setProperty(`--gc-lane-${index}`, theme.graph_palette[index % theme.graph_palette.length]);
  }
}

function App() {
  const [persisted, setPersisted] = useState<PersistedState>(EMPTY_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [runtime, setRuntime] = useState<Record<string, RuntimeRepository>>({});
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null);
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const selectedOidRef = useRef<string | null>(null);
  const [wipSelected, setWipSelected] = useState(false);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof gitcatApi.commitDetails>> | null>(null);
  const [commitActions, setCommitActions] = useState<CommitActionAvailability[]>([]);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffMode, setDiffMode] = useState<DiffViewMode>("inline");
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [selectedWorktreeFile, setSelectedWorktreeFile] = useState<{ path: string; staged: boolean } | null>(null);
  const [centerView, setCenterView] = useState<"graph" | "diff">("graph");
  const [busy, setBusy] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOids, setSearchOids] = useState<string[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchBusy, setSearchBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [resetCommit, setResetCommit] = useState<CommitSummary | null>(null);
  const [commitMenu, setCommitMenu] = useState<CommitMenuState | null>(null);
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(252);
  const [detailsWidth, setDetailsWidth] = useState(370);
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [appMetadata, setAppMetadata] = useState<AppMetadata>({ version: "unknown", commit: "unknown" });
  const [conflictPreflight, setConflictPreflight] = useState<ConflictPreflightResult | null>(null);
  const [conflictPreflightLoading, setConflictPreflightLoading] = useState(false);
  const [conflictEditor, setConflictEditor] = useState<ConflictFileDetails | null>(null);
  const [commitDrafts, setCommitDrafts] = useState<Record<string, CommitDraft>>({});
  const [overviewRepositoryId, setOverviewRepositoryId] = useState<string | null>(null);
  const activeRepositoryIdRef = useRef<string | null>(null);
  const autoRefreshRef = useRef<() => void>(() => {});
  const closedTabsRef = useRef<RepositoryTab[]>([]);
  const workspaceRef = useRef(persisted.workspace);
  const overviewLoadSequence = useRef(0);
  const detailsLoadSequence = useRef(0);
  const diffLoadSequence = useRef(0);
  const historyLoadSequence = useRef(0);
  const searchSequence = useRef(0);
  const conflictPreflightSequence = useRef(0);

  const activeTabId = persisted.workspace.active_tab_id;
  const activeRepository = activeTabId ? runtime[activeTabId] : undefined;
  const activeTab = activeTabId
    ? workspaceTabs(persisted.workspace).find((tab) => tab.id === activeTabId)
    : undefined;

  useEffect(() => {
    activeRepositoryIdRef.current = activeRepository?.repository_id ?? null;
  }, [activeRepository]);

  useEffect(() => {
    setPrompt(null);
    setResetCommit(null);
    setCommitMenu(null);
    setTabMenu(null);
    setConflictEditor(null);
  }, [activeTabId]);

  useEffect(() => {
    const preventNativeContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", preventNativeContextMenu, true);
    return () => document.removeEventListener("contextmenu", preventNativeContextMenu, true);
  }, []);

  useEffect(() => {
    void gitcatApi.appMetadata()
      .then(setAppMetadata)
      .catch(() => undefined);
  }, []);

  const addToast = useCallback((toast: Omit<ToastMessage, "id">) => {
    const id = makeId("toast");
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);

  const showError = useCallback((title: string, error: unknown) => {
    const apiError = getApiError(error);
    addToast({ tone: "error", title, detail: apiError.details ?? apiError.message });
  }, [addToast]);

  const openStoredRepositories = useCallback(async (state: PersistedState) => {
    const tabs = workspaceTabs(state.workspace);
    if (!tabs.length) return;
    const opened = await Promise.allSettled(tabs.map(async (tab) => [tab.id, await gitcatApi.openRepository(tab.repository_path)] as const));
    const next: Record<string, RuntimeRepository> = {};
    for (const result of opened) {
      if (result.status === "fulfilled") {
        const [tabId, repository] = result.value;
        next[tabId] = repository;
      }
    }
    setRuntime(next);
    const preferred = state.workspace.active_tab_id;
    if (!preferred || !next[preferred]) {
      const fallback = Object.keys(next)[0] ?? null;
      setPersisted((current) => ({ ...current, workspace: { ...current.workspace, active_tab_id: fallback } }));
    }
    const failed = opened.filter((result) => result.status === "rejected").length;
    if (failed) addToast({ tone: "error", title: `${failed} repository tab could not be restored`, detail: "The folder may have moved or no longer be a Git repository." });
  }, [addToast]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const state = normalizePersistedState(await gitcatApi.loadPersistedState());
        if (!alive) return;
        setPersisted(state);
        applyTheme(state.settings);
        await openStoredRepositories(state);
      } catch (error) {
        if (alive) showError("Could not load preferences", error);
      } finally {
        if (alive) {
          setHydrated(true);
          setInitializing(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [openStoredRepositories, showError]);

  useEffect(() => {
    applyTheme(persisted.settings);
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      void gitcatApi.savePersistedState(persisted).catch((error) => showError("Could not save workspace", error));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, persisted, showError]);

  useEffect(() => { selectedOidRef.current = selectedOid; }, [selectedOid]);
  useEffect(() => { workspaceRef.current = persisted.workspace; }, [persisted.workspace]);

  const loadOverview = useCallback(async (repository: RuntimeRepository, preserveSelection = true) => {
    const sequence = ++overviewLoadSequence.current;
    if (activeRepositoryIdRef.current === repository.repository_id) {
      ++historyLoadSequence.current;
      setHistoryLoading(false);
      setOverviewLoading(true);
    }
    try {
      const overview = await gitcatApi.loadRepositoryOverview(repository.repository_id, {
        scope: { kind: "all_refs" },
        cursor: null,
        limit: persisted.settings.history_page_size,
      });
      if (
        sequence !== overviewLoadSequence.current
        || activeRepositoryIdRef.current !== repository.repository_id
      ) return;
      startTransition(() => {
        setOverviewRepositoryId(repository.repository_id);
        setSnapshot(overview.snapshot);
        setHistory(overview.history);
        setStashes(overview.stashes);
        const previous = preserveSelection ? selectedOidRef.current : null;
        if (previous && overview.history.commits.some((commit) => commit.oid === previous)) {
          setSelectedOid(previous);
          setWipSelected(false);
        } else if (!overview.snapshot.status.clean) {
          setSelectedOid(null);
          setWipSelected(true);
        } else {
          setSelectedOid(overview.history.commits[0]?.oid ?? null);
          setWipSelected(false);
        }
      });
    } finally {
      if (
        sequence === overviewLoadSequence.current
        && activeRepositoryIdRef.current === repository.repository_id
      ) setOverviewLoading(false);
    }
  }, [persisted.settings.history_page_size]);

  useEffect(() => {
    ++overviewLoadSequence.current;
    ++detailsLoadSequence.current;
    ++diffLoadSequence.current;
    ++historyLoadSequence.current;
    setHistoryLoading(false);
    setOverviewLoading(false);
    setOverviewRepositoryId(null);
    setSnapshot(null);
    setHistory(null);
    setDetails(null);
    setDiff(null);
    setConflictEditor(null);
    setSelectedPath(undefined);
    setSelectedWorktreeFile(null);
    setDiffLoading(false);
    setCenterView("graph");
    if (!activeRepository) return;
    void loadOverview(activeRepository, false)
      .catch((error) => showError("Repository could not be loaded", error));
  }, [activeRepository, loadOverview, showError]);

  useEffect(() => {
    if (
      !activeRepository
      || overviewRepositoryId !== activeRepository.repository_id
      || !selectedOid
      || wipSelected
    ) {
      ++detailsLoadSequence.current;
      setDetails(null);
      setCommitActions([]);
      return;
    }
    const repositoryId = activeRepository.repository_id;
    const sequence = ++detailsLoadSequence.current;
    setDetails(null);
    setCommitActions([]);
    void gitcatApi.loadCommitPanel(activeRepository.repository_id, selectedOid)
      .then((panel) => {
        if (
          sequence !== detailsLoadSequence.current
          || activeRepositoryIdRef.current !== repositoryId
        ) return;
        setDetails(panel.details);
        setCommitActions(panel.actions);
      })
      .catch((error) => {
        if (
          sequence === detailsLoadSequence.current
          && activeRepositoryIdRef.current === repositoryId
        ) showError("Commit details could not be loaded", error);
      });
  }, [activeRepository, overviewRepositoryId, selectedOid, showError, wipSelected]);

  useEffect(() => {
    const sequence = ++searchSequence.current;
    if (!searchOpen || !activeRepository || !searchQuery.trim()) {
      setSearchOids([]);
      setSearchIndex(0);
      setSearchBusy(false);
      return;
    }
    const repositoryId = activeRepository.repository_id;
    setSearchBusy(true);
    const timer = window.setTimeout(() => {
      void gitcatApi.searchCommits(activeRepository.repository_id, {
        query: searchQuery,
        scope: { kind: "all_refs" },
        limit: 1000,
      }).then((result) => {
        if (
          sequence !== searchSequence.current
          || activeRepositoryIdRef.current !== repositoryId
        ) return;
        setSearchOids(result.hits.map((hit) => hit.oid));
        setSearchIndex(0);
        if (result.hits[0]) {
          ++diffLoadSequence.current;
          setSelectedOid(result.hits[0].oid);
          setWipSelected(false);
          setSelectedPath(undefined);
          setSelectedWorktreeFile(null);
          setDiff(null);
          setDiffLoading(false);
          setCenterView("graph");
        }
      }).catch((error) => {
        if (
          sequence === searchSequence.current
          && activeRepositoryIdRef.current === repositoryId
        ) showError("Commit search failed", error);
      })
        .finally(() => { if (sequence === searchSequence.current) setSearchBusy(false); });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeRepository, searchOpen, searchQuery, showError]);

  const applyOptimisticWorktreeMutation = useCallback((action: WorktreeStageAction, paths: string[]) => {
    if (!activeRepository || !snapshot || !paths.length) return undefined;
    const repositoryId = activeRepository.repository_id;
    const previousSnapshot = snapshot;
    const previousSelectedWorktreeFile = selectedWorktreeFile;

    setSnapshot((current) => {
      if (!current || activeRepositoryIdRef.current !== repositoryId) return current;
      return optimisticWorktreeSnapshot(current, action, paths);
    });
    setSelectedWorktreeFile((current) => {
      if (activeRepositoryIdRef.current !== repositoryId) return current;
      return optimisticWorktreeSelection(current, action, paths);
    });

    return () => {
      if (activeRepositoryIdRef.current !== repositoryId) return;
      setSnapshot(previousSnapshot);
      setSelectedWorktreeFile(previousSelectedWorktreeFile);
    };
  }, [activeRepository, selectedWorktreeFile, snapshot]);

  const runMutation = useCallback(async (
    title: string,
    operation: (repository: RuntimeRepository) => Promise<unknown>,
    options?: { silent?: boolean; optimistic?: () => (() => void) | undefined },
  ): Promise<boolean> => {
    if (!activeRepository || busy || overviewLoading) return false;
    let rollbackOptimistic: (() => void) | undefined;
    let operationCompleted = false;
    setBusy(true);
    try {
      rollbackOptimistic = options?.optimistic?.();
      const result = await operation(activeRepository);
      operationCompleted = true;
      if (activeRepositoryIdRef.current === activeRepository.repository_id) {
        await loadOverview(activeRepository, true)
          .catch((error) => showError("Refresh failed", error));
      }
      if (isMutationResult(result) && result.conflicts.length) {
        addToast({
          tone: "info",
          title: `${title}: attention required`,
          detail: `${result.conflicts.length} conflict${result.conflicts.length === 1 ? " remains" : "s remain"}. Resolve them in the Working tree panel.`,
        });
      } else if (!options?.silent) {
        addToast({ tone: "success", title });
      }
      return true;
    } catch (error) {
      if (!operationCompleted) rollbackOptimistic?.();
      showError(`${title} failed`, error);
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeRepository, addToast, busy, loadOverview, overviewLoading, showError]);

  const stagePaths = useCallback((paths: string[]) => {
    void runMutation(
      "Files staged",
      (repository) => gitcatApi.stagePaths(repository.repository_id, paths),
      {
        silent: true,
        optimistic: () => applyOptimisticWorktreeMutation("stage", paths),
      },
    );
  }, [applyOptimisticWorktreeMutation, runMutation]);

  const unstagePaths = useCallback((paths: string[]) => {
    void runMutation(
      "Files unstaged",
      (repository) => gitcatApi.unstagePaths(repository.repository_id, paths),
      {
        silent: true,
        optimistic: () => applyOptimisticWorktreeMutation("unstage", paths),
      },
    );
  }, [applyOptimisticWorktreeMutation, runMutation]);

  const createPatchFile = useCallback(async (paths: string[], staged: boolean) => {
    if (!activeRepository) return;
    const repositoryId = activeRepository.repository_id;
    try {
      let destination = `${paths[0]?.split(/[\\/]/).at(-1) ?? "changes"}.patch`;
      if (gitcatApi.runtime === "tauri") {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const chosen = await save({
          title: "Save patch",
          defaultPath: destination,
          filters: [{ name: "Patch", extensions: ["patch", "diff"] }],
        });
        if (!chosen) return;
        destination = chosen;
      }
      await gitcatApi.savePatch(repositoryId, paths, staged, destination);
      addToast({ tone: "success", title: "Patch created", detail: destination });
    } catch (error) {
      showError("Create patch failed", error);
    }
  }, [activeRepository, addToast, showError]);

  const chooseRepository = useCallback(async () => {
    if (busy) return;
    try {
      let path = "C:\\Users\\demo\\aurora-engine";
      if (gitcatApi.runtime === "tauri") {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false, title: "Open Git repository" });
        if (!selected || Array.isArray(selected)) return;
        path = selected;
      }
      const existing = workspaceTabs(persisted.workspace).find((tab) => tab.repository_path === path);
      if (existing) {
        setPersisted((current) => ({ ...current, workspace: { ...current.workspace, active_tab_id: existing.id } }));
        return;
      }
      setBusy(true);
      const opened: OpenedRepository = await gitcatApi.openRepository(path);
      const tab: RepositoryTab = {
        id: makeId("tab"),
        repository_path: opened.info.root,
        display_name: opened.info.name,
        order: 0,
      };
      setRuntime((current) => ({ ...current, [tab.id]: opened }));
      setPersisted((current) => {
        const ungrouped_tabs = [
          ...current.workspace.ungrouped_tabs,
          { ...tab, order: current.workspace.ungrouped_tabs.length },
        ];
        return { ...current, workspace: { ...current.workspace, ungrouped_tabs, active_tab_id: tab.id } };
      });
    } catch (error) {
      showError("Repository could not be opened", error);
    } finally {
      setBusy(false);
    }
  }, [busy, persisted.workspace, showError]);

  const closeTab = useCallback((tabId: string) => {
    if (busy) return;
    const closedTab = workspaceTabs(workspaceRef.current).find((tab) => tab.id === tabId);
    if (closedTab) {
      closedTabsRef.current = [
        ...closedTabsRef.current.filter((tab) => tab.repository_path !== closedTab.repository_path),
        closedTab,
      ].slice(-20);
    }
    const repository = runtime[tabId];
    if (repository) void gitcatApi.closeRepository(repository.repository_id).catch(() => undefined);
    setRuntime((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setCommitDrafts((current) => {
      if (!(tabId in current)) return current;
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setPersisted((current) => {
      const groups = current.workspace.groups.map((group) => ({ ...group, tabs: group.tabs.filter((tab) => tab.id !== tabId) }));
      const ungrouped_tabs = current.workspace.ungrouped_tabs.filter((tab) => tab.id !== tabId);
      const remaining = [...ungrouped_tabs, ...groups.flatMap((group) => group.tabs)];
      const active = current.workspace.active_tab_id === tabId ? remaining[0]?.id ?? null : current.workspace.active_tab_id;
      return { ...current, workspace: { ...current.workspace, ungrouped_tabs, groups, active_tab_id: active } };
    });
  }, [busy, runtime]);

  const reopenClosedRepository = useCallback(async () => {
    if (busy) return;
    let restore: RepositoryTab | undefined;
    while (closedTabsRef.current.length) {
      const candidate = closedTabsRef.current[closedTabsRef.current.length - 1];
      closedTabsRef.current = closedTabsRef.current.slice(0, -1);
      if (!workspaceTabs(workspaceRef.current).some((tab) => tab.repository_path === candidate.repository_path)) {
        restore = candidate;
        break;
      }
    }
    if (!restore) return;
    setBusy(true);
    try {
      const opened: OpenedRepository = await gitcatApi.openRepository(restore.repository_path);
      const tab: RepositoryTab = { ...restore, id: makeId("tab"), repository_path: opened.info.root, order: 0 };
      setRuntime((current) => ({ ...current, [tab.id]: opened }));
      setPersisted((current) => {
        const ungrouped_tabs = [
          ...current.workspace.ungrouped_tabs,
          { ...tab, order: current.workspace.ungrouped_tabs.length },
        ];
        return { ...current, workspace: { ...current.workspace, ungrouped_tabs, active_tab_id: tab.id } };
      });
    } catch (error) {
      showError("Repository could not be reopened", error);
    } finally {
      setBusy(false);
    }
  }, [busy, showError]);

  const moveRepositoryTab = useCallback((tabId: string, groupId: string | null) => {
    setPersisted((current) => {
      let moved = current.workspace.ungrouped_tabs.find((tab) => tab.id === tabId);
      const ungroupedWithout = current.workspace.ungrouped_tabs.filter((tab) => tab.id !== tabId);
      const groupsWithout = current.workspace.groups.map((group) => ({
        ...group,
        tabs: group.tabs.filter((tab) => {
          if (tab.id === tabId) moved = tab;
          return tab.id !== tabId;
        }),
      }));
      const movedTab = moved;
      if (!movedTab) return current;
      if (groupId === null) {
        const ungrouped_tabs = [...ungroupedWithout, { ...movedTab, order: ungroupedWithout.length }];
        return { ...current, workspace: { ...current.workspace, ungrouped_tabs, groups: groupsWithout } };
      }
      const groups = groupsWithout.map((group) => group.id === groupId
        ? { ...group, collapsed: false, tabs: [...group.tabs, { ...movedTab, order: group.tabs.length }] }
        : group);
      return { ...current, workspace: { ...current.workspace, ungrouped_tabs: ungroupedWithout, groups } };
    });
  }, []);

  const selectCommit = useCallback((commit: CommitSummary) => {
    ++diffLoadSequence.current;
    setSelectedOid(commit.oid);
    setWipSelected(false);
    setDetails(null);
    setCommitActions([]);
    setSelectedPath(undefined);
    setSelectedWorktreeFile(null);
    setDiff(null);
    setDiffLoading(false);
    setCenterView("graph");
  }, []);

  const selectWip = useCallback(() => {
    ++diffLoadSequence.current;
    setWipSelected(true);
    setSelectedOid(null);
    setDetails(null);
    setCommitActions([]);
    setSelectedPath(undefined);
    setSelectedWorktreeFile(null);
    setDiff(null);
    setDiffLoading(false);
    setCenterView("graph");
  }, []);

  const loadDiff = useCallback(async (request: DiffRequest) => {
    if (!activeRepository) return;
    const repositoryId = activeRepository.repository_id;
    const sequence = ++diffLoadSequence.current;
    setSelectedPath(request.path);
    setCenterView("diff");
    setDiff(null);
    setDiffLoading(true);
    try {
      const nextDiff = await gitcatApi.diff(repositoryId, request);
      if (
        sequence !== diffLoadSequence.current
        || activeRepositoryIdRef.current !== repositoryId
      ) return;
      setDiff(nextDiff);
    } catch (error) {
      if (
        sequence === diffLoadSequence.current
        && activeRepositoryIdRef.current === repositoryId
      ) showError("Diff could not be loaded", error);
    } finally {
      if (sequence === diffLoadSequence.current) setDiffLoading(false);
    }
  }, [activeRepository, showError]);

  const openCommitFile = useCallback((file: ChangedFile) => {
    if (!selectedOid) return;
    setSelectedWorktreeFile(null);
    void loadDiff({
      target: { kind: "commit", oid: selectedOid, parent_index: 0 },
      path: file.new_path,
      context_lines: persisted.settings.diff_context_lines,
      ignore_whitespace: false,
      max_bytes: persisted.settings.diff_max_bytes,
    });
  }, [loadDiff, persisted.settings.diff_context_lines, persisted.settings.diff_max_bytes, selectedOid]);

  const openWorktreeDiff = useCallback((entry: StatusEntry, staged: boolean) => {
    setSelectedWorktreeFile({ path: entry.path, staged });
    void loadDiff({
      target: { kind: staged ? "staged" : "worktree" },
      path: entry.path,
      context_lines: persisted.settings.diff_context_lines,
      ignore_whitespace: false,
      max_bytes: persisted.settings.diff_max_bytes,
    });
  }, [loadDiff, persisted.settings.diff_context_lines, persisted.settings.diff_max_bytes]);

  const openConflictEditor = useCallback(async (entry: StatusEntry) => {
    if (!activeRepository || busy) return;
    const repositoryId = activeRepository.repository_id;
    setBusy(true);
    try {
      const next = await gitcatApi.conflictDetails(repositoryId, entry.path);
      if (activeRepositoryIdRef.current === repositoryId) setConflictEditor(next);
    } catch (error) {
      if (activeRepositoryIdRef.current === repositoryId) showError("Conflict editor could not be opened", error);
    } finally {
      setBusy(false);
    }
  }, [activeRepository, busy, showError]);

  const resolveConflictEntry = useCallback((entry: StatusEntry, resolution: ConflictResolution) => {
    if (resolution === "delete" && !window.confirm(`Delete '${entry.path}' as the conflict resolution?`)) return;
    void runMutation("Conflict resolved", async (repository) => {
      const conflict = await gitcatApi.conflictDetails(repository.repository_id, entry.path);
      return gitcatApi.resolveConflict(
        repository.repository_id,
        entry.path,
        resolution,
        conflict.expected_state,
      );
    });
  }, [runMutation]);

  const copySha = useCallback(async (oid: string) => {
    try {
      await navigator.clipboard.writeText(oid);
      addToast({ tone: "success", title: "Commit SHA copied" });
    } catch (error) {
      showError("Could not copy SHA", error);
    }
  }, [addToast, showError]);

  const navigateSearch = useCallback((direction: 1 | -1) => {
    if (!searchOids.length) return;
    const next = (searchIndex + direction + searchOids.length) % searchOids.length;
    ++diffLoadSequence.current;
    setSearchIndex(next);
    setSelectedOid(searchOids[next]);
    setWipSelected(false);
    setDetails(null);
    setCommitActions([]);
    setSelectedPath(undefined);
    setSelectedWorktreeFile(null);
    setDiff(null);
    setDiffLoading(false);
    setCenterView("graph");
  }, [searchIndex, searchOids]);

  const fetchActiveRepository = useCallback(() => {
    void runMutation("Fetch complete", (repository) => gitcatApi.fetch(repository.repository_id, {
      remote: null,
      prune: persisted.settings.auto_prune,
      tags: false,
    }));
  }, [persisted.settings.auto_prune, runMutation]);

  const pullActiveRepository = useCallback((mode: PullMode = persisted.settings.default_pull_mode) => {
    void runMutation("Pull complete", (repository) => gitcatApi.pull(repository.repository_id, {
      remote: null,
      branch: null,
      mode,
      prune: persisted.settings.auto_prune,
      autostash: false,
    }));
  }, [persisted.settings.auto_prune, persisted.settings.default_pull_mode, runMutation]);

  const pushActiveRepository = useCallback(() => {
    void runMutation("Push complete", (repository) => gitcatApi.push(repository.repository_id, {
      remote: null,
      branch: null,
      set_upstream: false,
    }));
  }, [runMutation]);

  const createBranchAtHead = useCallback(() => {
    if (!snapshot) return;
    const oid = snapshot.head.kind === "unborn" ? null : snapshot.head.oid;
    if (oid) setPrompt({ kind: "create_branch", startOid: oid });
    else addToast({ tone: "info", title: "Create the first commit before branching" });
  }, [addToast, snapshot]);

  const stashActiveRepository = useCallback(() => {
    void runMutation("Changes stashed", (repository) => gitcatApi.stashPush(repository.repository_id, null, true));
  }, [runMutation]);

  const continueActiveOperation = useCallback(() => {
    const operation = snapshot ? continuableOperation(snapshot.operation_state) : null;
    if (operation) void runMutation("Operation continued", (repository) => gitcatApi.continueOperation(repository.repository_id, operation));
  }, [runMutation, snapshot]);

  const abortActiveOperation = useCallback(() => {
    const operation = snapshot ? continuableOperation(snapshot.operation_state) : null;
    if (!operation || !window.confirm(`Abort the active ${operation.replace("_", "-")} operation and discard its in-progress state?`)) return;
    void runMutation("Operation aborted", (repository) => gitcatApi.abortOperation(repository.repository_id, operation));
  }, [runMutation, snapshot]);

  const autoResolveActiveConflicts = useCallback(() => {
    if (!snapshot?.status.entries.some((entry) => entry.conflicted)) return;
    void runMutation("Recorded conflict resolutions applied", (repository) => gitcatApi.autoResolveConflicts(repository.repository_id));
  }, [runMutation, snapshot]);

  const focusCommitMessage = useCallback(() => {
    if (!snapshot) return;
    selectWip();
    setRightPanelVisible(true);
    requestAnimationFrame(() => document.getElementById("commit-message")?.focus());
  }, [selectWip, snapshot]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchFocusToken((token) => token + 1);
    setCenterView("graph");
  }, []);

  const refreshActiveRepository = useCallback(() => {
    if (!activeRepository || busy || overviewLoading) return;
    void loadOverview(activeRepository, true)
      .catch((error) => showError("Refresh failed", error));
  }, [activeRepository, busy, loadOverview, overviewLoading, showError]);

  // Keep the latest refresh behind a ref so the long-lived filesystem-change
  // listener below always calls the current one without re-subscribing.
  useEffect(() => {
    autoRefreshRef.current = refreshActiveRepository;
  }, [refreshActiveRepository]);

  // Auto-refresh the active repository when its files change on disk, so
  // commits, checkouts, or edits made outside GitCat appear without a manual
  // refresh. The backend watches one repository at a time and emits
  // `repository:changed`; we (re)point it at the active repository here.
  // No cleanup unwatch on switch: the backend replaces the previous watcher
  // atomically, so watching the next repository is enough. Explicitly unwatch
  // only when no repository is active (all tabs closed).
  useEffect(() => {
    if (gitcatApi.runtime !== "tauri") return;
    const repositoryId = activeRepository?.repository_id;
    if (repositoryId) void gitcatApi.watchRepository(repositoryId).catch(() => undefined);
    else void gitcatApi.unwatchRepository().catch(() => undefined);
  }, [activeRepository?.repository_id]);

  useEffect(() => {
    if (gitcatApi.runtime !== "tauri") return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stop = await listen<{ repository_id: string }>(
        "repository:changed",
        (event) => {
          if (event.payload.repository_id === activeRepositoryIdRef.current) {
            autoRefreshRef.current();
          }
        },
      );
      if (disposed) stop();
      else unlisten = stop;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const orderedTabIds = useMemo(
    () => workspaceTabs(persisted.workspace)
      .map((tab) => tab.id)
      .filter((tabId) => runtime[tabId] !== undefined),
    [persisted.workspace, runtime],
  );

  const activateRepositoryTab = useCallback((nextId: string | undefined) => {
    if (!nextId) return;
    setPersisted((current) => ({
      ...current,
      workspace: {
        ...current.workspace,
        active_tab_id: nextId,
        groups: current.workspace.groups.map((group) => (
          group.tabs.some((tab) => tab.id === nextId) ? { ...group, collapsed: false } : group
        )),
      },
    }));
  }, []);

  const cycleRepository = useCallback((direction: 1 | -1) => {
    if (orderedTabIds.length < 2) return;
    const currentIndex = activeTabId ? orderedTabIds.indexOf(activeTabId) : -1;
    const nextIndex = (currentIndex + direction + orderedTabIds.length) % orderedTabIds.length;
    activateRepositoryTab(orderedTabIds[nextIndex]);
  }, [activateRepositoryTab, activeTabId, orderedTabIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const keybinds = persisted.settings.keybinds;
      const editable = isEditableTarget(event.target);
      const matches = (binding: string) => (
        matchesKeybind(event, binding)
        && !(editable && isPlainTypingKeybind(binding))
      );
      if (settingsOpen || conflictEditor || prompt || resetCommit || commitMenu || tabMenu) {
        if (Object.values(keybinds).some((binding) => matches(binding))) event.preventDefault();
        return;
      }
      if (matches(keybinds.next_repository)) {
        event.preventDefault();
        if (orderedTabIds.length > 1) cycleRepository(1);
      } else if (matches(keybinds.previous_repository)) {
        event.preventDefault();
        if (orderedTabIds.length > 1) cycleRepository(-1);
      } else if ([
        keybinds.repository_1,
        keybinds.repository_2,
        keybinds.repository_3,
        keybinds.repository_4,
        keybinds.repository_5,
        keybinds.repository_6,
        keybinds.repository_7,
        keybinds.repository_8,
        keybinds.repository_9,
      ].some(matches)) {
        event.preventDefault();
        const directBindings = [
          keybinds.repository_1,
          keybinds.repository_2,
          keybinds.repository_3,
          keybinds.repository_4,
          keybinds.repository_5,
          keybinds.repository_6,
          keybinds.repository_7,
          keybinds.repository_8,
          keybinds.repository_9,
        ];
        activateRepositoryTab(orderedTabIds[directBindings.findIndex(matches)]);
      } else if (matches(keybinds.new_repository_tab)) {
        event.preventDefault();
        if (!busy) void chooseRepository();
      } else if (matches(keybinds.close_repository)) {
        event.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      } else if (matches(keybinds.reopen_closed_repository)) {
        event.preventDefault();
        if (!busy) void reopenClosedRepository();
      } else if (matches(keybinds.search_commits)) {
        event.preventDefault();
        if (activeRepository) openSearch();
      } else if (matches(keybinds.open_repository)) {
        event.preventDefault();
        if (!busy) void chooseRepository();
      } else if (matches(keybinds.open_repository_folder)) {
        event.preventDefault();
        if (activeRepository) {
          void gitcatApi.openRepositoryFolder(activeRepository.repository_id)
            .catch((error) => showError("Could not open repository folder", error));
        }
      } else if (matches(keybinds.open_settings)) {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (matches(keybinds.refresh_repository)) {
        event.preventDefault();
        refreshActiveRepository();
      } else if (matches(keybinds.toggle_left_panel)) {
        event.preventDefault();
        if (activeRepository) setLeftPanelVisible((visible) => !visible);
      } else if (matches(keybinds.toggle_right_panel)) {
        event.preventDefault();
        if (activeRepository) setRightPanelVisible((visible) => !visible);
      } else if (matches(keybinds.fetch)) {
        event.preventDefault();
        if (activeRepository && !busy) fetchActiveRepository();
      } else if (matches(keybinds.pull)) {
        event.preventDefault();
        if (activeRepository && !busy) pullActiveRepository();
      } else if (matches(keybinds.push)) {
        event.preventDefault();
        if (activeRepository && !busy) pushActiveRepository();
      } else if (matches(keybinds.create_branch)) {
        event.preventDefault();
        if (activeRepository && !busy) createBranchAtHead();
      } else if (matches(keybinds.stash)) {
        event.preventDefault();
        if (activeRepository && !busy) stashActiveRepository();
      } else if (matches(keybinds.show_worktree)) {
        event.preventDefault();
        if (activeRepository) {
          selectWip();
          setRightPanelVisible(true);
        }
      } else if (matches(keybinds.show_graph)) {
        event.preventDefault();
        if (activeRepository) setCenterView("graph");
      } else if (matches(keybinds.diff_inline)) {
        event.preventDefault();
        if (diff) setDiffMode("inline");
      } else if (matches(keybinds.diff_split)) {
        event.preventDefault();
        if (diff) setDiffMode("split");
      } else if (matches(keybinds.copy_selected_sha)) {
        event.preventDefault();
        if (selectedOid) void copySha(selectedOid);
      } else if (matches(keybinds.continue_operation)) {
        event.preventDefault();
        if (!busy) continueActiveOperation();
      } else if (matches(keybinds.abort_operation)) {
        event.preventDefault();
        if (!busy) abortActiveOperation();
      } else if (
        matches(keybinds.stage_all)
      ) {
        event.preventDefault();
        if (activeRepository && snapshot && wipSelected) {
          const paths = snapshot.status.entries
            .filter((entry) => entry.worktree && !entry.conflicted)
            .map((entry) => entry.path);
          if (paths.length) stagePaths(paths);
        }
      } else if (
        matches(keybinds.unstage_all)
      ) {
        event.preventDefault();
        if (activeRepository && snapshot && wipSelected) {
          const paths = snapshot.status.entries.filter((entry) => entry.index && !entry.conflicted).map((entry) => entry.path);
          if (paths.length) unstagePaths(paths);
        }
      } else if (matches(keybinds.focus_commit_message)) {
        event.preventDefault();
        focusCommitMessage();
      } else if (matches(keybinds.auto_resolve_conflicts)) {
        event.preventDefault();
        if (!busy) autoResolveActiveConflicts();
      } else if (matches(keybinds.commit)) {
        event.preventDefault();
        window.dispatchEvent(new Event("gitcat:commit"));
      } else if (event.key === "Escape") {
        setCommitMenu(null);
        setTabMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeRepository,
    activeTabId,
    abortActiveOperation,
    activateRepositoryTab,
    autoResolveActiveConflicts,
    busy,
    chooseRepository,
    closeTab,
    commitMenu,
    conflictEditor,
    continueActiveOperation,
    copySha,
    createBranchAtHead,
    cycleRepository,
    diff,
    fetchActiveRepository,
    focusCommitMessage,
    overviewLoading,
    orderedTabIds.length,
    orderedTabIds,
    openSearch,
    persisted.settings.keybinds,
    prompt,
    pullActiveRepository,
    pushActiveRepository,
    refreshActiveRepository,
    reopenClosedRepository,
    resetCommit,
    runMutation,
    settingsOpen,
    showError,
    selectWip,
    snapshot,
    stagePaths,
    stashActiveRepository,
    tabMenu,
    unstagePaths,
    wipSelected,
  ]);

  const commitActionMap = useMemo(
    () => new Map(commitActions.map((action) => [action.kind, action])),
    [commitActions],
  );

  const contextActions = useMemo<ContextAction[]>(() => {
    if (!commitMenu) return [];
    const availabilityMatchesCommit = details?.oid === commitMenu.commit.oid;
    const enabled = (kind: CommitActionAvailability["kind"]) => (
      availabilityMatchesCommit && (commitActionMap.get(kind)?.enabled ?? false)
    );
    return [
      { id: "checkout", label: "Checkout commit (detached)", icon: <GitCommitHorizontal size={15} />, disabled: !enabled("checkout") },
      { id: "branch", label: "Create branch here…", icon: <GitBranchPlus size={15} />, disabled: !enabled("create_branch") },
      { id: "tag", label: "Create tag here…", icon: <Tag size={15} />, disabled: !enabled("create_tag") },
      { id: "cherry_pick", label: "Cherry-pick commit", icon: <GitPullRequestArrow size={15} />, disabled: !enabled("cherry_pick"), separatorBefore: true },
      { id: "revert", label: "Revert commit", icon: <RotateCcw size={15} />, disabled: !enabled("revert") },
      { id: "reset", label: "Reset branch to commit…", icon: <Trash2 size={15} />, disabled: !enabled("reset"), danger: true, separatorBefore: true },
      { id: "copy", label: "Copy full commit SHA", icon: <Copy size={15} />, separatorBefore: true },
    ];
  }, [commitActionMap, commitMenu, details?.oid]);

  const executeCommitAction = useCallback((action: string) => {
    if (!commitMenu) return;
    const commit = commitMenu.commit;
    setCommitMenu(null);
    switch (action) {
      case "copy":
        void copySha(commit.oid);
        break;
      case "branch":
        setPrompt({ kind: "create_branch", startOid: commit.oid });
        break;
      case "tag":
        setPrompt({ kind: "create_tag", oid: commit.oid });
        break;
      case "checkout":
        if (window.confirm(`Check out ${commit.short_oid} in detached HEAD state?`)) {
          void runMutation("Commit checked out", (repository) => gitcatApi.checkoutCommit(repository.repository_id, commit.oid));
        }
        break;
      case "cherry_pick": {
        const mainline = commit.parent_oids.length > 1 ? Number(window.prompt("Mainline parent number", "1")) : null;
        if (commit.parent_oids.length > 1 && (!mainline || mainline < 1)) break;
        void runMutation("Commit cherry-picked", (repository) => gitcatApi.cherryPick(repository.repository_id, commit.oid, mainline));
        break;
      }
      case "revert": {
        const mainline = commit.parent_oids.length > 1 ? Number(window.prompt("Mainline parent number", "1")) : null;
        if (commit.parent_oids.length > 1 && (!mainline || mainline < 1)) break;
        void runMutation("Commit reverted", (repository) => gitcatApi.revertCommit(repository.repository_id, commit.oid, mainline));
        break;
      }
      case "reset":
        setResetCommit(commit);
        break;
    }
  }, [commitMenu, copySha, runMutation]);

  const tabContextActions = useMemo<ContextAction[]>(() => {
    if (!tabMenu) return [];
    const orderedTabs = workspaceTabs(persisted.workspace);
    const tabIndex = orderedTabs.findIndex((tab) => tab.id === tabMenu.tab.id);
    return [
      { id: "activate", label: "Activate repository", icon: <GitCommitHorizontal size={15} /> },
      {
        id: "move:ungrouped",
        label: tabMenu.groupId === null ? "No folder (current)" : "Move to no folder",
        icon: <FolderX size={15} />,
        disabled: tabMenu.groupId === null,
        separatorBefore: true,
      },
      ...persisted.workspace.groups.map((group) => ({
        id: `move:${group.id}`,
        label: group.id === tabMenu.groupId ? `${group.name} (current)` : `Move to ${group.name}`,
        icon: <FolderInput size={15} />,
        disabled: group.id === tabMenu.groupId,
      })),
      { id: "new_folder", label: "Move to new folder…", icon: <FolderPlus size={15} /> },
      { id: "alias", label: "Rename tab…", icon: <Tag size={15} />, separatorBefore: true },
      { id: "copy_path", label: "Copy repository path", icon: <Copy size={15} /> },
      { id: "close_others", label: "Close other repositories", icon: <X size={15} />, disabled: orderedTabs.length <= 1, separatorBefore: true },
      { id: "close_right", label: "Close repositories to the right", icon: <X size={15} />, disabled: tabIndex < 0 || tabIndex === orderedTabs.length - 1 },
      { id: "close", label: "Close repository", icon: <X size={15} /> },
    ];
  }, [persisted.workspace.groups, tabMenu]);

  const executeTabAction = useCallback((action: string) => {
    if (!tabMenu) return;
    const selectedTab = tabMenu.tab;
    setTabMenu(null);
    if (action === "activate") {
      setPersisted((current) => ({ ...current, workspace: { ...current.workspace, active_tab_id: selectedTab.id } }));
    } else if (action === "move:ungrouped") {
      moveRepositoryTab(selectedTab.id, null);
    } else if (action.startsWith("move:")) {
      moveRepositoryTab(selectedTab.id, action.slice("move:".length));
    } else if (action === "new_folder") {
      setPrompt({ kind: "create_group", tabId: selectedTab.id });
    } else if (action === "alias") {
      setPrompt({ kind: "alias_tab", tabId: selectedTab.id, current: selectedTab.label });
    } else if (action === "copy_path") {
      void navigator.clipboard.writeText(selectedTab.path)
        .then(() => addToast({ tone: "success", title: "Repository path copied" }))
        .catch((error) => showError("Could not copy repository path", error));
    } else if (action === "close_others") {
      workspaceTabs(persisted.workspace)
        .filter((tab) => tab.id !== selectedTab.id)
        .forEach((tab) => closeTab(tab.id));
      activateRepositoryTab(selectedTab.id);
    } else if (action === "close_right") {
      const tabs = workspaceTabs(persisted.workspace);
      const index = tabs.findIndex((tab) => tab.id === selectedTab.id);
      tabs.slice(index + 1).forEach((tab) => closeTab(tab.id));
    } else if (action === "close") {
      closeTab(selectedTab.id);
    }
  }, [activateRepositoryTab, addToast, closeTab, moveRepositoryTab, persisted.workspace, showError, tabMenu]);

  const submitPrompt = useCallback((value: string) => {
    if (!prompt) return;
    const currentPrompt = prompt;
    setPrompt(null);
    switch (currentPrompt.kind) {
      case "create_group":
        setPersisted((current) => {
          const groupId = makeId("group");
          let moved = currentPrompt.tabId
            ? current.workspace.ungrouped_tabs.find((tab) => tab.id === currentPrompt.tabId)
            : undefined;
          const ungrouped_tabs = currentPrompt.tabId
            ? current.workspace.ungrouped_tabs.filter((tab) => tab.id !== currentPrompt.tabId)
            : current.workspace.ungrouped_tabs;
          const groupsWithout = current.workspace.groups.map((group) => ({
            ...group,
            tabs: currentPrompt.tabId ? group.tabs.filter((tab) => {
              if (tab.id === currentPrompt.tabId) moved = tab;
              return tab.id !== currentPrompt.tabId;
            }) : group.tabs,
          }));
          const group = {
            id: groupId,
            name: value,
            collapsed: false,
            order: groupsWithout.length,
            tabs: moved ? [{ ...moved, order: 0 }] : [],
          };
          return {
            ...current,
            workspace: { ...current.workspace, ungrouped_tabs, groups: [...groupsWithout, group] },
          };
        });
        break;
      case "rename_group":
        setPersisted((current) => ({ ...current, workspace: { ...current.workspace, groups: current.workspace.groups.map((group) => group.id === currentPrompt.groupId ? { ...group, name: value } : group) } }));
        break;
      case "alias_tab":
        setPersisted((current) => ({
          ...current,
          workspace: {
            ...current.workspace,
            ungrouped_tabs: current.workspace.ungrouped_tabs.map((tab) => tab.id === currentPrompt.tabId ? { ...tab, display_name: value } : tab),
            groups: current.workspace.groups.map((group) => ({
              ...group,
              tabs: group.tabs.map((tab) => tab.id === currentPrompt.tabId ? { ...tab, display_name: value } : tab),
            })),
          },
        }));
        break;
      case "create_branch":
        void runMutation("Branch created", (repository) => gitcatApi.createBranch(repository.repository_id, value, currentPrompt.startOid, true));
        break;
      case "remote_branch":
        void runMutation("Remote branch checked out", (repository) => gitcatApi.createBranch(repository.repository_id, value, currentPrompt.branch.oid, true));
        break;
      case "rename_branch":
        void runMutation("Branch renamed", (repository) => gitcatApi.renameBranch(repository.repository_id, currentPrompt.branch.name, value));
        break;
      case "create_tag":
        void runMutation("Tag created", (repository) => gitcatApi.createTag(repository.repository_id, value, currentPrompt.oid, null));
        break;
    }
  }, [prompt, runMutation]);

  const promptConfig = useMemo(() => {
    if (!prompt) return null;
    switch (prompt.kind) {
      case "create_group": return { title: "New repository group", label: "Group name", placeholder: "Client work", confirmLabel: "Create group" };
      case "rename_group": return { title: "Rename repository group", label: "Group name", initialValue: prompt.current, confirmLabel: "Rename" };
      case "alias_tab": return { title: "Rename repository tab", label: "Tab name", initialValue: prompt.current, confirmLabel: "Rename" };
      case "create_branch": return { title: "Create branch", label: "Branch name", placeholder: "feature/short-name", confirmLabel: "Create and checkout" };
      case "remote_branch": return { title: "Check out remote branch", label: "Local branch name", initialValue: prompt.branch.name.split("/").slice(1).join("/"), confirmLabel: "Create and checkout" };
      case "rename_branch": return { title: "Rename branch", label: "New branch name", initialValue: prompt.branch.name, confirmLabel: "Rename" };
      case "create_tag": return { title: "Create tag", label: "Tag name", placeholder: "v1.0.0", confirmLabel: "Create tag" };
    }
  }, [prompt]);

  const activeConflictCount = snapshot?.status.entries.filter((entry) => entry.conflicted).length ?? 0;
  const conflictTarget = activeTab?.conflict_target_disabled
    ? null
    : activeTab?.conflict_target ?? defaultConflictPreflightTarget(snapshot);
  const conflictTargets = useMemo(() => {
    if (!snapshot) return conflictTarget ? [conflictTarget] : [];
    const candidates = [
      ...snapshot.local_branches.filter((branch) => !branch.is_head).map((branch) => branch.name),
      ...snapshot.remote_branches.map((branch) => branch.name),
    ];
    if (conflictTarget) candidates.push(conflictTarget);
    return [...new Set(candidates)].sort((left, right) => left.localeCompare(right));
  }, [conflictTarget, snapshot]);
  const conflictHeadOid = snapshot?.head.kind === "unborn" ? null : snapshot?.head.oid ?? null;
  const conflictTargetOid = snapshot
    ? [...snapshot.local_branches, ...snapshot.remote_branches].find((branch) => branch.name === conflictTarget)?.oid ?? null
    : null;

  const selectConflictTarget = useCallback((target: string | null) => {
    if (!activeTabId) return;
    setPersisted((current) => ({
      ...current,
      workspace: {
        ...current.workspace,
        ungrouped_tabs: current.workspace.ungrouped_tabs.map((tab) => (
          tab.id === activeTabId
            ? { ...tab, conflict_target: target, conflict_target_disabled: target === null }
            : tab
        )),
        groups: current.workspace.groups.map((group) => ({
          ...group,
          tabs: group.tabs.map((tab) => (
            tab.id === activeTabId
              ? { ...tab, conflict_target: target, conflict_target_disabled: target === null }
              : tab
          )),
        })),
      },
    }));
  }, [activeTabId]);

  useEffect(() => {
    const sequence = ++conflictPreflightSequence.current;
    if (!activeRepository || activeConflictCount || !conflictTarget) {
      setConflictPreflight(null);
      setConflictPreflightLoading(false);
      return;
    }

    const repositoryId = activeRepository.repository_id;
    setConflictPreflight(null);
    setConflictPreflightLoading(true);
    void gitcatApi.conflictPreflight(repositoryId, conflictTarget)
      .then((result) => {
        if (
          sequence !== conflictPreflightSequence.current
          || activeRepositoryIdRef.current !== repositoryId
        ) return;
        setConflictPreflight(result);
      })
      .catch((error) => {
        if (
          sequence !== conflictPreflightSequence.current
          || activeRepositoryIdRef.current !== repositoryId
        ) return;
        const apiError = getApiError(error);
        setConflictPreflight({
          target: conflictTarget,
          target_oid: "",
          state: "unavailable",
          conflicting_paths: [],
          unavailable_reason: apiError.details ?? apiError.message,
        });
      })
      .finally(() => {
        if (sequence === conflictPreflightSequence.current) setConflictPreflightLoading(false);
      });
  }, [activeConflictCount, activeRepository, conflictHeadOid, conflictTarget, conflictTargetOid]);

  const conflictIndicator: ConflictIndicator = activeConflictCount
    ? {
        state: "active",
        count: activeConflictCount,
        label: `${activeConflictCount} unresolved ${conflictOperationLabel(snapshot?.operation_state ?? "normal")} conflict${activeConflictCount === 1 ? "" : "s"}`,
      }
    : conflictPreflightLoading
      ? { state: "checking", label: `Checking conflicts against ${conflictTarget ?? "upstream"}` }
      : conflictPreflight?.state === "clean"
        ? { state: "clean", label: `No conflicts detected against ${conflictPreflight.target}` }
        : conflictPreflight?.state === "conflicting"
          ? {
              state: "conflicting",
              count: conflictPreflight.conflicting_paths.length,
              label: `${conflictPreflight.conflicting_paths.length} potential conflict${conflictPreflight.conflicting_paths.length === 1 ? "" : "s"} against ${conflictPreflight.target}`,
            }
          : {
              state: "unavailable",
              label: conflictPreflight?.unavailable_reason
                ?? (conflictTarget ? `Conflict check unavailable for ${conflictTarget}` : "Choose a comparison target to enable conflict checks"),
            };

  const showConflictIndicator = useCallback(() => {
    if (activeConflictCount) {
      setSelectedOid(null);
      setWipSelected(true);
      setRightPanelVisible(true);
      setCenterView("graph");
      addToast({ tone: "info", title: conflictIndicator.label, detail: "Resolve each file in the Working tree panel." });
      return;
    }
    if (conflictPreflight?.state === "conflicting") {
      const preview = conflictPreflight.conflicting_paths.slice(0, 4).join(", ");
      const remainder = conflictPreflight.conflicting_paths.length - 4;
      addToast({
        tone: "info",
        title: conflictIndicator.label,
        detail: `${preview}${remainder > 0 ? `, and ${remainder} more` : ""}`,
      });
      return;
    }
    addToast({ tone: conflictPreflight?.state === "clean" ? "success" : "info", title: conflictIndicator.label });
  }, [activeConflictCount, addToast, conflictIndicator.label, conflictPreflight]);
  const toTabView = useCallback((tab: RepositoryTab): TabView => ({
    id: tab.id,
    label: tab.display_name,
    path: tab.repository_path,
    dirty: tab.id === activeTabId && snapshot ? !snapshot.status.clean : false,
    conflictCount: tab.id === activeTabId ? activeConflictCount : 0,
    unavailable: !runtime[tab.id],
  }), [activeConflictCount, activeTabId, runtime, snapshot]);
  const ungroupedTabs = useMemo(
    () => persisted.workspace.ungrouped_tabs.map(toTabView),
    [persisted.workspace.ungrouped_tabs, toTabView],
  );
  const tabGroups = useMemo<TabGroupView[]>(() => persisted.workspace.groups.map((group) => ({
    id: group.id,
    name: group.name,
    collapsed: group.collapsed,
    tabs: group.tabs.map(toTabView),
  })), [persisted.workspace.groups, toTabView]);

  const beginResize = (side: "left" | "right", startEvent: React.PointerEvent) => {
    startEvent.currentTarget.setPointerCapture(startEvent.pointerId);
    const startX = startEvent.clientX;
    const startWidth = side === "left" ? sidebarWidth : detailsWidth;
    const move = (event: PointerEvent) => {
      const delta = event.clientX - startX;
      if (side === "left") setSidebarWidth(Math.max(190, Math.min(380, startWidth + delta)));
      else setDetailsWidth(Math.max(300, Math.min(560, startWidth - delta)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const graphMatches = useMemo(() => new Set(searchOids), [searchOids]);
  const graphColumnWidth = useMemo(
    () => getCommitGraphWidth(history?.commits ?? []),
    [history],
  );
  const currentHeadOid = snapshot?.head.kind === "unborn" ? null : snapshot?.head.oid ?? null;
  const activeCommitDraft = activeTabId
    ? commitDrafts[activeTabId] ?? EMPTY_COMMIT_DRAFT
    : EMPTY_COMMIT_DRAFT;
  const updateActiveCommitDraft = useCallback((draft: CommitDraft) => {
    if (!activeTabId) return;
    setCommitDrafts((current) => ({ ...current, [activeTabId]: draft }));
  }, [activeTabId]);
  const pendingOperation = snapshot
    ? continuableOperation(snapshot.operation_state)
    : null;

  if (initializing) {
    return <div className="gc-app gc-app--boot"><LoaderCircle size={24} /><span>Opening GitCat…</span></div>;
  }

  return (
    <div className="gc-app">
      <TopTabs
        activeTabId={activeTabId ?? undefined}
        actionsDisabled={busy}
        groups={tabGroups}
        ungroupedTabs={ungroupedTabs}
        onClose={closeTab}
        onCreateGroup={() => setPrompt({ kind: "create_group" })}
        onMoveTab={moveRepositoryTab}
        onOpen={() => void chooseRepository()}
        onRenameGroup={(groupId) => {
          const group = persisted.workspace.groups.find((item) => item.id === groupId);
          if (group) setPrompt({ kind: "rename_group", groupId, current: group.name });
        }}
        onSelect={activateRepositoryTab}
        onTabContextMenu={(request: RepositoryTabContextMenuRequest) => {
          setCommitMenu(null);
          setTabMenu({
            x: request.clientX,
            y: request.clientY,
            tab: request.tab,
            groupId: request.groupId,
          });
        }}
        onToggleGroup={(groupId) => setPersisted((current) => ({ ...current, workspace: { ...current.workspace, groups: current.workspace.groups.map((group) => group.id === groupId ? { ...group, collapsed: !group.collapsed } : group) } }))}
      />

      {!activeRepository ? (
        <WelcomeView
          onOpen={() => void chooseRepository()}
          openKeybind={persisted.settings.keybinds.open_repository}
        />
      ) : (
        <>
          <Toolbar
            branchName={currentBranch(snapshot)}
            busy={busy || overviewLoading}
            conflictIndicator={conflictIndicator}
            conflictTarget={conflictTarget}
            conflictTargets={conflictTargets}
            leftPanelKeybind={persisted.settings.keybinds.toggle_left_panel}
            leftPanelVisible={leftPanelVisible}
            onCreateBranch={createBranchAtHead}
            onConflictIndicator={showConflictIndicator}
            onConflictTargetChange={selectConflictTarget}
            onFetch={fetchActiveRepository}
            onPull={pullActiveRepository}
            onPullModeChange={(mode) => setPersisted((current) => ({ ...current, settings: { ...current.settings, default_pull_mode: mode } }))}
            onPush={pushActiveRepository}
            onRefresh={refreshActiveRepository}
            onSearch={openSearch}
            onSettings={() => setSettingsOpen(true)}
            onStash={stashActiveRepository}
            onToggleLeftPanel={() => setLeftPanelVisible((visible) => !visible)}
            onToggleRightPanel={() => setRightPanelVisible((visible) => !visible)}
            operation={snapshot?.operation_state ?? "normal"}
            pullMode={persisted.settings.default_pull_mode}
            repositoryName={activeRepository.info.name}
            rightPanelKeybind={persisted.settings.keybinds.toggle_right_panel}
            rightPanelVisible={rightPanelVisible}
            searchKeybind={persisted.settings.keybinds.search_commits}
            settingsKeybind={persisted.settings.keybinds.open_settings}
          />

          {snapshot && snapshot.operation_state !== "normal" ? (
            <div className="gc-operation-banner" role="status">
              <AlertTriangle size={16} />
              <span>
                <strong>{snapshot.operation_state.replace("_", " ")} in progress.</strong>{" "}
                {pendingOperation
                  ? "Resolve conflicted files, then continue or abort."
                  : "Complete or abort this bisect from Git before running another operation."}
              </span>
              {pendingOperation ? (
                <>
                  <Button compact onClick={continueActiveOperation}>Continue</Button>
                  <Button compact onClick={abortActiveOperation} tone="danger">Abort</Button>
                </>
              ) : null}
            </div>
          ) : null}

          <main
            className={`gc-workspace${leftPanelVisible ? "" : " gc-workspace--left-hidden"}${rightPanelVisible ? "" : " gc-workspace--right-hidden"}`}
            style={{
              gridTemplateColumns: `${leftPanelVisible ? sidebarWidth : 0}px ${leftPanelVisible ? 5 : 0}px minmax(0, 1fr) ${rightPanelVisible ? 5 : 0}px ${rightPanelVisible ? detailsWidth : 0}px`,
            }}
          >
            <div className="gc-panel-slot" hidden={!leftPanelVisible}>
                <RefSidebar
                  localBranches={snapshot?.local_branches ?? []}
                  onCheckout={(branch) => {
                    if (!branch.is_head) void runMutation(`Checked out ${branch.name}`, (repository) => gitcatApi.checkoutBranch(repository.repository_id, branch.name));
                  }}
                  onCheckoutRemote={(branch) => setPrompt({ kind: "remote_branch", branch })}
                  onCreateBranch={() => currentHeadOid ? setPrompt({ kind: "create_branch", startOid: currentHeadOid }) : undefined}
                  onDeleteBranch={(branch) => {
                    if (!snapshot || !window.confirm(`Delete local branch '${branch.name}'?`)) return;
                    void runMutation("Branch deleted", (repository) => gitcatApi.deleteBranch(repository.repository_id, branch.name, false, true, expectedState(snapshot)));
                  }}
                  onRenameBranch={(branch) => setPrompt({ kind: "rename_branch", branch })}
                  remoteBranches={snapshot?.remote_branches ?? []}
                  tags={snapshot?.tags ?? []}
                />
            </div>
            <div
              aria-hidden="true"
              className="gc-resizer gc-resizer--left"
              hidden={!leftPanelVisible}
              onPointerDown={(event) => beginResize("left", event)}
            />

            <section className="gc-center" aria-label="Repository history">
              <header className="gc-center__header">
                <div className="gc-view-tabs">
                  <button className={centerView === "graph" ? "active" : ""} onClick={() => setCenterView("graph")} type="button">Graph</button>
                  <button className={centerView === "diff" ? "active" : ""} disabled={!diff && !diffLoading} onClick={() => setCenterView("diff")} type="button">Diff</button>
                </div>
                {centerView === "diff" ? (
                  <button className="gc-back-button" onClick={() => setCenterView("graph")} type="button"><ArrowLeft size={14} /> Back to graph</button>
                ) : (
                  <span className="gc-center__summary">{history?.commits.length ?? 0} commits loaded</span>
                )}
              </header>
              {searchOpen && centerView === "graph" ? (
                <SearchBar
                  activeIndex={searchIndex}
                  busy={searchBusy}
                  count={searchOids.length}
                  focusToken={searchFocusToken}
                  onChange={setSearchQuery}
                  onClose={() => { setSearchOpen(false); setSearchQuery(""); }}
                  onNext={() => navigateSearch(1)}
                  onPrevious={() => navigateSearch(-1)}
                  value={searchQuery}
                />
              ) : null}
              {centerView === "diff" ? (
                <DiffViewer diff={diff} loading={diffLoading} mode={diffMode} onModeChange={setDiffMode} />
              ) : (
                <div
                  className="gc-graph-scroll"
                  style={{ "--gc-graph-column-width": `${graphColumnWidth}px` } as React.CSSProperties}
                >
                  <div className="gc-graph-columns" aria-hidden="true">
                    <span>Branch / Tag</span>
                    <span>Graph</span>
                    <span>Commit message</span>
                    <span>Author</span>
                    <span>Date / Time</span>
                    <span>SHA</span>
                  </div>
                  {snapshot && !snapshot.status.clean ? (
                    <button className={`gc-wip-row ${wipSelected ? "gc-wip-row--selected" : ""}`} onClick={selectWip} type="button">
                      <span className="gc-wip-row__refs"><span className="gc-ref-label gc-ref-label--head">{currentBranch(snapshot)}</span></span>
                      <span className="gc-wip-row__rail"><i /></span>
                      <span className="gc-wip-row__message">
                        <strong>// WIP</strong>
                        <small>{snapshot.status.entries.length} uncommitted change{snapshot.status.entries.length === 1 ? "" : "s"}</small>
                      </span>
                      <span className={activeConflictCount ? "gc-wip-row__conflicts" : "gc-muted"}>
                        {activeConflictCount ? <><AlertTriangle size={12} /> {activeConflictCount}</> : "Working tree"}
                      </span>
                      <span />
                      <b>{snapshot.status.entries.length}</b>
                    </button>
                  ) : null}
                  {history ? (
                    <CommitGraph
                      commits={history.commits}
                      hideHeadDecoration={Boolean(snapshot && !snapshot.status.clean)}
                      onCommitContextMenu={(request: CommitContextMenuRequest) => setCommitMenu({ x: request.clientX, y: request.clientY, commit: request.commit })}
                      onCopySha={(oid) => void copySha(oid)}
                      onSelect={selectCommit}
                      searchMatchOids={graphMatches}
                      selectedOid={selectedOid}
                    />
                  ) : <div className="gc-loading-panel"><Spinner label="Loading history" /> Loading history…</div>}
                  {history?.has_more && history.next_cursor ? (
                    <Button
                      className="gc-load-more"
                      disabled={busy || overviewLoading || historyLoading}
                      onClick={() => {
                        if (!activeRepository || busy || overviewLoading || historyLoading) return;
                        const repositoryId = activeRepository.repository_id;
                        const sequence = ++historyLoadSequence.current;
                        setHistoryLoading(true);
                        void gitcatApi.history(repositoryId, {
                          scope: { kind: "all_refs" },
                          cursor: history.next_cursor,
                          limit: persisted.settings.history_page_size,
                        }).then((page) => {
                          if (
                            sequence !== historyLoadSequence.current
                            || activeRepositoryIdRef.current !== repositoryId
                          ) return;
                          setHistory((current) => current
                            ? { ...page, commits: [...current.commits, ...page.commits] }
                            : page);
                        }).catch((error) => {
                          if (
                            sequence === historyLoadSequence.current
                            && activeRepositoryIdRef.current === repositoryId
                          ) showError("More commits could not be loaded", error);
                        }).finally(() => {
                          if (
                            sequence === historyLoadSequence.current
                            && activeRepositoryIdRef.current === repositoryId
                          ) setHistoryLoading(false);
                        });
                      }}
                    >{historyLoading ? "Loading older commits…" : "Load older commits"}</Button>
                  ) : null}
                </div>
              )}
            </section>

            <div
              aria-hidden="true"
              className="gc-resizer gc-resizer--right"
              hidden={!rightPanelVisible}
              onPointerDown={(event) => beginResize("right", event)}
            />
            <div className="gc-panel-slot" hidden={!rightPanelVisible}>
                {wipSelected && snapshot ? (
                  <WorktreePanel
                    busy={busy || overviewLoading}
                    branchName={currentBranch(snapshot)}
                    commitKeybind={persisted.settings.keybinds.commit}
                    draft={activeCommitDraft}
                    onAutoResolveConflicts={autoResolveActiveConflicts}
                    onCommit={(message, amend, signoff) => runMutation(amend ? "Commit amended" : "Commit created", (repository) => gitcatApi.createCommit(repository.repository_id, { message, amend, signoff }))}
                    onDraftChange={updateActiveCommitDraft}
                    onOpenDiff={openWorktreeDiff}
                    onOpenConflict={(entry) => void openConflictEditor(entry)}
                    onResolveConflict={resolveConflictEntry}
                    onStage={stagePaths}
                    onUnstage={unstagePaths}
                    onDiscard={(paths) => {
                      if (!window.confirm(`Discard all changes to ${paths.length === 1 ? paths[0] : `${paths.length} files`}? This cannot be undone.`)) return;
                      void runMutation("Changes discarded", (repository) => gitcatApi.discardPaths(repository.repository_id, paths));
                    }}
                    onStashFile={(paths) => void runMutation("File stashed", (repository) => gitcatApi.stashFile(repository.repository_id, paths, null))}
                    onIgnore={(patterns) => void runMutation("Updated .gitignore", (repository) => gitcatApi.appendGitignore(repository.repository_id, patterns))}
                    onCreatePatch={(paths, staged) => void createPatchFile(paths, staged)}
                    operation={snapshot.operation_state}
                    selectedFile={selectedWorktreeFile}
                    status={snapshot.status}
                  />
                ) : details ? (
                  <CommitDetails
                    busy={busy || overviewLoading}
                    details={details}
                    onCopySha={() => void copySha(details.oid)}
                    onReword={snapshot ? (message) => runMutation("Commit message updated", (repository) => gitcatApi.rewordCommit(repository.repository_id, details.oid, message, expectedState(snapshot))) : undefined}
                    onSelectFile={openCommitFile}
                    selectedPath={selectedPath}
                  />
                ) : (
                  <aside className="gc-details gc-details--loading"><Spinner label="Loading commit details" /> Select a commit</aside>
                )}
            </div>
          </main>

        </>
      )}

      <footer className="gc-statusbar">
        <span className={gitcatApi.runtime === "tauri" ? "gc-runtime gc-runtime--native" : "gc-runtime"}>
          {gitcatApi.runtime === "tauri" ? "Native Git" : "Browser demo"}
        </span>
        {snapshot ? <span>{snapshot.status.clean ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {snapshot.status.clean ? "Working tree clean" : `${snapshot.status.entries.length} changed`}</span> : null}
        {activeConflictCount ? <span className="gc-danger"><AlertTriangle size={12} /> {activeConflictCount} conflicts</span> : null}
        {snapshot?.status.ahead ? <span>↑ {snapshot.status.ahead} ahead</span> : null}
        {snapshot?.status.behind ? <span>↓ {snapshot.status.behind} behind</span> : null}
        <span className="gc-statusbar__spacer" />
        {activeRepository ? <span>{stashes.length} stashes</span> : null}
        {activeRepository ? <span>{activeRepository.info.object_format.toUpperCase()}</span> : null}
        <span className="gc-build-identity" title={`Build commit ${appMetadata.commit}`}>
          GitCat v{appMetadata.version} · {appMetadata.commit}
        </span>
      </footer>

      {settingsOpen ? (
        <SettingsDialog
          defaults={DEFAULT_SETTINGS}
          onClose={() => setSettingsOpen(false)}
          onSave={(settings) => { setPersisted((current) => ({ ...current, settings })); setSettingsOpen(false); }}
          settings={persisted.settings}
        />
      ) : null}
      {prompt && promptConfig ? <PromptDialog {...promptConfig} onClose={() => setPrompt(null)} onConfirm={submitPrompt} /> : null}
      {resetCommit && snapshot ? (
        <ResetDialog
          onClose={() => setResetCommit(null)}
          onConfirm={(mode: ResetMode) => {
            const commit = resetCommit;
            setResetCommit(null);
            void runMutation("Branch reset", (repository) => gitcatApi.resetCommit(repository.repository_id, commit.oid, mode, true, expectedState(snapshot)));
          }}
          shortOid={resetCommit.short_oid}
        />
      ) : null}
      {conflictEditor && snapshot ? (
        <ConflictResolverDialog
          branchName={currentBranch(snapshot)}
          busy={busy}
          details={conflictEditor}
          onClose={() => { if (!busy) setConflictEditor(null); }}
          onResolve={(resolution) => {
            const current = conflictEditor;
            void runMutation("Conflict resolved", (repository) => gitcatApi.resolveConflict(
              repository.repository_id,
              current.path,
              resolution,
              current.expected_state,
            )).then((success) => { if (success) setConflictEditor(null); });
          }}
          onSave={(text, lineEnding) => {
            const current = conflictEditor;
            void runMutation("Conflict result saved", (repository) => gitcatApi.saveConflictResult(
              repository.repository_id,
              current.path,
              text,
              lineEnding,
              current.expected_state,
            )).then((success) => { if (success) setConflictEditor(null); });
          }}
          operation={snapshot.operation_state}
        />
      ) : null}
      {commitMenu ? <ContextMenu actions={contextActions} onAction={executeCommitAction} onClose={() => setCommitMenu(null)} x={commitMenu.x} y={commitMenu.y} /> : null}
      {tabMenu ? <ContextMenu actions={tabContextActions} onAction={executeTabAction} onClose={() => setTabMenu(null)} x={tabMenu.x} y={tabMenu.y} /> : null}
      <ToastRegion onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} toasts={toasts} />
    </div>
  );
}

export default App;
