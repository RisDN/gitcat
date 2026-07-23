import { GitMerge } from "lucide-react";

import type { ConflictIndexVersion, RepositoryOperationState } from "../../lib/types";
import { contentMessage } from "./Panel";

export function ConflictSummary({
  base,
  operation,
}: {
  base?: ConflictIndexVersion;
  operation: RepositoryOperationState;
}) {
  const baseText = base?.content.kind === "text" ? base.content.text : undefined;
  return (
    <div className="flex min-w-0 items-center gap-2.25 rounded-[5px] border border-border bg-background/58 px-2.75 py-2.25">
      <GitMerge aria-hidden="true" className="shrink-0 text-danger" size={17} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <strong className="text-[11px] capitalize">{operation.replace("_", " ")} conflict</strong>
        <small className="text-[9px] text-muted">Side names follow Git index stages, including rebase semantics.</small>
      </span>
      {base ? (
        <details className="relative ml-auto">
          <summary className="cursor-pointer text-[10px] text-accent">View base</summary>
          <div className="absolute right-0 top-6 z-5 max-h-55 w-[min(520px,70vw)] overflow-auto rounded-[5px] border border-border bg-panel p-2.25 shadow-panel">
            <code className="text-[9px] text-muted">{base.mode} · {base.oid.slice(0, 7)}</code>
            {baseText === undefined
              ? <p className="mt-1.75">{contentMessage(base.content)}</p>
              : <pre className="mt-1.75 whitespace-pre-wrap">{baseText}</pre>}
          </div>
        </details>
      ) : <small className="ml-auto text-[9px] text-muted">No common base content</small>}
    </div>
  );
}
