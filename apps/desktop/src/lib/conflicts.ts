import type { OperationSource, RepositoryOperationState } from "./types";

export interface ConflictSideLabels {
  ours: string;
  theirs: string;
  oursDescription: string;
  theirsDescription: string;
}

export function conflictOperationLabel(operation: RepositoryOperationState): string {
  switch (operation) {
    case "merge": return "merge";
    case "rebase": return "rebase";
    case "cherry_pick": return "cherry-pick";
    case "revert": return "revert";
    case "bisect": return "Git";
    case "normal": return "Git";
  }
}

export function operationTitle(operation: RepositoryOperationState): string {
  const label = conflictOperationLabel(operation);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function operationContinueLabel(operation: RepositoryOperationState): string {
  switch (operation) {
    case "merge": return "Commit Merge";
    case "rebase": return "Continue Rebase";
    case "cherry_pick": return "Continue Cherry-pick";
    case "revert": return "Continue Revert";
    case "bisect":
    case "normal": return "Continue";
  }
}

/** Present participle of the operation, for "Merging x into y". */
export function operationProgressiveLabel(operation: RepositoryOperationState): string {
  switch (operation) {
    case "merge": return "Merging";
    case "rebase": return "Rebasing";
    case "cherry_pick": return "Cherry-picking";
    case "revert": return "Reverting";
    case "bisect": return "Bisecting";
    case "normal": return "Applying";
  }
}

/** Headline shown while an operation is stopped on conflicts. */
export function conflictHeadline(operation: RepositoryOperationState): string {
  switch (operation) {
    case "merge": return "Merge conflicts detected";
    case "rebase": return "Rebase conflicts detected";
    case "cherry_pick": return "Cherry-pick conflicts detected";
    case "revert": return "Revert conflicts detected";
    case "bisect":
    case "normal": return "Conflicts detected";
  }
}

export function conflictSideLabels(
  operation: RepositoryOperationState,
  branchName: string,
): ConflictSideLabels {
  switch (operation) {
    case "merge":
      return {
        ours: `Current branch (${branchName})`,
        theirs: "Incoming branch",
        oursDescription: "Git index stage 2: the branch currently checked out.",
        theirsDescription: "Git index stage 3: the branch being merged.",
      };
    case "rebase":
      return {
        ours: "Rebase target",
        theirs: "Rebased commit",
        oursDescription: "Git index stage 2: the branch onto which commits are being replayed.",
        theirsDescription: "Git index stage 3: the commit currently being replayed.",
      };
    case "cherry_pick":
      return {
        ours: `Current branch (${branchName})`,
        theirs: "Cherry-picked commit",
        oursDescription: "Git index stage 2: the current branch before this cherry-pick.",
        theirsDescription: "Git index stage 3: the commit being cherry-picked.",
      };
    case "revert":
      return {
        ours: `Current branch (${branchName})`,
        theirs: "Revert result",
        oursDescription: "Git index stage 2: the current branch before applying the reverse change.",
        theirsDescription: "Git index stage 3: the reverse change Git is trying to apply.",
      };
    case "normal":
    case "bisect":
      return {
        ours: "Ours (index stage 2)",
        theirs: "Theirs (index stage 3)",
        oursDescription: "Git index stage 2. No active operation provides a safer branch label.",
        theirsDescription: "Git index stage 3. No active operation provides a safer branch label.",
      };
  }
}

/**
 * The one-line notice the graph shows on the working-copy row while an
 * operation is stopped on conflicts. It names both sides, because the row it
 * sits on is the only place the interrupted operation is still visible.
 */
export function conflictNoticeMessage(
  operation: RepositoryOperationState,
  source: OperationSource | null,
  branchName: string,
): string {
  const target = source?.onto ?? branchName;
  const preposition = source?.onto ? "onto" : "into";
  const incoming = source ? `${source.incoming} ` : "";
  return `A file conflict was found when ${operationProgressiveLabel(operation).toLowerCase()} ${incoming}${preposition} ${target}`;
}
