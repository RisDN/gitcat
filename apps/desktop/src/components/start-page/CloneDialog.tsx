import { Globe } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { credentialFor, useForgeConnections } from "../../app/forgeConnections";
import { chooseDirectory, cx, joinPath, repositoryNameFromUrl } from "../../lib";
import { INTEGRATIONS, selfHostedHosts } from "../../lib/integrations";
import type { Integration } from "../../lib/integrations";
import type { CloneOptions, ForgeKind, ForgeRepository } from "../../lib/types";
import { ForgeConnectPanel } from "../forge";
import { Badge, Button, Modal, ModalSpacer } from "../ui";
import { ForgeRepositoryPicker } from "./ForgeRepositoryPicker";
import { PathField, TextInputField } from "./PathField";

const URL_SOURCE = "url";

export function CloneDialog({
  busy,
  onClose,
  onSubmit,
  overrides,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (options: CloneOptions) => void;
  overrides: Readonly<Record<string, ForgeKind>>;
}) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [folder, setFolder] = useState("");
  const [branch, setBranch] = useState("");
  // Where the URL is coming from: typed in, or picked out of a connected
  // account. Typing one needs no account, so it stays the opening choice.
  const [source, setSource] = useState(URL_SOURCE);
  const [host, setHost] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const connections = useForgeConnections();

  const integration = INTEGRATIONS.find((entry) => entry.id === source);
  const hosts = integration ? selfHostedHosts(integration, overrides) : [];
  const selectedHost = host && hosts.includes(host) ? host : hosts[0] ?? null;

  const derivedFolder = folder.trim() || repositoryNameFromUrl(url);
  const destination = parent.trim() && derivedFolder ? joinPath(parent, derivedFolder) : "";
  const submittable = Boolean(url.trim() && destination) && !busy;

  const selectRepository = (repository: ForgeRepository) => {
    setPicked(repository.full_name);
    setUrl(repository.clone_url);
  };

  const submit = () => {
    if (!submittable) return;
    onSubmit({
      url: url.trim(),
      destination,
      branch: branch.trim() || null,
      depth: null,
      filter_blob_none: false,
    });
  };

  return (
    <Modal
      description="GitCat runs system Git, so credentials and SSH keys work as they do in your terminal."
      footer={
        <>
          <ModalSpacer />
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={!submittable} onClick={submit} tone="accent">
            Clone
          </Button>
        </>
      }
      onClose={onClose}
      title="Clone a Repository"
      width="large"
    >
      <div className="flex min-h-95 gap-4.25">
        <nav
          aria-label="Clone source"
          className="w-56 shrink-0 rounded-[7px] border border-border bg-background/45 p-1.25"
        >
          <SourceButton
            active={source === URL_SOURCE}
            icon={<Globe size={15} />}
            label="Clone with URL"
            onClick={() => setSource(URL_SOURCE)}
          />
          {INTEGRATIONS.map((entry) => (
            <SourceButton
              active={source === entry.id}
              badge={entry.support === "links_only" ? <Badge>Links only</Badge> : null}
              connected={selfHostedHosts(entry, overrides).some((named) => credentialFor(connections, named))}
              disabled={entry.support === "links_only"}
              icon={<entry.icon size={15} />}
              key={entry.id}
              label={entry.label}
              onClick={() => { setSource(entry.id); setHost(null); }}
              title={entry.support === "links_only"
                ? "GitCat cannot list repositories from this service"
                : undefined}
            />
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <h3 className="text-[15px] font-[640]">
            {integration ? integration.label : "Clone a Repo"}
          </h3>

          {integration ? (
            <RepositorySource
              hosts={hosts}
              integration={integration}
              onHostChange={setHost}
              onSelect={selectRepository}
              selected={picked}
              selectedHost={selectedHost}
            />
          ) : (
            <TextInputField
              label="Remote URL"
              onChange={setUrl}
              placeholder="https://github.com/owner/repository.git"
              value={url}
            />
          )}

          <PathField
            label="Destination folder"
            onBrowse={() => {
              void chooseDirectory("Choose destination folder").then((selected) => {
                if (selected) setParent(selected);
              });
            }}
            onChange={setParent}
            placeholder="Parent folder for the clone"
            value={parent}
          />
          <TextInputField
            hint={destination || "Pick a destination folder to see the clone path."}
            label="Folder name"
            onChange={setFolder}
            placeholder={repositoryNameFromUrl(url) || "repository"}
            value={folder}
          />
          <TextInputField
            hint="Leave empty to clone the remote default branch."
            label="Branch"
            onChange={setBranch}
            placeholder="main"
            value={branch}
          />
        </div>
      </div>
    </Modal>
  );
}

/**
 * The repository list of one service, or whatever stands between the user and
 * it: no host named for a self-hosted install, or no connection yet.
 */
function RepositorySource({
  hosts,
  integration,
  onHostChange,
  onSelect,
  selected,
  selectedHost,
}: {
  hosts: readonly string[];
  integration: Integration;
  onHostChange: (host: string) => void;
  onSelect: (repository: ForgeRepository) => void;
  selected: string | null;
  selectedHost: string | null;
}) {
  const connections = useForgeConnections();

  if (!selectedHost) {
    return (
      <p className="rounded-[7px] border border-border bg-background/45 px-3.5 py-3 text-[11px] leading-[1.5] text-muted">
        No {integration.label} host is named yet. Add one under Integrations in the preferences,
        then come back here.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      {hosts.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {hosts.map((entry) => (
            <button
              className={cx(
                "cursor-pointer rounded-[5px] border px-2 py-1 text-[11px]",
                entry === selectedHost
                  ? "border-accent bg-accent/12 text-foreground"
                  : "border-border text-muted hover:text-foreground",
              )}
              key={entry}
              onClick={() => onHostChange(entry)}
              type="button"
            >
              {entry}
            </button>
          ))}
        </div>
      ) : null}

      {credentialFor(connections, selectedHost) ? (
        <ForgeRepositoryPicker host={selectedHost} onSelect={onSelect} selected={selected} />
      ) : (
        <ForgeConnectPanel host={selectedHost} integration={integration} />
      )}
    </div>
  );
}

function SourceButton({
  active,
  badge = null,
  connected = false,
  disabled = false,
  icon,
  label,
  onClick,
  title,
}: {
  active: boolean;
  badge?: ReactNode;
  connected?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      className={cx(
        "flex w-full items-center gap-2.25 rounded-[5px] px-2.25 py-1.75 text-left text-[12px]",
        disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer",
        active
          ? "bg-accent/12 font-[650] text-accent"
          : "text-muted enabled:hover:bg-foreground/6 enabled:hover:text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {icon}
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
      {connected ? (
        <span aria-label="Connected" className="size-1.75 shrink-0 rounded-full bg-success" title="Connected" />
      ) : badge}
    </button>
  );
}
