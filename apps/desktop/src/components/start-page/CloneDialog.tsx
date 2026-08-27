import { Cloud, Link2 } from "lucide-react";
import { useEffect, useState } from "react";

import { chooseDirectory, cx, joinPath, repositoryNameFromUrl } from "../../lib";
import { forgeCredentials } from "../../lib/avatars";
import type { CloneOptions, ForgeRepository } from "../../lib/types";
import { Button, Modal, ModalSpacer } from "../ui";
import { ForgeRepositoryPicker } from "./ForgeRepositoryPicker";
import { PathField, TextInputField } from "./PathField";

export function CloneDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (options: CloneOptions) => void;
}) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [folder, setFolder] = useState("");
  const [branch, setBranch] = useState("");
  // Which source the URL is coming from: typed in, or picked from a signed-in
  // account. `null` is the typed-in case, so no sign-in is needed to clone.
  const [source, setSource] = useState<string | null>(null);
  const [hosts, setHosts] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    forgeCredentials()
      .then((credentials) => {
        if (!cancelled) setHosts(credentials.map((credential) => credential.host));
      })
      .catch(() => { /* no credentials means only the URL source is offered */ });
    return () => { cancelled = true; };
  }, []);

  const derivedFolder = folder.trim() || repositoryNameFromUrl(url);
  const destination = parent.trim() && derivedFolder ? joinPath(parent, derivedFolder) : "";
  const submittable = Boolean(url.trim() && destination) && !busy;

  const selectRepository = (repository: ForgeRepository) => {
    setPicked(repository.full_name);
    setUrl(repository.clone_url);
    // The folder follows the repository until the user names one themselves.
    if (!folder.trim()) setFolder("");
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
      title="Clone repository"
      width="medium"
    >
      <div className="flex flex-col gap-3.5">
        {hosts.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <SourceTab active={source === null} onClick={() => setSource(null)}>
              <Link2 size={13} /> URL
            </SourceTab>
            {hosts.map((host) => (
              <SourceTab active={source === host} key={host} onClick={() => setSource(host)}>
                <Cloud size={13} /> {host}
              </SourceTab>
            ))}
          </div>
        ) : null}

        {source === null ? (
          <TextInputField
            label="Remote URL"
            onChange={setUrl}
            placeholder="https://github.com/owner/repository.git"
            value={url}
          />
        ) : (
          <ForgeRepositoryPicker host={source} onSelect={selectRepository} selected={picked} />
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
    </Modal>
  );
}

function SourceTab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cx(
        "flex cursor-pointer items-center gap-1.25 rounded-[5px] border px-2 py-1 text-[11px]",
        active
          ? "border-accent bg-accent/12 text-foreground"
          : "border-border text-muted hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
