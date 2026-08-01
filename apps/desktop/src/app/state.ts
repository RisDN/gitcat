import type { gitcatApi } from "../lib/api";
import type { BranchScope } from "../components/ref-sidebar";
import type { TabView } from "../components/top-tabs";
import type { BranchInfo, CommitSummary, RepositoryInfo } from "../lib/types";

export interface RuntimeRepository {
    repository_id: string;
    info: RepositoryInfo;
}

export type PromptState =
    | { kind: "create_group"; tabId?: string }
    | { kind: "rename_group"; groupId: string; current: string }
    | { kind: "alias_tab"; tabId: string; current: string }
    | { kind: "create_branch"; startOid: string }
    | { kind: "rename_branch"; branch: BranchInfo }
    | { kind: "create_tag"; oid: string }
    | null;

export type ConfirmState =
    | { kind: "delete_branch"; name: string; force: boolean }
    | { kind: "delete_stash"; index: number; selector: string }
    | null;

export interface CommitMenuState {
    x: number;
    y: number;
    commit: CommitSummary;
}

export interface TabMenuState {
    x: number;
    y: number;
    tab: TabView;
    groupId: string | null;
}

export interface BranchMenuState {
    x: number;
    y: number;
    branch: BranchInfo;
    scope: BranchScope;
}

export type RunMutation = (
    title: string,
    operation: (repository: RuntimeRepository) => Promise<unknown>,
    options?: {
        silent?: boolean;
        optimistic?: () => (() => void) | undefined;
        onError?: (error: unknown) => boolean;
    },
) => Promise<boolean>;

export type CommitDetailsPanel = Awaited<ReturnType<typeof gitcatApi.commitDetails>>;
