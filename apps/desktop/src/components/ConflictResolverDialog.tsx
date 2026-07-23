import { AlertTriangle, Braces, FileQuestion, GitMerge, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { conflictSideLabels } from "../lib/conflicts";
import type {
  ConflictFileContent,
  ConflictFileDetails,
  ConflictIndexVersion,
  ConflictLineEndingPolicy,
  ConflictResolution,
  RepositoryOperationState,
} from "../lib/types";
import { Button, Modal, TextArea } from "./Primitives";

interface ConflictResolverDialogProps {
  branchName: string;
  busy: boolean;
  details: ConflictFileDetails;
  operation: RepositoryOperationState;
  onClose: () => void;
  onResolve: (resolution: ConflictResolution) => void;
  onSave: (text: string, lineEnding: ConflictLineEndingPolicy) => void;
}

function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? (text ? [text] : []);
}

function contentMessage(content: ConflictFileContent): string {
  switch (content.kind) {
    case "missing": return "File does not exist on this side.";
    case "binary": return `Binary content${content.size === undefined ? "" : ` · ${content.size} bytes`}.`;
    case "too_large": return `Content is too large for the built-in editor${content.size === undefined ? "" : ` · ${content.size} bytes`}.`;
    case "text": return "Text content unavailable.";
  }
}

function ConflictSide({
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
    <section className="gc-conflict-side">
      <header>
        <div>
          <strong>{label}</strong>
          <small>{description}</small>
        </div>
        {version ? <code>{version.mode} · {version.oid.slice(0, 7)}</code> : null}
      </header>
      {text !== undefined ? (
        <div aria-label={`${label} lines`} className="gc-conflict-side__lines">
          {splitLines(text).map((line, index) => (
            <button
              aria-label={`Append line ${index + 1} from ${label}`}
              disabled={busy || !canCompose}
              key={`${index}:${line}`}
              onClick={() => onAppend(line)}
              title="Append this line at the cursor in Result"
              type="button"
            >
              <span>{index + 1}</span>
              <code>{line.replace(/\r?\n$/, "") || " "}</code>
            </button>
          ))}
        </div>
      ) : (
        <div className="gc-conflict-side__unavailable">
          <FileQuestion aria-hidden="true" size={18} />
          {contentMessage(version?.content ?? { kind: "missing" })}
        </div>
      )}
      <div className="gc-conflict-side__actions">
        <Button compact disabled={busy || !version} onClick={onTake}>Take {label} &amp; stage</Button>
        <Button compact disabled={busy || !canCompose || text === undefined} onClick={() => text !== undefined && onUseAll(text)}>
          Use in Result
        </Button>
      </div>
    </section>
  );
}

export function ConflictResolverDialog({
  branchName,
  busy,
  details,
  operation,
  onClose,
  onResolve,
  onSave,
}: ConflictResolverDialogProps) {
  const labels = conflictSideLabels(operation, branchName);
  const initialResult = details.result.kind === "text" ? details.result.text ?? "" : "";
  const [result, setResult] = useState(initialResult);
  const [lineEnding, setLineEnding] = useState<ConflictLineEndingPolicy>("preserve");
  const resultRef = useRef<HTMLTextAreaElement>(null);
  const editable = details.result.kind === "text"
    || (details.result.kind === "missing" && (
      details.ours?.content.kind === "text" || details.theirs?.content.kind === "text"
    ));
  const dirty = editable && result !== initialResult;
  const mixedNeedsChoice = details.result.line_ending === "mixed" && dirty && lineEnding === "preserve";

  const requestClose = () => {
    if (dirty && !window.confirm("Discard the unresolved changes in the Result editor?")) return;
    onClose();
  };

  const requestResolve = (resolution: ConflictResolution) => {
    const message = resolution === "delete"
      ? dirty
        ? `Discard the edited Result and delete '${details.path}' as the conflict resolution?`
        : `Delete '${details.path}' as the conflict resolution?`
      : "Discard the edited Result and replace it with this resolution?";
    if ((dirty || resolution === "delete") && !window.confirm(message)) return;
    onResolve(resolution);
  };

  const appendAtCursor = (line: string) => {
    const input = resultRef.current;
    if (!input) {
      setResult((current) => current + line);
      return;
    }
    const start = input.selectionStart;
    const end = input.selectionEnd;
    setResult((current) => `${current.slice(0, start)}${line}${current.slice(end)}`);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + line.length, start + line.length);
    });
  };

  const baseText = details.base?.content.kind === "text" ? details.base.content.text : undefined;

  return (
    <Modal
      description="Review Base/Ours/Theirs, compose the final file, then save and stage it. GitCat verifies the conflict and working copy have not changed before writing."
      footer={
        <>
          <Button disabled={busy} icon={<Trash2 size={14} />} onClick={() => requestResolve("delete")} tone="danger">Delete file</Button>
          <Button disabled={busy} onClick={() => requestResolve("mark_resolved")}>Stage working copy</Button>
          <span className="gc-modal__spacer" />
          <Button disabled={busy} onClick={requestClose}>Cancel</Button>
          <Button disabled={busy || !editable || mixedNeedsChoice} onClick={() => onSave(result, lineEnding)} tone="accent">Save result &amp; stage</Button>
        </>
      }
      onClose={requestClose}
      title={`Resolve conflict · ${details.path}`}
      width="wide"
    >
      <div className="gc-conflict-editor">
        <div className="gc-conflict-editor__summary">
          <GitMerge aria-hidden="true" size={17} />
          <span><strong>{operation.replace("_", " ")} conflict</strong><small>Side names follow Git index stages, including rebase semantics.</small></span>
          {details.base ? (
            <details>
              <summary>View base</summary>
              <div>
                <code>{details.base.mode} · {details.base.oid.slice(0, 7)}</code>
                {baseText === undefined ? <p>{contentMessage(details.base.content)}</p> : <pre>{baseText}</pre>}
              </div>
            </details>
          ) : <small>No common base content</small>}
        </div>

        <div className="gc-conflict-editor__sides">
          <ConflictSide
            busy={busy}
            canCompose={editable}
            description={labels.oursDescription}
            label={labels.ours}
            onAppend={appendAtCursor}
            onTake={() => requestResolve("ours")}
            onUseAll={setResult}
            version={details.ours}
          />
          <ConflictSide
            busy={busy}
            canCompose={editable}
            description={labels.theirsDescription}
            label={labels.theirs}
            onAppend={appendAtCursor}
            onTake={() => requestResolve("theirs")}
            onUseAll={setResult}
            version={details.theirs}
          />
        </div>

        <section className="gc-conflict-result">
          <header>
            <span><Braces aria-hidden="true" size={15} /><strong>Result</strong></span>
            <small>{result.length.toLocaleString()} characters · {details.result.line_ending?.replace("cr_lf", "CRLF").toUpperCase() ?? "new file"}</small>
          </header>
          {details.result.line_ending === "mixed" ? (
            <div className="gc-conflict-result__eol" role={mixedNeedsChoice ? "alert" : undefined}>
              <span>Mixed line endings detected. An edited result needs an explicit normalization choice.</span>
              <select
                aria-label="Result line ending policy"
                disabled={busy}
                onChange={(event) => setLineEnding(event.target.value as ConflictLineEndingPolicy)}
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
              disabled={busy}
              onChange={(event) => setResult(event.target.value)}
              ref={resultRef}
              spellCheck={false}
              value={result}
            />
          ) : (
            <div className="gc-conflict-result__unavailable">
              <AlertTriangle aria-hidden="true" size={18} />
              <span><strong>Built-in text editing unavailable</strong>{contentMessage(details.result)}</span>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
