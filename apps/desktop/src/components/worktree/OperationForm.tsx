import { GitMerge } from "lucide-react";

import { operationContinueLabel, operationTitle } from "../../lib/conflicts";
import type { OperationProgress, RepositoryOperationState } from "../../lib/types";
import { Button } from "../ui";

export function OperationForm({
  busy,
  conflictCount,
  operation,
  progress,
  onAbort,
  onContinue,
  onSkip,
}: {
  busy: boolean;
  conflictCount: number;
  operation: RepositoryOperationState;
  progress: OperationProgress | null;
  onAbort: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const title = operationTitle(operation);

  return (
    <div className="flex min-h-0 flex-[0_0_auto] flex-col gap-2 p-2.75">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
        <GitMerge aria-hidden="true" size={12} /> {title} in progress
      </span>
      <div className="grid gap-1 rounded-[5px] border border-border bg-background px-2.25 py-1.75">
        {progress ? (
          <strong className="text-[11px] text-warning">
            {title === "Rebase" ? "Rebasing" : "Applying"} commit {progress.current} out of {progress.total}
          </strong>
        ) : null}
        <span className="truncate text-[12px] text-foreground">
          {progress?.subject ?? `${title} stopped and needs your decision.`}
        </span>
        <small className="text-[11px] text-muted">
          {conflictCount
            ? `${conflictCount} conflicted file${conflictCount === 1 ? "" : "s"} left to resolve.`
            : "All conflicts resolved — continue to apply this commit."}
        </small>
      </div>
      <Button disabled={busy || conflictCount > 0} onClick={onContinue} tone="accent">
        {operationContinueLabel(operation)}
      </Button>
      <div className="flex gap-1.75">
        {operation === "merge" ? null : (
          <Button className="flex-1" compact disabled={busy} onClick={onSkip}>Skip Commit</Button>
        )}
        <Button className="flex-1" compact disabled={busy} onClick={onAbort} tone="danger">
          Abort {title}
        </Button>
      </div>
    </div>
  );
}
