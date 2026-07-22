import type { RepositoryOperationState } from "./types";

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
