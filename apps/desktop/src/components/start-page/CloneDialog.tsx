import { Globe } from "lucide-react";
import { useState } from "react";

import { credentialFor, useForgeConnections } from "../../app/forgeConnections";
import { chooseDirectory, cx, joinPath, repositoryNameFromUrl } from "../../lib";
import { INTEGRATIONS, selfHostedHosts } from "../../lib/integrations";
import type { Integration } from "../../lib/integrations";
import type { CloneOptions, ForgeKind, ForgeRepository } from "../../lib/types";
import { ForgeConnectPanel } from "../forge";
import { Badge, Button, Modal, ModalSpacer } from "../ui";
import { ForgeRepositoryPicker } from "./ForgeRepositoryPicker";
import { CheckboxField, PathField, TextAreaField, TextInputField } from "./PathField";
import { SourceButton } from "./SourceButton";

const URL_SOURCE = "url";

// What a shallow clone fetches when the box is first ticked: the tip alone,
// which is the reason to ask for one.
const DEFAULT_DEPTH = "1";

// One directory per line, so a path with a space needs no quoting.
function sparseLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

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
  const [shallow, setShallow] = useState(false);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [sparse, setSparse] = useState(false);
  const [sparsePaths, setSparsePaths] = useState("");
  // Where the URL is coming from: typed in, or picked out of a connected
  // account. Typing one needs no account, so it stays the opening choice.
  const [source, setSource] = useState(URL_SOURCE);
  const [host, setHost] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const connections = useForgeConnections();

  const integration = INTEGRATIONS.find((entry) => entry.id === source);
  const hosts = integration ? selfHostedHosts(integration, overrides) : [];
  const selectedHost = host && hosts.includes(host) ? host : hosts[0] ?? null;
  // Where to put the clone is a question about a repository that has been
  // chosen. Until the service can offer one, the connection is the only thing
  // on the page.
  const ready = !integration || Boolean(selectedHost && credentialFor(connections, selectedHost));

  // The clone is named after the repository, the way Git names it on the
  // command line, so the page asks where it goes and nothing else.
  const derivedFolder = repositoryNameFromUrl(url);
  const destination = parent.trim() && derivedFolder ? joinPath(parent, derivedFolder) : "";
  // A depth of zero is not a shallower clone, it is Git refusing the command,
  // so the button waits for a usable number rather than reporting it after.
  // With no folder field left, an URL that names no repository has nowhere to
  // land, and the button would otherwise sit disabled without saying why.
  const destinationHint = destination
    || (url.trim() && !derivedFolder
      ? "This URL does not name a repository to clone into."
      : "Pick a folder to see where the clone lands.");
  const parsedDepth = Number.parseInt(depth.trim(), 10);
  const depthValid = !shallow || (Number.isFinite(parsedDepth) && parsedDepth > 0);
  const submittable = Boolean(url.trim() && destination) && depthValid && !busy;

  const selectRepository = (repository: ForgeRepository) => {
    setPicked(repository.full_name);
    setUrl(repository.clone_url);
  };

  const submit = () => {
    if (!submittable) return;
    onSubmit({
      url: url.trim(),
      destination,
      branch: null,
      depth: shallow ? parsedDepth : null,
      filter_blob_none: false,
      sparse_paths: sparse ? sparseLines(sparsePaths) : null,
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
              badge={entry.support === "links_only" ? <Badge>Coming soon</Badge> : null}
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

          {ready ? (
            <>
              <PathField
                hint={destinationHint}
                label="Where to clone to"
                onBrowse={() => {
                  void chooseDirectory("Choose destination folder").then((selected) => {
                    if (selected) setParent(selected);
                  });
                }}
                onChange={setParent}
                placeholder="Parent folder for the clone"
                value={parent}
              />
              <CheckboxField checked={shallow} label="Shallow clone" onChange={setShallow} />
              {shallow ? (
                <TextInputField
                  hint={depthValid
                    ? "Commits to fetch per branch, newest first."
                    : "Depth must be a whole number greater than zero."}
                  label="Depth"
                  onChange={setDepth}
                  placeholder={DEFAULT_DEPTH}
                  value={depth}
                />
              ) : null}
              <CheckboxField checked={sparse} label="Sparse checkout" onChange={setSparse} />
              {sparse ? (
                <TextAreaField
                  hint="One directory per line, relative to the repository root. Leave empty to check out the root files only."
                  label="Directories to check out"
                  onChange={setSparsePaths}
                  placeholder={"apps/desktop\ncrates/gitcat-core"}
                  value={sparsePaths}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/**
 * The repository list of one service, or the connection that has to come
 * first. The connection is offered here rather than in preferences, because
 * this is where the user asked for the repositories.
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
    return <ForgeConnectPanel host={null} integration={integration} />;
  }

  const credential = credentialFor(connections, selectedHost);

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

      {credential ? (
        <ForgeRepositoryPicker
          account={credential.account}
          host={selectedHost}
          onSelect={onSelect}
          selected={selected}
        />
      ) : (
        <ForgeConnectPanel host={selectedHost} integration={integration} />
      )}
    </div>
  );
}
