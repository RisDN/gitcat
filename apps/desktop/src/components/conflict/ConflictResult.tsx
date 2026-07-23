import { AlertTriangle, Braces } from "lucide-react";
import type { RefObject } from "react";

import type { ConflictFileDetails, ConflictLineEndingPolicy } from "../../lib/types";
import { TextArea } from "../ui";
import { Panel, PanelHeader, contentMessage } from "./Panel";

export function ConflictResult({
  busy,
  editable,
  lineEnding,
  mixedNeedsChoice,
  result,
  resultContent,
  resultRef,
  onLineEndingChange,
  onResultChange,
}: {
  busy: boolean;
  editable: boolean;
  lineEnding: ConflictLineEndingPolicy;
  mixedNeedsChoice: boolean;
  result: string;
  resultContent: ConflictFileDetails["result"];
  resultRef: RefObject<HTMLTextAreaElement | null>;
  onLineEndingChange: (policy: ConflictLineEndingPolicy) => void;
  onResultChange: (text: string) => void;
}) {
  return (
    <Panel>
      <PanelHeader className="flex h-9 items-center justify-between px-2.5">
        <span className="inline-flex items-center gap-1.5"><Braces aria-hidden="true" size={15} /><strong>Result</strong></span>
        <small className="text-[9px] text-muted">
          {result.length.toLocaleString()} characters · {resultContent.line_ending?.replace("cr_lf", "CRLF").toUpperCase() ?? "new file"}
        </small>
      </PanelHeader>
      {resultContent.line_ending === "mixed" ? (
        <div
          className="flex min-h-9.5 items-center justify-between gap-2.5 border-b border-border bg-warning/8 px-2.5 py-1.5 text-[10px] text-warning"
          role={mixedNeedsChoice ? "alert" : undefined}
        >
          <span>Mixed line endings detected. An edited result needs an explicit normalization choice.</span>
          <select
            aria-label="Result line ending policy"
            className="min-w-51.25 rounded border border-border bg-panel px-1.75 py-1.25 text-foreground"
            disabled={busy}
            onChange={(event) => onLineEndingChange(event.target.value as ConflictLineEndingPolicy)}
            value={lineEnding}
          >
            <option value="preserve">Preserve (unchanged result only)</option>
            <option value="lf">Normalize to LF</option>
            <option value="cr_lf">Normalize to CRLF</option>
          </select>
        </div>
      ) : null}
      {editable ? (
        <TextArea
          aria-label="Resolved file content"
          className="block min-h-52.5 w-full resize-y whitespace-pre border-0 bg-background px-3 py-2.5 font-mono text-[10px] leading-[1.6] text-foreground outline-0 tab-2 focus:shadow-[inset_0_0_0_1px_var(--gc-accent)]"
          disabled={busy}
          onChange={(event) => onResultChange(event.target.value)}
          ref={resultRef}
          spellCheck={false}
          value={result}
        />
      ) : (
        <div className="flex min-h-37.5 items-center justify-center gap-2.25 p-4 text-warning">
          <AlertTriangle aria-hidden="true" size={18} />
          <span className="flex flex-col gap-0.75 text-[10px] text-muted">
            <strong className="text-warning">Built-in text editing unavailable</strong>
            {contentMessage(resultContent)}
          </span>
        </div>
      )}
    </Panel>
  );
}
