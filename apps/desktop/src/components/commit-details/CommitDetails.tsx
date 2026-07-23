import { CalendarClock, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ChangedFile, CommitDetails as CommitDetailsType } from "../../lib/types";
import type { FileTreeItem, FileViewMode } from "../file-tree";
import { FileTree, FileTreeControls } from "../file-tree";
import { Badge, SidePanel } from "../ui";
import { MessageEditor, MessageView } from "./CommitMessage";
import { Avatar, FilesHeader, FilesPanel, IdentityRow, StatsRow } from "./CommitSections";
import { ShaBar, ShaCopy } from "./ShaBar";

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
    const cancelReword = () => {
        setEditing(false);
        setSubject(details.subject);
        setBody(details.body);
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
        <SidePanel aria-label="Commit details">
            <ShaBar>
                <span>commit:</span>
                <ShaCopy oid={details.oid} onCopy={onCopySha} shortOid={details.short_oid} />
            </ShaBar>
            {editing ? (
                <MessageEditor
                    body={body}
                    busy={busy}
                    canSave={canSave}
                    onBodyChange={setBody}
                    onCancel={cancelReword}
                    onSubjectChange={setSubject}
                    onSubmit={() => void submitReword()}
                    subject={subject}
                />
            ) : (
                <MessageView
                    body={details.body}
                    onEdit={onReword ? () => setEditing(true) : undefined}
                    subject={details.subject}
                />
            )}
            <IdentityRow>
                <Avatar initials={initials} />
                <div className="flex min-w-0 flex-col gap-0.5">
                    <strong className="overflow-hidden text-ellipsis whitespace-nowrap">{details.author.name}</strong>
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted">{details.author.email}</span>
                    <small className="mt-0.75 flex items-center gap-1 text-[10px] text-muted">
                        <CalendarClock size={12} /> {authored.toLocaleString()}
                    </small>
                </div>
            </IdentityRow>
            <StatsRow>
                <Badge tone="accent">{details.stats.files} files</Badge>
                <span className="font-bold text-success">+{details.stats.additions}</span>
                <span className="font-bold text-danger">−{details.stats.deletions}</span>
                {details.parent_oids.length > 1 ? <Badge tone="warning">merge</Badge> : null}
            </StatsRow>
            <FilesPanel>
                <FilesHeader>
                    <span>Changed files</span>
                    <small className="ml-auto">{details.files.length}</small>
                </FilesHeader>
                <FileTreeControls mode={fileViewMode} onModeChange={onFileViewModeChange} />
                <FileTree
                    ariaLabel="Changed files"
                    className="flex-1 px-1.5 pb-2 pt-0.75"
                    emptyState={<><Check aria-hidden="true" size={16} /> No changed files</>}
                    items={fileItems}
                    mode={fileViewMode}
                    onSelect={onSelectFile}
                    selectedId={selectedPath}
                />
            </FilesPanel>
        </SidePanel>
    );
}
