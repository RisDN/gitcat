import { TriangleAlert } from "lucide-react";

import { conflictHeadline, operationProgressiveLabel } from "../../lib/conflicts";
import type { OperationSource, RepositoryOperationState } from "../../lib/types";
import { Badge } from "../ui";

// Replaces the working tree header while an operation is stopped on conflicts:
// it names both sides of the operation, and it drops "discard all changes",
// which during a merge would throw away the resolutions along with them.
export function ConflictHeader({
  branchName,
  operation,
  source,
  stashCount,
}: {
  branchName: string;
  operation: RepositoryOperationState;
  source: OperationSource | null;
  stashCount: number;
}) {
  const target = source?.onto ?? branchName;
  const preposition = source?.onto ? "onto" : "into";

  return (
    <header className="flex min-h-14.25 flex-[0_0_auto] flex-col justify-center gap-1 border-b border-border px-2.75 py-2">
      <div className="flex items-center gap-1.5">
        <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[12px] font-[650] text-warning">
          <TriangleAlert aria-hidden="true" size={13} />
          <span className="min-w-0 truncate">{conflictHeadline(operation)}</span>
        </span>
        {stashCount ? (
          <Badge className="shrink-0 whitespace-nowrap" tone="muted">{stashCount} stashed</Badge>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.25 text-[11px] text-muted">
        <span>{operationProgressiveLabel(operation)}</span>
        {source ? (
          <>
            <Badge className="min-w-0 max-w-45 overflow-hidden text-ellipsis whitespace-nowrap" tone="accent">
              {source.incoming}
            </Badge>
            <span>{preposition}</span>
          </>
        ) : null}
        <Badge className="min-w-0 max-w-45 overflow-hidden text-ellipsis whitespace-nowrap" tone="accent">
          {target}
        </Badge>
      </div>
    </header>
  );
}
