import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { conflictSideLabels } from "../../lib/conflicts";
import type {
  ConflictFileDetails,
  ConflictLineEndingPolicy,
  ConflictResolution,
  RepositoryOperationState,
} from "../../lib/types";
import { Button, Modal, ModalSpacer } from "../ui";
import { ConflictResult } from "./ConflictResult";
import { ConflictSide } from "./ConflictSide";
import { ConflictSummary } from "./ConflictSummary";

interface ConflictResolverDialogProps {
  branchName: string;
  busy: boolean;
  details: ConflictFileDetails;
  operation: RepositoryOperationState;
  onClose: () => void;
  onResolve: (resolution: ConflictResolution) => void;
  onSave: (text: string, lineEnding: ConflictLineEndingPolicy) => void;
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

  // Lines picked from either side land at the caret, so the editor keeps focus
  // and the user can keep composing without reaching for the mouse.
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

  return (
    <Modal
      description="Review Base/Ours/Theirs, compose the final file, then save and stage it. GitCat verifies the conflict and working copy have not changed before writing."
      footer={
        <>
          <Button disabled={busy} icon={<Trash2 size={14} />} onClick={() => requestResolve("delete")} tone="danger">Delete file</Button>
          <Button disabled={busy} onClick={() => requestResolve("mark_resolved")}>Stage working copy</Button>
          <ModalSpacer />
          <Button disabled={busy} onClick={requestClose}>Cancel</Button>
          <Button disabled={busy || !editable || mixedNeedsChoice} onClick={() => onSave(result, lineEnding)} tone="accent">Save result &amp; stage</Button>
        </>
      }
      onClose={requestClose}
      title={`Resolve conflict · ${details.path}`}
      width="wide"
    >
      <div className="grid gap-3">
        <ConflictSummary base={details.base} operation={operation} />

        <div className="grid grid-cols-2 gap-3 max-[1080px]:grid-cols-1">
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

        <ConflictResult
          busy={busy}
          editable={editable}
          lineEnding={lineEnding}
          mixedNeedsChoice={mixedNeedsChoice}
          onLineEndingChange={setLineEnding}
          onResultChange={setResult}
          result={result}
          resultContent={details.result}
          resultRef={resultRef}
        />
      </div>
    </Modal>
  );
}
