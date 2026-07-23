import { CalendarClock, Check, GitCommitHorizontal, Pencil } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import type { ChangedFile, CommitDetails as CommitDetailsType } from "../lib/types";
import { Badge, Button } from "./Primitives";
import { FileTree, FileTreeControls } from "./FileTree";
import type { FileTreeItem, FileViewMode } from "./FileTree";

interface CommitDetailsProps {
  details: CommitDetailsType;
  selectedPath?: string;
  busy?: boolean;
  fileViewMode: FileViewMode;
  onFileViewModeChange: (mode: FileViewMode) => void;
  onSelectFile: (file: ChangedFile) => void;
  onCopySha: () => void;
  onReword?: (message: string) => Promise<boolean>;
}

function composeMessage(subject: string, body: string): string {
  const trimmedBody = body.trim();
  const trimmedSubject = subject.trim();
  return trimmedBody ? `${trimmedSubject}\n\n${trimmedBody}` : trimmedSubject;
}

const STATUS_LABEL: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  type_changed: "T",
  unmerged: "U",
};

export function CommitDetails({ details, selectedPath, busy = false, fileViewMode, onFileViewModeChange, onSelectFile, onCopySha, onReword }: CommitDetailsProps) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(details.subject);
  const [body, setBody] = useState(details.body);
  const shaTooltipId = useId();

  // Reset the editor whenever a different commit loads or the message changes
  // underneath (e.g. after a successful reword reloads details).
  useEffect(() => {
    setEditing(false);
    setSubject(details.subject);
    setBody(details.body);
  }, [details.oid, details.subject, details.body]);

  const dirty = subject.trim() !== details.subject.trim() || body.trim() !== details.body.trim();
  const canSave = Boolean(onReword) && subject.trim().length > 0 && dirty && !busy;

  const submitReword = async () => {
    if (!canSave || !onReword) return;
    const ok = await onReword(composeMessage(subject, body));
    if (ok) setEditing(false);
  };
  const authored = new Date(details.authored_at.seconds * 1000);
  const initials = details.author.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const fileItems = useMemo<FileTreeItem<ChangedFile>[]>(() => details.files.map((file) => ({
    id: file.new_path,
    path: file.new_path,
    data: file,
    status: file.status,
    statusLabel: STATUS_LABEL[file.status] ?? "M",
    binary: file.binary,
    additions: file.additions,
    deletions: file.deletions,
  })), [details.files]);

  return (
    <aside className="gc-details" aria-label="Commit details">
      <div className="gc-details__sha">
        <GitCommitHorizontal size={14} />
        <span>commit:</span>
        <span className="gc-sha-copy">
          <button
            aria-describedby={shaTooltipId}
            aria-label={`Copy full commit SHA ${details.oid}`}
            onClick={onCopySha}
            type="button"
          >
            <code>{details.short_oid}</code>
          </button>
          <span className="gc-sha-copy__tooltip" id={shaTooltipId} role="tooltip">
            <code>{details.oid}</code>
            <small>Click to copy</small>
          </span>
        </span>
      </div>
      {editing ? (
        <form
          className="gc-details__message gc-details__message--editing"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              setSubject(details.subject);
              setBody(details.body);
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void submitReword();
          }}
        >
          <div className="gc-details__edit-subject-row">
            <input
              aria-label="Commit summary"
              autoFocus
              className="gc-details__edit-subject"
              disabled={busy}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Summary"
              value={subject}
            />
            <span className="gc-details__edit-count">{subject.length}</span>
          </div>
          <textarea
            aria-label="Commit description"
            className="gc-details__edit-body"
            disabled={busy}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Description"
            rows={4}
            value={body}
          />
          <div className="gc-details__edit-actions">
            <Button compact disabled={!canSave} tone="accent" type="submit">Update Message</Button>
            <Button
              compact
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setSubject(details.subject);
                setBody(details.body);
              }}
              type="button"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : onReword ? (
        <button
          className="gc-details__message gc-details__message--editable"
          onClick={() => setEditing(true)}
          title="Click to edit commit message"
          type="button"
        >
          <h2>{details.subject}<Pencil aria-hidden="true" className="gc-details__edit-hint" size={13} /></h2>
          {details.body ? <p>{details.body}</p> : <span className="gc-details__no-body">No description</span>}
        </button>
      ) : (
        <div className="gc-details__message">
          <h2>{details.subject}</h2>
          {details.body ? <p>{details.body}</p> : <span className="gc-details__no-body">No description</span>}
        </div>
      )}
      <div className="gc-details__identity">
        <span className="gc-avatar">{initials || "?"}</span>
        <div>
          <strong>{details.author.name}</strong>
          <span>{details.author.email}</span>
          <small><CalendarClock size={12} /> {authored.toLocaleString()}</small>
        </div>
      </div>
      <div className="gc-details__stats">
        <Badge tone="accent">{details.stats.files} files</Badge>
        <span className="gc-stat-add">+{details.stats.additions}</span>
        <span className="gc-stat-delete">−{details.stats.deletions}</span>
        {details.parent_oids.length > 1 ? <Badge tone="warning">merge</Badge> : null}
      </div>
      <div className="gc-details__files">
        <div className="gc-file-list__header">
          <span>Changed files</span>
          <small>{details.files.length}</small>
        </div>
        <FileTreeControls mode={fileViewMode} onModeChange={onFileViewModeChange} />
        <FileTree
          ariaLabel="Changed files"
          emptyState={<><Check aria-hidden="true" size={16} /> No changed files</>}
          items={fileItems}
          mode={fileViewMode}
          onSelect={onSelectFile}
          selectedId={selectedPath}
        />
      </div>
    </aside>
  );
}

export function CommitDetailsSkeleton() {
  const fileRows = Array.from({ length: 8 }, (_, index) => index);

  return (
    <aside className="gc-details gc-details--skeleton" aria-busy="true" aria-label="Loading commit details">
      <div className="gc-details__sha">
        <GitCommitHorizontal size={14} />
        <span className="gc-skeleton-line gc-skeleton-line--label" />
        <span className="gc-skeleton-line gc-skeleton-line--sha" />
      </div>
      <div className="gc-details__message">
        <span className="gc-skeleton-line gc-skeleton-line--title" />
        <span className="gc-skeleton-line gc-skeleton-line--body" />
        <span className="gc-skeleton-line gc-skeleton-line--body-short" />
      </div>
      <div className="gc-details__identity">
        <span className="gc-avatar gc-avatar--skeleton" />
        <div>
          <span className="gc-skeleton-line gc-skeleton-line--author" />
          <span className="gc-skeleton-line gc-skeleton-line--email" />
          <span className="gc-skeleton-line gc-skeleton-line--date" />
        </div>
      </div>
      <div className="gc-details__stats">
        <span className="gc-skeleton-pill" />
        <span className="gc-skeleton-line gc-skeleton-line--stat" />
        <span className="gc-skeleton-line gc-skeleton-line--stat" />
      </div>
      <div className="gc-details__files">
        <div className="gc-file-list__header">
          <span className="gc-skeleton-line gc-skeleton-line--files-title" />
          <small className="gc-skeleton-line gc-skeleton-line--files-count" />
        </div>
        <div className="gc-file-tree gc-file-tree--skeleton" aria-hidden="true">
          {fileRows.map((row) => (
            <span className="gc-skeleton-line gc-skeleton-line--file" key={row} />
          ))}
        </div>
      </div>
    </aside>
  );
}
