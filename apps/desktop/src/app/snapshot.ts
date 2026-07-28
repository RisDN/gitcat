import { getApiError } from "../lib/api";
import type { ContinueOperation, ExpectedState, MutationResult, RepositorySnapshot } from "../lib/types";

export function isMutationResult(value: unknown): value is MutationResult {
    if (typeof value !== "object" || value === null) return false;
    return Array.isArray((value as Partial<MutationResult>).conflicts)
        && typeof (value as Partial<MutationResult>).needs_user_action === "boolean";
}

export function isNotFullyMerged(error: unknown): boolean {
    const apiError = getApiError(error);
    return /not fully merged/i.test(`${apiError.message} ${apiError.details ?? ""}`);
}

export function expectedState(snapshot: RepositorySnapshot): ExpectedState {
    return {
        generation: snapshot.generation,
        head_oid: snapshot.head.kind === "unborn" ? null : snapshot.head.oid,
    };
}

export function defaultConflictPreflightTarget(snapshot: RepositorySnapshot | null): string | null {
    return snapshot?.default_conflict_target ?? null;
}

export function continuableOperation(
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
