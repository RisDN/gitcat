import { Check, FileCode2, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import type { StatusEntry, WorktreeStatus } from "../lib/types";
import { Badge, Button, IconButton } from "./Primitives";

interface WorktreePanelProps {
  status: WorktreeStatus;
  busy: boolean;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onOpenDiff: (entry: StatusEntry, staged: boolean) => void;
  onCommit: (message: string, amend: boolean, signoff: boolean) => Promise<boolean>;
}

export function WorktreePanel({
  status,
  busy,
  onStage,
  onUnstage,
  onOpenDiff,
  onCommit,
}: WorktreePanelProps) {
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [signoff, setSignoff] = useState(false);
  const staged = useMemo(() => status.entries.filter((entry) => entry.index), [status.entries]);
  const unstaged = useMemo(() => status.entries.filter((entry) => entry.worktree), [status.entries]);

  const submit = async () => {
    if (await onCommit(message, amend, signoff)) {
      setMessage("");
      setAmend(false);
    }
  };

  return (
    <aside className="gc-worktree" aria-label="Working tree">
      <header className="gc-worktree__header">
        <div>
          <span className="gc-wip-node" />
          <div><strong>Working tree</strong><small>{status.clean ? "Clean" : `${status.entries.length} changed`}</small></div>
        </div>
        {status.stash_count ? <Badge tone="muted">{status.stash_count} stashed</Badge> : null}
      </header>

      <StatusSection
        actionLabel="Stage all"
        entries={unstaged}
        label="Unstaged"
        onAction={() => onStage(unstaged.map((entry) => entry.path))}
        onEntryAction={(entry) => onStage([entry.path])}
        onOpenDiff={(entry) => onOpenDiff(entry, false)}
        plus
      />
      <StatusSection
        actionLabel="Unstage all"
        entries={staged}
        label="Staged"
        onAction={() => onUnstage(staged.map((entry) => entry.path))}
        onEntryAction={(entry) => onUnstage([entry.path])}
        onOpenDiff={(entry) => onOpenDiff(entry, true)}
      />

      <div className="gc-commit-form">
        <label htmlFor="commit-message">Commit message</label>
        <textarea
          id="commit-message"
          onChange={(event) => setMessage(event.target.value)}
          placeholder={"Summary\n\nOptional description"}
          rows={5}
          value={message}
        />
        <div className="gc-commit-form__options">
          <label><input checked={amend} onChange={(event) => setAmend(event.target.checked)} type="checkbox" /> Amend</label>
          <label><input checked={signoff} onChange={(event) => setSignoff(event.target.checked)} type="checkbox" /> Sign off</label>
        </div>
        <Button
          disabled={busy || !message.trim() || (!staged.length && !amend)}
          onClick={() => void submit()}
          tone="accent"
        >
          {amend ? "Amend commit" : `Commit ${staged.length || ""}`}
        </Button>
      </div>
    </aside>
  );
}

function StatusSection({
  label,
  entries,
  actionLabel,
  onAction,
  onEntryAction,
  onOpenDiff,
  plus = false,
}: {
  label: string;
  entries: StatusEntry[];
  actionLabel: string;
  onAction: () => void;
  onEntryAction: (entry: StatusEntry) => void;
  onOpenDiff: (entry: StatusEntry) => void;
  plus?: boolean;
}) {
  return (
    <section className="gc-status-section">
      <header>
        <span>{label} <b>{entries.length}</b></span>
        <button disabled={!entries.length} onClick={onAction} type="button">{actionLabel}</button>
      </header>
      <div>
        {entries.map((entry) => (
          <div className="gc-status-row" key={`${label}:${entry.path}`}>
            <button className="gc-status-row__file" onClick={() => onOpenDiff(entry)} type="button">
              <FileCode2 size={14} />
              <span title={entry.path}>{entry.path}</span>
              {entry.conflicted ? <b className="gc-file-status gc-file-status--unmerged">U</b> : null}
            </button>
            <IconButton aria-label={`${plus ? "Stage" : "Unstage"} ${entry.path}`} onClick={() => onEntryAction(entry)}>
              {plus ? <Plus size={14} /> : <Minus size={14} />}
            </IconButton>
          </div>
        ))}
        {!entries.length ? <p className="gc-status-empty"><Check size={14} /> Nothing here</p> : null}
      </div>
    </section>
  );
}
