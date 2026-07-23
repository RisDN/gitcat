import { cx } from "../../lib";
import { matchesKeybind } from "../../lib/keybinds";
import { Button, Input, TextArea } from "../ui";

export interface CommitDraft {
  message: string;
  description: string;
  amend: boolean;
  signoff: boolean;
}

const FIELD = "w-full rounded-[5px] border border-border bg-background leading-[1.45] outline-0 focus:border-accent";

export function CommitForm({
  busy,
  canCommit,
  commitKeybind,
  draft,
  stagedCount,
  onDraftChange,
  onSubmit,
}: {
  busy: boolean;
  canCommit: boolean;
  commitKeybind: string;
  draft: CommitDraft;
  stagedCount: number;
  onDraftChange: (draft: CommitDraft) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-[0_0_auto] flex-col gap-2 p-2.75">
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted" htmlFor="commit-message">
        Commit message
      </label>
      <Input
        className={cx(FIELD, "px-2.25 py-1.75")}
        disabled={busy}
        id="commit-message"
        onChange={(event) => onDraftChange({ ...draft, message: event.target.value })}
        onKeyDown={(event) => {
          if (matchesKeybind(event.nativeEvent, commitKeybind)) {
            event.preventDefault();
            event.stopPropagation();
            onSubmit();
            return;
          }
          // Enter moves to the description instead of submitting a one-line commit.
          if (event.key === "Enter") {
            event.preventDefault();
            document.getElementById("commit-description")?.focus();
          }
        }}
        placeholder="Summary"
        type="text"
        value={draft.message}
      />
      <TextArea
        className={cx(FIELD, "h-21 min-h-21 flex-[0_0_auto] resize-none px-2.25 py-1.5")}
        disabled={busy}
        id="commit-description"
        onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
        onKeyDown={(event) => {
          if (matchesKeybind(event.nativeEvent, commitKeybind)) {
            event.preventDefault();
            event.stopPropagation();
            onSubmit();
          }
        }}
        placeholder="Description (optional)"
        rows={4}
        value={draft.description}
      />
      <div className="flex gap-3.5 text-[11px] text-muted">
        <label className="flex items-center gap-1.25">
          <input
            checked={draft.amend}
            className="accent-accent"
            disabled={busy}
            onChange={(event) => onDraftChange({ ...draft, amend: event.target.checked })}
            type="checkbox"
          />
          Amend
        </label>
        <label className="flex items-center gap-1.25">
          <input
            checked={draft.signoff}
            className="accent-accent"
            disabled={busy}
            onChange={(event) => onDraftChange({ ...draft, signoff: event.target.checked })}
            type="checkbox"
          />
          Sign off
        </label>
      </div>
      <Button disabled={!canCommit} onClick={onSubmit} tone="accent">
        {draft.amend
          ? "Amend commit"
          : stagedCount > 0
            ? `Commit Changes to ${stagedCount} files`
            : "Stage Changes to Commit"}
      </Button>
    </div>
  );
}
