import { useState } from "react";

import { chooseDirectory, joinPath, repositoryNameFromUrl } from "../../lib";
import type { CloneOptions } from "../../lib/types";
import { Button, Modal, ModalSpacer } from "../ui";
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

  const derivedFolder = folder.trim() || repositoryNameFromUrl(url);
  const destination = parent.trim() && derivedFolder ? joinPath(parent, derivedFolder) : "";
  const submittable = Boolean(url.trim() && destination) && !busy;

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
        <TextInputField
          label="Remote URL"
          onChange={setUrl}
          placeholder="https://github.com/owner/repository.git"
          value={url}
        />
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
