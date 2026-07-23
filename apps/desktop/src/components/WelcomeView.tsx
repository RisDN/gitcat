import { FolderGit2, GitBranch, SearchCode } from "lucide-react";

import { Button } from "./ui";

function RailDot({ className }: { className: string }) {
  return (
    <i className={`absolute right-12.5 z-2 size-3.75 rounded-full border-[3px] border-accent bg-background ${className}`} />
  );
}

export function WelcomeView({ onOpen, openKeybind }: { onOpen: () => void; openKeybind: string }) {
  return (
    <main className="relative grid min-h-0 flex-1 grid-cols-[minmax(80px,1fr)_minmax(460px,740px)_minmax(80px,1fr)] items-center overflow-hidden before:absolute before:inset-0 before:bg-[linear-gradient(color-mix(in_srgb,var(--gc-border)_24%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--gc-border)_24%,transparent)_1px,transparent_1px)] before:bg-size-[42px_42px] before:opacity-45 before:content-[''] before:mask-[radial-gradient(circle_at_50%_50%,black,transparent_72%)]">
      <div
        className="relative z-1 h-85 w-25 justify-self-end before:absolute before:inset-y-0 before:right-14 before:w-0.75 before:rounded-[3px] before:bg-[linear-gradient(var(--gc-accent),var(--gc-lane-1))] before:content-[''] after:absolute after:bottom-16.25 after:right-5 after:top-21.25 after:w-0.75 after:rounded-[3px] after:bg-lane-1 after:content-['']"
        aria-hidden="true"
      >
        <RailDot className="top-6.25" />
        <RailDot className="top-39" />
        <RailDot className="bottom-6.25 border-lane-1" />
      </div>
      <section className="relative z-2 border-l border-[color-mix(in_srgb,var(--gc-accent)_35%,var(--gc-border))] px-17.5 py-15 max-[1080px]:px-8.75">
        <span className="font-mono text-[10px] font-bold leading-[1.2] tracking-[0.14em] text-accent">
          LOCAL-FIRST GIT CLIENT
        </span>
        <h1 className="my-4 text-[clamp(38px,5vw,67px)] font-[640] leading-[0.98] tracking-[-0.055em]">
          Repository history,<br />without the noise.
        </h1>
        <p className="mb-7 max-w-140 text-[15px] leading-[1.65] text-muted">
          Open a working tree. GitCat keeps credentials, hooks, SSH, and Git behavior where they belong: in system Git.
        </p>
        <Button icon={<FolderGit2 size={17} />} onClick={onOpen} tone="accent">
          Open repository
        </Button>
        <div className="mt-6.75 flex flex-wrap gap-4.5 text-[11px] text-muted [&_svg]:text-accent">
          <span className="flex items-center gap-1.5"><GitBranch size={15} /> Visual branch graph</span>
          <span className="flex items-center gap-1.5"><SearchCode size={15} /> Subject + description search</span>
        </div>
      </section>
      <kbd className="absolute bottom-5.5 right-6 z-2 rounded border border-b-2 border-border px-2 py-1.25 text-[10px] text-muted">
        {openKeybind || "Unassigned"}
      </kbd>
    </main>
  );
}
