import { Monitor } from "lucide-react";
import { useId, useState } from "react";

import { credentialFor, useForgeConnections } from "../../app/forgeConnections";
import { chooseDirectory, cx, FIELD_INPUT, gitcatApi, joinPath } from "../../lib";
import { INTEGRATIONS, selfHostedHosts } from "../../lib/integrations";
import type { Integration } from "../../lib/integrations";
import type { ForgeKind, NewRepository } from "../../lib/types";
import { ForgeConnectPanel } from "../forge";
import { Badge, Button, Input, Modal, ModalSpacer } from "../ui";
import { GITIGNORE_TEMPLATES } from "./gitignoreTemplates";
import { SourceButton } from "./SourceButton";

const LOCAL = "local";

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
  overrides,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    path: string,
    defaultBranch: string,
    ignorePatterns: string[],
    remote: NewRepository | null,
  ) => void;
  overrides: Readonly<Record<string, ForgeKind>>;
}) {
  const [provider, setProvider] = useState(LOCAL);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [template, setTemplate] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [host, setHost] = useState<string | null>(null);
  const connections = useForgeConnections();

  const integration = INTEGRATIONS.find((entry) => entry.id === provider);
  const hosts = integration ? selfHostedHosts(integration, overrides) : [];
  const selectedHost = host && hosts.includes(host) ? host : hosts[0] ?? null;
  const connected = Boolean(selectedHost && credentialFor(connections, selectedHost));

  const path = parent.trim() && name.trim() ? joinPath(parent, name) : "";
  const submittable = Boolean(path) && (!integration || connected) && !busy;

  const submit = () => {
    if (!submittable) return;
    const patterns = GITIGNORE_TEMPLATES.find((entry) => entry.id === template)?.patterns ?? [];
    const remote = integration && selectedHost
      ? {
        host: selectedHost,
        name: name.trim(),
        description: description.trim() || undefined,
        private: isPrivate,
      }
      : null;
    onSubmit(path, defaultBranch.trim() || "main", patterns, remote);
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
          <SourceButton
            active={provider === LOCAL}
            icon={<Monitor size={15} />}
            label="Local Only"
            onClick={() => setProvider(LOCAL)}
          />
          {INTEGRATIONS.map((entry) => (
            <SourceButton
              active={provider === entry.id}
              badge={entry.support === "links_only" ? <Badge>Coming soon</Badge> : null}
              connected={selfHostedHosts(entry, overrides).some((named) => credentialFor(connections, named))}
              disabled={entry.support === "links_only"}
              icon={<entry.icon size={15} />}
              key={entry.id}
              label={entry.label}
              onClick={() => { setProvider(entry.id); setHost(null); }}
              title={entry.support === "links_only"
                ? "GitCat cannot create a repository on this service"
                : undefined}
            />
          ))}
        </nav>

        <div className="grid min-w-0 flex-1 auto-rows-min grid-cols-[130px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-2.5 content-start">
          <h3 className="col-span-2 mb-1.5 text-[15px] font-[640]">
            {integration ? `Initialize a Repo on ${integration.label}` : "Initialize a Repo"}
          </h3>

          {integration && !connected ? (
            <div className="col-span-2">
              {hosts.length > 1 ? (
                <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                  {hosts.map((entry) => (
                    <button
                      className={cx(
                        "cursor-pointer rounded-[5px] border px-2 py-1 text-[11px]",
                        entry === selectedHost
                          ? "border-accent bg-accent/12 text-foreground"
                          : "border-border text-muted hover:text-foreground",
                      )}
                      key={entry}
                      onClick={() => setHost(entry)}
                      type="button"
                    >
                      {entry}
                    </button>
                  ))}
                </div>
              ) : null}
              <ForgeConnectPanel host={selectedHost} integration={integration} />
            </div>
          ) : (
            <>
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

              {integration ? (
                <>
                  <Row label="Description (optional)">
                    {(id) => (
                      <Input
                        className={FIELD_INPUT}
                        id={id}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="What this repository is for"
                        value={description}
                      />
                    )}
                  </Row>
                  <span className="pt-1.5 text-right text-[11px] font-[650] text-muted">Visibility</span>
                  <div className="flex min-w-0 items-center gap-3 pt-1.5 text-[11px] text-muted">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        checked={isPrivate}
                        className="accent-accent"
                        name="visibility"
                        onChange={() => setIsPrivate(true)}
                        type="radio"
                      />
                      Private
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        checked={!isPrivate}
                        className="accent-accent"
                        name="visibility"
                        onChange={() => setIsPrivate(false)}
                        type="radio"
                      />
                      Public
                    </label>
                  </div>
                </>
              ) : null}

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

              {integration ? (
                <p className="col-span-2 mt-1.5 text-[10px] leading-[1.5] text-muted/72">
                  The repository is created empty on {selectedHost} and added as
                  <span className="text-foreground"> origin</span>. Your first commit is pushed from
                  here as usual.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
