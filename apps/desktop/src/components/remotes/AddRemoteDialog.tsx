import { Cloud, Globe } from "lucide-react";
import { useId, useState } from "react";

import { credentialFor, forgeConnected, useForgeConnections } from "../../app/forgeConnections";
import { cx, FIELD_INPUT } from "../../lib";
import { INTEGRATIONS, selfHostedHosts } from "../../lib/integrations";
import type { ForgeKind, NewRepository } from "../../lib/types";
import { ForgeConnectPanel } from "../forge";
import { Button, Input, Modal, ModalSpacer } from "../ui";

/** What the dialog asks for: an address to point at, or a repository to create first. */
export type AddRemoteRequest =
  | { kind: "url"; remote: string; url: string }
  | { kind: "forge"; remote: string; repository: NewRepository };

const TABS: readonly { id: "url" | ForgeKind; label: string }[] = [
  { id: "url", label: "URL" },
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
  { id: "bitbucket", label: "Bitbucket" },
  { id: "azure_devops", label: "Azure DevOps" },
];

const DEFAULT_REMOTE = "origin";

function Field({ children, label }: { children: (id: string) => React.ReactNode; label: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.25">
      <label className="text-[11px] font-[650] text-muted" htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

/**
 * Points a repository without a remote at one, either by address or by
 * creating the repository on a hosting service.
 *
 * Every service is offered as a tab, including the ones GitCat cannot create a
 * repository on: a missing tab reads as "not supported yet", while a present
 * one says what it does and sends the user to the address tab instead.
 */
export function AddRemoteDialog({
  busy,
  onClose,
  onSubmit,
  overrides,
  pushes,
  repositoryName,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (request: AddRemoteRequest) => void;
  overrides: Readonly<Record<string, ForgeKind>>;
  /** Whether the current branch is pushed once the remote exists. */
  pushes: boolean;
  repositoryName: string;
}) {
  const [tab, setTab] = useState<"url" | ForgeKind>("url");
  const [remote, setRemote] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState(repositoryName);
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [host, setHost] = useState<string | null>(null);
  const connections = useForgeConnections();

  const remoteName = remote.trim() || DEFAULT_REMOTE;
  const integrations = INTEGRATIONS.filter((entry) => entry.forge === tab);
  const creatable = integrations.filter((entry) => entry.support !== "links_only");
  const hosts = creatable.flatMap((entry) => selfHostedHosts(entry, overrides));
  const connectedHosts = hosts.filter((entry) => forgeConnected(connections, entry));
  const selectedHost = host && connectedHosts.includes(host) ? host : connectedHosts[0] ?? null;

  const submittable = !busy && (tab === "url"
    ? Boolean(url.trim())
    : Boolean(selectedHost && name.trim()));

  const submit = () => {
    if (!submittable) return;
    if (tab === "url") {
      onSubmit({ kind: "url", remote: remoteName, url: url.trim() });
    } else if (selectedHost) {
      onSubmit({
        kind: "forge",
        remote: remoteName,
        repository: {
          host: selectedHost,
          name: name.trim(),
          description: description.trim() || undefined,
          private: isPrivate,
        },
      });
    }
  };
  const submitOnEnter = (event: React.KeyboardEvent) => { if (event.key === "Enter") submit(); };

  const remoteField = (
    <Field label="Remote name">
      {(id) => (
        <Input
          className={FIELD_INPUT}
          id={id}
          onChange={(event) => setRemote(event.target.value)}
          onKeyDown={submitOnEnter}
          placeholder={DEFAULT_REMOTE}
          spellCheck={false}
          value={remote}
        />
      )}
    </Field>
  );

  const label = tab === "url"
    ? (pushes ? "Add remote and push" : "Add remote")
    : (pushes ? "Create remote and push" : "Create remote");
  const showSubmit = tab === "url" || connectedHosts.length > 0;

  return (
    <Modal
      footer={
        <>
          <ModalSpacer />
          <Button onClick={onClose}>Cancel</Button>
          {showSubmit ? (
            <Button disabled={!submittable} onClick={submit} tone="accent">{label}</Button>
          ) : null}
        </>
      }
      onClose={onClose}
      title="Add Remote"
    >
      <div className="flex min-h-80 flex-col gap-3.5">
        <nav className="flex border-b border-border" role="tablist">
          {TABS.map((entry) => (
            <button
              aria-selected={tab === entry.id}
              className={cx(
                "flex flex-1 cursor-pointer flex-col items-center gap-1 border-b-2 px-2 pb-2 pt-1 text-[11px] font-[650]",
                tab === entry.id
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted hover:text-foreground",
              )}
              key={entry.id}
              onClick={() => { setTab(entry.id); setHost(null); }}
              role="tab"
              type="button"
            >
              {entry.id === "url" ? <Globe size={17} /> : <Cloud size={17} />}
              {entry.label}
            </button>
          ))}
        </nav>

        {tab === "url" ? (
          <>
            {remoteField}
            <Field label="URL">
              {(id) => (
                <Input
                  autoFocus
                  className={FIELD_INPUT}
                  id={id}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={submitOnEnter}
                  placeholder="https://github.com/owner/repository.git"
                  spellCheck={false}
                  value={url}
                />
              )}
            </Field>
          </>
        ) : creatable.length === 0 ? (
          <p className="rounded-[7px] border border-border bg-background/45 px-3.5 py-3 text-[11px] leading-[1.5] text-muted">
            GitCat cannot create a repository on {integrations[0]?.label ?? "this service"} yet.
            Create it on the service itself and add its address on the{" "}
            <button className="cursor-pointer text-accent hover:underline" onClick={() => setTab("url")} type="button">
              URL
            </button>{" "}
            tab.
          </p>
        ) : connectedHosts.length === 0 ? (
          <ForgeConnectPanel host={hosts[0] ?? null} integration={creatable[0]} />
        ) : (
          <>
            <Field label="Account">
              {(id) => (
                <select
                  className={FIELD_INPUT}
                  id={id}
                  onChange={(event) => setHost(event.target.value)}
                  value={selectedHost ?? ""}
                >
                  {connectedHosts.map((entry) => {
                    const account = credentialFor(connections, entry)?.account;
                    return (
                      <option key={entry} value={entry}>
                        {account ? `${account} (${entry})` : entry}
                      </option>
                    );
                  })}
                </select>
              )}
            </Field>
            <Field label="Repository name">
              {(id) => (
                <Input
                  autoFocus
                  className={FIELD_INPUT}
                  id={id}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={submitOnEnter}
                  spellCheck={false}
                  value={name}
                />
              )}
            </Field>
            {remoteField}
            <Field label="Description">
              {(id) => (
                <Input
                  className={FIELD_INPUT}
                  id={id}
                  onChange={(event) => setDescription(event.target.value)}
                  onKeyDown={submitOnEnter}
                  value={description}
                />
              )}
            </Field>
            <Field label="Access">
              {(id) => (
                <select
                  className={FIELD_INPUT}
                  id={id}
                  onChange={(event) => setIsPrivate(event.target.value === "private")}
                  value={isPrivate ? "private" : "public"}
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              )}
            </Field>
            <p className="text-[10px] leading-[1.5] text-muted/72">
              The repository is created empty on {selectedHost} and added as
              <span className="text-foreground"> {remoteName}</span>.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
