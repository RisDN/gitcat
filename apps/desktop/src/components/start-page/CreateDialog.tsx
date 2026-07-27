import { Cloud, Monitor, Server } from "lucide-react";
import { useId, useState } from "react";
import type { LucideIcon } from "lucide-react";

import { chooseDirectory, cx, FIELD_INPUT, gitcatApi, joinPath } from "../../lib";
import { Badge, Button, Input, Modal, ModalSpacer } from "../ui";
import { GITIGNORE_TEMPLATES } from "./gitignoreTemplates";

interface Provider {
  id: string;
  label: string;
  icon: LucideIcon;
  available: boolean;
}

const PROVIDERS: Provider[] = [
  { id: "local", label: "Local Only", icon: Monitor, available: true },
  { id: "github", label: "GitHub.com", icon: Cloud, available: false },
  { id: "github-enterprise", label: "GitHub Enterprise Server", icon: Server, available: false },
  { id: "gitlab", label: "GitLab.com", icon: Cloud, available: false },
  { id: "gitlab-self", label: "GitLab (Self-Managed)", icon: Server, available: false },
  { id: "bitbucket", label: "Bitbucket.org", icon: Cloud, available: false },
  { id: "bitbucket-data-center", label: "Bitbucket Data Center", icon: Server, available: false },
  { id: "azure", label: "Azure DevOps", icon: Cloud, available: false },
];

function Row({ children, label }: { children: (id: string) => React.ReactNode; label: string }) {
  const id = useId();
  return (
    <>
      <label className="pt-2 text-right text-[11px] font-[650] text-muted" htmlFor={id}>
        {label}
      </label>
      <div className="min-w-0">{children(id)}</div>
    </>
  );
}

export function CreateDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (path: string, defaultBranch: string, ignorePatterns: string[]) => void;
}) {
  const [provider, setProvider] = useState("local");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [template, setTemplate] = useState("");

  const path = parent.trim() && name.trim() ? joinPath(parent, name) : "";
  const submittable = Boolean(path) && !busy;

  const submit = () => {
    if (!submittable) return;
    const patterns = GITIGNORE_TEMPLATES.find((entry) => entry.id === template)?.patterns ?? [];
    onSubmit(path, defaultBranch.trim() || "main", patterns);
  };

  return (
    <Modal
      footer={
        <>
          <ModalSpacer />
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={!submittable} onClick={submit} tone="accent">
            Create Repository
          </Button>
        </>
      }
      onClose={onClose}
      title="Initialize a Repository"
      width="large"
    >
      <div className="flex min-h-95 gap-4.25">
        <nav className="w-56 shrink-0 rounded-[7px] border border-border bg-background/45 p-1.25">
          {PROVIDERS.map((entry) => (
            <button
              className={cx(
                "flex w-full items-center gap-2.25 rounded-[5px] px-2.25 py-1.75 text-left text-[12px]",
                entry.available
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-55",
                entry.id === provider
                  ? "bg-accent/12 font-[650] text-accent"
                  : "text-muted enabled:hover:bg-foreground/6 enabled:hover:text-foreground",
              )}
              disabled={!entry.available}
              key={entry.id}
              onClick={() => setProvider(entry.id)}
              title={entry.available ? undefined : "Hosted providers are not connected yet"}
              type="button"
            >
              <entry.icon size={15} />
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{entry.label}</span>
              {entry.available ? null : <Badge>Soon</Badge>}
            </button>
          ))}
        </nav>

        <div className="grid min-w-0 flex-1 auto-rows-min grid-cols-[130px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-2.5 content-start">
          <h3 className="col-span-2 mb-1.5 text-[15px] font-[640]">Initialize a Repo</h3>

          <Row label="Name">
            {(id) => (
              <Input
                autoFocus
                className={FIELD_INPUT}
                id={id}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
                placeholder="my-project"
                spellCheck={false}
                value={name}
              />
            )}
          </Row>

          <Row label="Initialize in">
            {(id) => (
              <span className="flex gap-1.75">
                <Input
                  className={FIELD_INPUT}
                  id={id}
                  onChange={(event) => setParent(event.target.value)}
                  placeholder="Folder that will contain the repository"
                  spellCheck={false}
                  value={parent}
                />
                {gitcatApi.runtime === "tauri" ? (
                  <Button
                    onClick={() => {
                      void chooseDirectory("Choose parent folder").then((selected) => {
                        if (selected) setParent(selected);
                      });
                    }}
                  >
                    Browse
                  </Button>
                ) : null}
              </span>
            )}
          </Row>

          <span className="pt-1.5 text-right text-[11px] font-[650] text-muted">Full path</span>
          <p className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap pt-1.5 text-[12px] text-muted">
            {path || "-"}
          </p>

          <Row label="Default branch name">
            {(id) => (
              <Input
                className={FIELD_INPUT}
                id={id}
                onChange={(event) => setDefaultBranch(event.target.value)}
                placeholder="main"
                spellCheck={false}
                value={defaultBranch}
              />
            )}
          </Row>

          <Row label=".gitignore template (optional)">
            {(id) => (
              <select
                className={FIELD_INPUT}
                id={id}
                onChange={(event) => setTemplate(event.target.value)}
                value={template}
              >
                <option value="">Select…</option>
                {GITIGNORE_TEMPLATES.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
            )}
          </Row>
        </div>
      </div>
    </Modal>
  );
}
