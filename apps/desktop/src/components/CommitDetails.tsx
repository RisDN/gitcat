import { CalendarClock, Check, GitCommitHorizontal } from "lucide-react";
import { useId, useMemo, useState } from "react";

import type { ChangedFile, CommitDetails as CommitDetailsType } from "../lib/types";
import { Badge } from "./Primitives";
import { FileTree, FileTreeControls } from "./FileTree";
import type { FileTreeItem, FileViewMode } from "./FileTree";

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
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>("path");
  const shaTooltipId = useId();
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
      <div className="gc-details__files">
        <div className="gc-file-list__header">
          <span>Changed files</span>
          <small>{details.files.length}</small>
        </div>
        <FileTreeControls mode={fileViewMode} onModeChange={setFileViewMode} />
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
