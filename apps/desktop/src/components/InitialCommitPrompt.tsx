import { Button } from "./ui";

// Git has no branch until something is committed on it, so a repository with an
// unborn HEAD has nothing to draw and nothing to build on. The offer sits in a
// bar above the history rather than in the empty graph itself: it is a question
// about the repository rather than about a row. Staging files in the working
// tree panel and committing there is the other way out of this state, so the
// bar states the offer and leaves it at that.
export function InitialCommitPrompt({
  busy,
  onInitialize,
  repositoryName,
  stagedCount,
}: {
  busy: boolean;
  onInitialize: () => void;
  repositoryName: string;
  stagedCount: number;
}) {
  const offer = stagedCount > 0
    ? `Do you want GitCat to commit the ${stagedCount} staged file${stagedCount === 1 ? "" : "s"} as that commit?`
    : "Do you want GitCat to make a commit for you? It writes a README.md named after the repository.";

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-[color-mix(in_srgb,var(--gc-accent)_10%,var(--gc-panel))] px-3.5 py-2"
      role="status"
    >
      <p className="min-w-0 flex-1 text-[12px] leading-[1.5]">
        Repository <span className="font-semibold">{repositoryName}</span> has no commits yet. {offer}
      </p>
      <Button compact disabled={busy} onClick={onInitialize} tone="accent">
        Initialize
      </Button>
    </div>
  );
}
