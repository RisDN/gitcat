import { AlertTriangle, GitMerge } from "lucide-react";

import { operationContinueLabel, operationTitle } from "../lib/conflicts";
import type { OperationProgress, RepositoryOperationState } from "../lib/types";
import { Button } from "./ui";

interface OperationBannerProps {
  busy: boolean;
  conflictCount: number;
  operation: RepositoryOperationState;
  progress: OperationProgress | null;
  onAbort: () => void;
  onContinue: () => void;
  onReview: () => void;
  onSkip: () => void;
}

export function OperationBanner({
  busy,
  conflictCount,
  operation,
  progress,
  onAbort,
  onContinue,
  onReview,
  onSkip,
}: OperationBannerProps) {
  if (operation === "normal") return null;

  const title = operationTitle(operation);

  if (operation === "bisect") {
    return (
      <div
        className="z-15 flex min-h-10.25 flex-[0_0_41px] items-center gap-2.5 border-b border-[color-mix(in_srgb,var(--gc-warning)_37%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-warning)_9%,var(--gc-surface))] px-3.5 py-1.25 text-warning"
        role="status"
      >
        <AlertTriangle aria-hidden="true" className="shrink-0" size={16} />
        <span className="flex-1 text-[color-mix(in_srgb,var(--gc-warning)_68%,var(--gc-text))]">
          <strong>bisect in progress.</strong>{" "}
          Complete or abort this bisect from Git before running another operation.
        </span>
      </div>
    );
  }

  return (
    <div
      aria-label={`${title} in progress`}
      className="z-15 flex min-h-11 flex-[0_0_44px] items-center gap-2.5 border-b border-[color-mix(in_srgb,var(--gc-warning)_37%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-warning)_9%,var(--gc-surface))] px-3.5 py-1.5"
      role="status"
    >
      <GitMerge aria-hidden="true" className="shrink-0 text-warning" size={16} />

      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <strong className="shrink-0 text-[12px] text-warning">
          {title} in progress
          {progress ? ` — ${progress.current} of ${progress.total}` : ""}
        </strong>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
          {conflictCount
            ? `${conflictCount} conflicted file${conflictCount === 1 ? "" : "s"} left to resolve.`
            : progress?.subject ?? "Stopped and waiting for your decision."}
        </span>
      </span>

      <div className="flex shrink-0 items-center gap-1.5">
        {conflictCount ? (
          <Button compact disabled={busy} onClick={onReview} tone="accent">
            Resolve Conflicts
          </Button>
        ) : (
          <Button compact disabled={busy} onClick={onContinue} tone="accent">
            {operationContinueLabel(operation)}
          </Button>
        )}
        {operation === "merge" ? null : (
          <Button compact disabled={busy} onClick={onSkip}>Skip Commit</Button>
        )}
        <Button compact disabled={busy} onClick={onAbort} tone="danger">
          Abort {title}
        </Button>
      </div>
    </div>
  );
}
