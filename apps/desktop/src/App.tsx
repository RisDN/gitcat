import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  GitBranchPlus,
  GitCommitHorizontal,
  GitPullRequestArrow,
  LoaderCircle,
  RotateCcw,
  Tag,
  Trash2,
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
import { CommitGraph, type CommitContextMenuRequest } from "./components/CommitGraph";
import { ContextMenu, type ContextAction } from "./components/ContextMenu";
import { DiffViewer, type DiffViewMode } from "./components/DiffViewer";
import { Button, IconButton, Spinner } from "./components/Primitives";
import { PromptDialog } from "./components/PromptDialog";
import { RefSidebar } from "./components/RefSidebar";
import { ResetDialog } from "./components/ResetDialog";
import { SearchBar } from "./components/SearchBar";
import { SettingsDialog } from "./components/SettingsDialog";
import { ToastRegion, type ToastMessage } from "./components/ToastRegion";
import { Toolbar } from "./components/Toolbar";
import { TopTabs, type TabGroupView } from "./components/TopTabs";
import { WelcomeView } from "./components/WelcomeView";
import { WorktreePanel } from "./components/WorktreePanel";
import { getApiError, gitcatApi } from "./lib/api";
import type {
  AppSettings,
  BranchInfo,
  ChangedFile,
  CommitActionAvailability,
  CommitSummary,
  ContinueOperation,
  DiffRequest,
  ExpectedState,
  FileDiff,
  HistoryPage,
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
  workspace: { version: 1, groups: [], active_tab_id: null },
};

interface RuntimeRepository {
  repository_id: string;
  info: RepositoryInfo;
}

type PromptState =
  | { kind: "create_group" }
  | { kind: "rename_group"; groupId: string; current: string }
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

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
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
  const [centerView, setCenterView] = useState<"graph" | "diff">("graph");
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOids, setSearchOids] = useState<string[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchBusy, setSearchBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [resetCommit, setResetCommit] = useState<CommitSummary | null>(null);
  const [commitMenu, setCommitMenu] = useState<CommitMenuState | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(252);
  const [detailsWidth, setDetailsWidth] = useState(370);
  const [overviewRepositoryId, setOverviewRepositoryId] = useState<string | null>(null);
  const activeRepositoryIdRef = useRef<string | null>(null);
  const overviewLoadSequence = useRef(0);
  const detailsLoadSequence = useRef(0);
  const diffLoadSequence = useRef(0);
  const historyLoadSequence = useRef(0);
  const searchSequence = useRef(0);

  const activeTabId = persisted.workspace.active_tab_id;
  const activeRepository = activeTabId ? runtime[activeTabId] : undefined;

  useEffect(() => {
    activeRepositoryIdRef.current = activeRepository?.repository_id ?? null;
  }, [activeRepository]);

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
    const tabs = state.workspace.groups.flatMap((group) => group.tabs);
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
        const state = await gitcatApi.loadPersistedState();
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

  const loadOverview = useCallback(async (repository: RuntimeRepository, preserveSelection = true) => {
    const sequence = ++overviewLoadSequence.current;
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
  }, [persisted.settings.history_page_size]);

  useEffect(() => {
    ++overviewLoadSequence.current;
    ++detailsLoadSequence.current;
    ++diffLoadSequence.current;
    ++historyLoadSequence.current;
    setOverviewRepositoryId(null);
    setSnapshot(null);
    setHistory(null);
    setDetails(null);
    setDiff(null);
    setDiffLoading(false);
    setCenterView("graph");
    if (!activeRepository) return;
    setBusy(true);
    void loadOverview(activeRepository, false)
      .catch((error) => showError("Repository could not be loaded", error))
      .finally(() => setBusy(false));
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
          setSelectedOid(result.hits[0].oid);
          setWipSelected(false);
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

  const runMutation = useCallback(async (
    title: string,
    operation: (repository: RuntimeRepository) => Promise<unknown>,
  ): Promise<boolean> => {
    if (!activeRepository || busy) return false;
    setBusy(true);
    try {
      await operation(activeRepository);
      await loadOverview(activeRepository, true);
      addToast({ tone: "success", title });
      return true;
    } catch (error) {
      showError(`${title} failed`, error);
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeRepository, addToast, busy, loadOverview, showError]);

  const chooseRepository = useCallback(async () => {
    try {
      let path = "C:\\Users\\demo\\aurora-engine";
      if (gitcatApi.runtime === "tauri") {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false, title: "Open Git repository" });
        if (!selected || Array.isArray(selected)) return;
        path = selected;
      }
      const existing = persisted.workspace.groups.flatMap((group) => group.tabs).find((tab) => tab.repository_path === path);
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
        const groups = current.workspace.groups.length
          ? current.workspace.groups.map((group, index) => index === 0 ? { ...group, tabs: [...group.tabs, { ...tab, order: group.tabs.length }] } : group)
          : [{ id: makeId("group"), name: "Repositories", collapsed: false, order: 0, tabs: [tab] }];
        return { ...current, workspace: { ...current.workspace, groups, active_tab_id: tab.id } };
      });
    } catch (error) {
      showError("Repository could not be opened", error);
    } finally {
      setBusy(false);
    }
  }, [persisted.workspace.groups, showError]);

  const closeTab = useCallback((tabId: string) => {
    const repository = runtime[tabId];
    if (repository) void gitcatApi.closeRepository(repository.repository_id).catch(() => undefined);
    setRuntime((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setPersisted((current) => {
      const groups = current.workspace.groups.map((group) => ({ ...group, tabs: group.tabs.filter((tab) => tab.id !== tabId) }));
      const remaining = groups.flatMap((group) => group.tabs);
      const active = current.workspace.active_tab_id === tabId ? remaining[0]?.id ?? null : current.workspace.active_tab_id;
      return { ...current, workspace: { ...current.workspace, groups, active_tab_id: active } };
    });
  }, [runtime]);

  const selectCommit = useCallback((commit: CommitSummary) => {
    setSelectedOid(commit.oid);
    setWipSelected(false);
    setDetails(null);
    setCommitActions([]);
    setSelectedPath(undefined);
    setDiff(null);
    setCenterView("graph");
  }, []);

  const selectWip = useCallback(() => {
    setWipSelected(true);
    setSelectedOid(null);
    setDetails(null);
    setCommitActions([]);
    setSelectedPath(undefined);
    setDiff(null);
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
    void loadDiff({
      target: { kind: "commit", oid: selectedOid, parent_index: 0 },
      path: file.new_path,
      context_lines: persisted.settings.diff_context_lines,
      ignore_whitespace: false,
      max_bytes: persisted.settings.diff_max_bytes,
    });
  }, [loadDiff, persisted.settings.diff_context_lines, persisted.settings.diff_max_bytes, selectedOid]);

  const openWorktreeDiff = useCallback((entry: StatusEntry, staged: boolean) => {
    void loadDiff({
      target: { kind: staged ? "staged" : "worktree" },
      path: entry.path,
      context_lines: persisted.settings.diff_context_lines,
      ignore_whitespace: false,
      max_bytes: persisted.settings.diff_max_bytes,
    });
  }, [loadDiff, persisted.settings.diff_context_lines, persisted.settings.diff_max_bytes]);

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
    setSearchIndex(next);
    setSelectedOid(searchOids[next]);
    setWipSelected(false);
    setDetails(null);
    setCommitActions([]);
  }, [searchIndex, searchOids]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const control = event.ctrlKey || event.metaKey;
      if (control && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        setCenterView("graph");
      } else if (control && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void chooseRepository();
      } else if (control && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (event.key === "F5" && activeRepository) {
        event.preventDefault();
        void loadOverview(activeRepository, true).catch((error) => showError("Refresh failed", error));
      } else if (event.key === "Escape") {
        setCommitMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRepository, chooseRepository, loadOverview, showError]);

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

  const submitPrompt = useCallback((value: string) => {
    if (!prompt) return;
    const currentPrompt = prompt;
    setPrompt(null);
    switch (currentPrompt.kind) {
      case "create_group":
        setPersisted((current) => ({
          ...current,
          workspace: {
            ...current.workspace,
            groups: [...current.workspace.groups, { id: makeId("group"), name: value, collapsed: false, order: current.workspace.groups.length, tabs: [] }],
          },
        }));
        break;
      case "rename_group":
        setPersisted((current) => ({ ...current, workspace: { ...current.workspace, groups: current.workspace.groups.map((group) => group.id === currentPrompt.groupId ? { ...group, name: value } : group) } }));
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
      case "create_branch": return { title: "Create branch", label: "Branch name", placeholder: "feature/short-name", confirmLabel: "Create and checkout" };
      case "remote_branch": return { title: "Check out remote branch", label: "Local branch name", initialValue: prompt.branch.name.split("/").slice(1).join("/"), confirmLabel: "Create and checkout" };
      case "rename_branch": return { title: "Rename branch", label: "New branch name", initialValue: prompt.branch.name, confirmLabel: "Rename" };
      case "create_tag": return { title: "Create tag", label: "Tag name", placeholder: "v1.0.0", confirmLabel: "Create tag" };
    }
  }, [prompt]);

  const tabGroups = useMemo<TabGroupView[]>(() => persisted.workspace.groups.map((group) => ({
    id: group.id,
    name: group.name,
    collapsed: group.collapsed,
    tabs: group.tabs.map((tab) => ({
      id: tab.id,
      label: tab.display_name,
      path: tab.repository_path,
      dirty: tab.id === activeTabId && snapshot ? !snapshot.status.clean : false,
      unavailable: !runtime[tab.id],
    })),
  })), [activeTabId, persisted.workspace.groups, runtime, snapshot]);

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
  const currentHeadOid = snapshot?.head.kind === "unborn" ? null : snapshot?.head.oid ?? null;
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
        groups={tabGroups}
        onClose={closeTab}
        onCreateGroup={() => setPrompt({ kind: "create_group" })}
        onMoveTab={(tabId, groupId) => setPersisted((current) => {
          let moved: RepositoryTab | undefined;
          const without = current.workspace.groups.map((group) => ({ ...group, tabs: group.tabs.filter((tab) => {
            if (tab.id === tabId) { moved = tab; return false; }
            return true;
          }) }));
          const groups = without.map((group) => group.id === groupId && moved ? { ...group, collapsed: false, tabs: [...group.tabs, { ...moved, order: group.tabs.length }] } : group);
          return { ...current, workspace: { ...current.workspace, groups } };
        })}
        onOpen={() => void chooseRepository()}
        onRenameGroup={(groupId) => {
          const group = persisted.workspace.groups.find((item) => item.id === groupId);
          if (group) setPrompt({ kind: "rename_group", groupId, current: group.name });
        }}
        onSelect={(tabId) => setPersisted((current) => ({ ...current, workspace: { ...current.workspace, active_tab_id: tabId } }))}
        onToggleGroup={(groupId) => setPersisted((current) => ({ ...current, workspace: { ...current.workspace, groups: current.workspace.groups.map((group) => group.id === groupId ? { ...group, collapsed: !group.collapsed } : group) } }))}
      />

      {!activeRepository ? <WelcomeView onOpen={() => void chooseRepository()} /> : (
        <>
          <Toolbar
            branchName={currentBranch(snapshot)}
            busy={busy}
            onCreateBranch={() => {
              if (currentHeadOid) setPrompt({ kind: "create_branch", startOid: currentHeadOid });
              else addToast({ tone: "info", title: "Create the first commit before branching" });
            }}
            onFetch={() => void runMutation("Fetch complete", (repository) => gitcatApi.fetch(repository.repository_id, { remote: null, prune: persisted.settings.auto_prune, tags: false }))}
            onPull={(mode) => void runMutation("Pull complete", (repository) => gitcatApi.pull(repository.repository_id, { remote: null, branch: null, mode, prune: persisted.settings.auto_prune, autostash: false }))}
            onPullModeChange={(mode) => setPersisted((current) => ({ ...current, settings: { ...current.settings, default_pull_mode: mode } }))}
            onPush={() => void runMutation("Push complete", (repository) => gitcatApi.push(repository.repository_id, { remote: null, branch: null, set_upstream: false }))}
            onRefresh={() => void loadOverview(activeRepository, true).catch((error) => showError("Refresh failed", error))}
            onSearch={() => { setSearchOpen(true); setCenterView("graph"); }}
            onSettings={() => setSettingsOpen(true)}
            onStash={() => void runMutation("Changes stashed", (repository) => gitcatApi.stashPush(repository.repository_id, null, true))}
            operation={snapshot?.operation_state ?? "normal"}
            pullMode={persisted.settings.default_pull_mode}
            repositoryName={activeRepository.info.name}
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
                  <Button compact onClick={() => void runMutation("Operation continued", (repository) => gitcatApi.continueOperation(repository.repository_id, pendingOperation))}>Continue</Button>
                  <Button compact onClick={() => void runMutation("Operation aborted", (repository) => gitcatApi.abortOperation(repository.repository_id, pendingOperation))} tone="danger">Abort</Button>
                </>
              ) : null}
            </div>
          ) : null}

          <main
            className="gc-workspace"
            style={{ gridTemplateColumns: `${sidebarWidth}px 5px minmax(360px, 1fr) 5px ${detailsWidth}px` }}
          >
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
            <div aria-hidden="true" className="gc-resizer gc-resizer--left" onPointerDown={(event) => beginResize("left", event)} />

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
                <div className="gc-graph-scroll">
                  {snapshot && !snapshot.status.clean ? (
                    <button className={`gc-wip-row ${wipSelected ? "gc-wip-row--selected" : ""}`} onClick={selectWip} type="button">
                      <span className="gc-wip-row__rail"><i /></span>
                      <span><strong>Working tree</strong><small>{snapshot.status.entries.length} uncommitted changes</small></span>
                      <b>{snapshot.status.entries.length}</b>
                    </button>
                  ) : null}
                  {history ? (
                    <CommitGraph
                      commits={history.commits}
                      onCommitContextMenu={(request: CommitContextMenuRequest) => setCommitMenu({ x: request.clientX, y: request.clientY, commit: request.commit })}
                      onSelect={selectCommit}
                      searchMatchOids={graphMatches}
                      selectedOid={selectedOid}
                    />
                  ) : <div className="gc-loading-panel"><Spinner label="Loading history" /> Loading history…</div>}
                  {history?.has_more && history.next_cursor ? (
                    <Button
                      className="gc-load-more"
                      disabled={busy}
                      onClick={() => {
                        if (!activeRepository) return;
                        const repositoryId = activeRepository.repository_id;
                        const sequence = ++historyLoadSequence.current;
                        setBusy(true);
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
                          if (sequence === historyLoadSequence.current) setBusy(false);
                        });
                      }}
                    >Load older commits</Button>
                  ) : null}
                </div>
              )}
            </section>

            <div aria-hidden="true" className="gc-resizer gc-resizer--right" onPointerDown={(event) => beginResize("right", event)} />
            {wipSelected && snapshot ? (
              <WorktreePanel
                busy={busy}
                onCommit={(message, amend, signoff) => runMutation(amend ? "Commit amended" : "Commit created", (repository) => gitcatApi.createCommit(repository.repository_id, { message, amend, signoff }))}
                onOpenDiff={openWorktreeDiff}
                onStage={(paths) => void runMutation("Files staged", (repository) => gitcatApi.stagePaths(repository.repository_id, paths))}
                onUnstage={(paths) => void runMutation("Files unstaged", (repository) => gitcatApi.unstagePaths(repository.repository_id, paths))}
                status={snapshot.status}
              />
            ) : details ? (
              <CommitDetails details={details} onCopySha={() => void copySha(details.oid)} onSelectFile={openCommitFile} selectedPath={selectedPath} />
            ) : (
              <aside className="gc-details gc-details--loading"><Spinner label="Loading commit details" /> Select a commit</aside>
            )}
          </main>

          <footer className="gc-statusbar">
            <span className={gitcatApi.runtime === "tauri" ? "gc-runtime gc-runtime--native" : "gc-runtime"}>
              {gitcatApi.runtime === "tauri" ? "Native Git" : "Browser demo"}
            </span>
            {snapshot ? <span>{snapshot.status.clean ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {snapshot.status.clean ? "Working tree clean" : `${snapshot.status.entries.length} changed`}</span> : null}
            {snapshot?.status.ahead ? <span>↑ {snapshot.status.ahead} ahead</span> : null}
            {snapshot?.status.behind ? <span>↓ {snapshot.status.behind} behind</span> : null}
            <span className="gc-statusbar__spacer" />
            <span>{stashes.length} stashes</span>
            <span>{activeRepository.info.object_format.toUpperCase()}</span>
          </footer>
        </>
      )}

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
      {commitMenu ? <ContextMenu actions={contextActions} onAction={executeCommitAction} onClose={() => setCommitMenu(null)} x={commitMenu.x} y={commitMenu.y} /> : null}
      <ToastRegion onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} toasts={toasts} />
    </div>
  );
}

export default App;
