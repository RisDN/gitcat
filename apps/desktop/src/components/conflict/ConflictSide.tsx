import { FileQuestion } from "lucide-react";

import type { ConflictIndexVersion } from "../../lib/types";
import { Button } from "../ui";
import { Panel, PanelHeader, contentMessage } from "./Panel";

// Keeps trailing newlines attached so appending a line preserves line breaks.
function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? (text ? [text] : []);
}

export function ConflictSide({
  label,
  description,
  version,
  busy,
  canCompose,
  onAppend,
  onTake,
  onUseAll,
}: {
  label: string;
  description: string;
  version?: ConflictIndexVersion;
  busy: boolean;
  canCompose: boolean;
  onAppend: (line: string) => void;
  onTake: () => void;
  onUseAll: (text: string) => void;
}) {
  const text = version?.content.kind === "text" ? version.content.text : undefined;
  return (
    <Panel className="flex min-h-61.5 flex-col">
      <PanelHeader className="flex min-h-13.75 items-start justify-between gap-2.25 px-2.5 py-2.25">
        <div className="flex min-w-0 flex-col gap-0.75">
          <strong className="text-[11px]">{label}</strong>
          <small className="text-[9px] leading-[1.35] text-muted">{description}</small>
        </div>
        {version ? <code className="shrink-0 text-[9px] text-muted">{version.mode} · {version.oid.slice(0, 7)}</code> : null}
      </PanelHeader>
      {text !== undefined ? (
        <div aria-label={`${label} lines`} className="max-h-57.5 min-h-32.5 flex-1 overflow-auto py-1">
          {splitLines(text).map((line, index) => (
            <button
              aria-label={`Append line ${index + 1} from ${label}`}
              className="grid min-h-5.5 w-full cursor-copy grid-cols-[38px_minmax(0,1fr)] bg-transparent text-left text-foreground hover:bg-accent/9"
              disabled={busy || !canCompose}
              key={`${index}:${line}`}
              onClick={() => onAppend(line)}
              title="Append this line at the cursor in Result"
              type="button"
            >
              <span className="select-none border-r border-border/75 px-1.75 py-0.75 text-right font-mono text-[9px] leading-[1.6] text-muted">
                {index + 1}
              </span>
              <code className="min-w-0 overflow-hidden text-ellipsis whitespace-pre px-2 py-0.75 font-mono text-[10px] leading-[1.6]">
                {line.replace(/\r?\n$/, "") || " "}
              </code>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex min-h-37.5 flex-1 items-center justify-center gap-1.75 p-3.5 text-center text-[10px] text-muted">
          <FileQuestion aria-hidden="true" size={18} />
          {contentMessage(version?.content ?? { kind: "missing" })}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-1.5 p-1.75">
        <Button compact disabled={busy || !version} onClick={onTake}>Take {label} &amp; stage</Button>
        <Button compact disabled={busy || !canCompose || text === undefined} onClick={() => text !== undefined && onUseAll(text)}>
          Use in Result
        </Button>
      </div>
    </Panel>
  );
}
