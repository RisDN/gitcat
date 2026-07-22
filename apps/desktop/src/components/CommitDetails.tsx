import { CalendarClock, Check, Copy, FileCode2, GitCommitHorizontal } from "lucide-react";

import type { ChangedFile, CommitDetails as CommitDetailsType } from "../lib/types";
import { Badge, IconButton } from "./Primitives";

interface CommitDetailsProps {
  details: CommitDetailsType;
  selectedPath?: string;
  onSelectFile: (file: ChangedFile) => void;
  onCopySha: () => void;
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

export function CommitDetails({ details, selectedPath, onSelectFile, onCopySha }: CommitDetailsProps) {
  const authored = new Date(details.authored_at.seconds * 1000);
  const initials = details.author.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <aside className="gc-details" aria-label="Commit details">
      <div className="gc-details__sha">
        <GitCommitHorizontal size={14} />
        <span>commit:</span>
        <code>{details.short_oid}</code>
        <IconButton aria-label="Copy commit SHA" onClick={onCopySha} title="Copy full SHA">
          <Copy size={14} />
        </IconButton>
      </div>
      <div className="gc-details__message">
        <h2>{details.subject}</h2>
        {details.body ? <p>{details.body}</p> : <span className="gc-details__no-body">No description</span>}
      </div>
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
      <div className="gc-file-list__header">
        <span>Changed files</span>
        <small>{details.files.length}</small>
      </div>
      <div className="gc-file-list">
        {details.files.map((file) => (
          <button
            className={selectedPath === file.new_path ? "gc-file-row--active" : ""}
            key={`${file.old_path ?? ""}:${file.new_path}`}
            onClick={() => onSelectFile(file)}
            type="button"
          >
            <FileCode2 size={14} />
            <span title={file.new_path}>{file.new_path}</span>
            {file.binary ? <small>binary</small> : null}
            <b className={`gc-file-status gc-file-status--${file.status}`}>{STATUS_LABEL[file.status] ?? "M"}</b>
          </button>
        ))}
        {!details.files.length ? (
          <div className="gc-details__empty"><Check size={18} /> No changed files</div>
        ) : null}
      </div>
    </aside>
  );
}
