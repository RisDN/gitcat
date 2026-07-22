import { FolderGit2, GitBranch, SearchCode } from "lucide-react";

import { Button } from "./Primitives";

export function WelcomeView({ onOpen, openKeybind }: { onOpen: () => void; openKeybind: string }) {
  return (
    <main className="gc-welcome">
      <div className="gc-welcome__rail" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <section className="gc-welcome__content">
        <span className="gc-eyebrow">LOCAL-FIRST GIT CLIENT</span>
        <h1>Repository history,<br />without the noise.</h1>
        <p>Open a working tree. GitCat keeps credentials, hooks, SSH, and Git behavior where they belong: in system Git.</p>
        <Button icon={<FolderGit2 size={17} />} onClick={onOpen} tone="accent">
          Open repository
        </Button>
        <div className="gc-welcome__features">
          <span><GitBranch size={15} /> Visual branch graph</span>
          <span><SearchCode size={15} /> Subject + description search</span>
        </div>
      </section>
      <kbd>{openKeybind || "Unassigned"}</kbd>
    </main>
  );
}
