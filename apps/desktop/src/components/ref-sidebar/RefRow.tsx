import { CircleDot, FolderGit, GitPullRequest, GitPullRequestDraft } from "lucide-react";
import { useState } from "react";
import type { ComponentPropsWithRef, MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { cx } from "../../lib";
import type { CheckState, CheckSummary, PullRequestInfo } from "../../lib/types";

const ENTRY = "flex min-h-7.5 min-w-0 flex-1 items-center bg-transparent pr-1.25 text-left text-foreground";

const NAME = "overflow-hidden text-ellipsis whitespace-nowrap";

// `current` wins over hover so the checked-out branch keeps its highlight while
// the pointer moves across it.
export function RefRow({ current = false, hoverable = true, children, onContextMenu }: {
  current?: boolean;
  hoverable?: boolean;
  children: ReactNode;
  onContextMenu?: (event: ReactMouseEvent) => void;
}) {
  return (
    <div
      className={cx(
        "relative flex min-w-0 items-center rounded",
        current ? "bg-success/14" : hoverable && "hover:bg-foreground/5",
      )}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}

// Checkout target: the whole row is the button, indentation comes from the caller.
export function RefButton({ className = "", ...props }: ComponentPropsWithRef<"button">) {
  return <button className={cx(ENTRY, "cursor-pointer", className)} type="button" {...props} />;
}

// Non-interactive row (remote group header, tag) with the same metrics.
export function RefStatic({ className = "", ...props }: ComponentPropsWithRef<"span">) {
  return <span className={cx(ENTRY, NAME, "cursor-default select-none", className)} {...props} />;
}

export function RefName({ children }: { children: string }) {
  return <span className={NAME}>{children}</span>;
}

export function RefCounter({ children }: { children: string }) {
  return <small className="ml-auto text-[10px] text-muted">{children}</small>;
}

export function TagNode() {
  return (
    <span className="size-2 shrink-0 rotate-45 rounded-[2px_50%_50%_2px] border-2 border-success bg-surface shadow-[0_0_0_2px_color-mix(in_srgb,var(--gc-accent)_13%,transparent)]" />
  );
}

// Falls back to a generic icon when the remote host has no usable favicon.
export function RemoteIcon({ iconUrl }: { iconUrl?: string }) {
  const [failed, setFailed] = useState(false);
  if (!iconUrl || failed) return <FolderGit className="shrink-0 text-muted" size={13} />;
  return (
    <img
      alt=""
      aria-hidden="true"
      className="size-3.5 shrink-0 rounded-[3px] object-cover"
      onError={() => setFailed(true)}
      src={iconUrl}
    />
  );
}

// A check badge is a state, not a score: the counts belong in the tooltip so a
// narrow row still reads at a glance.
const CHECK_TONES: Record<Exclude<CheckState, "none">, string> = {
  success: "text-success",
  failure: "text-danger",
  pending: "text-warning",
  neutral: "text-muted",
};

function checkTitle({ state, total, failed, pending }: CheckSummary): string {
  if (state === "failure") return `${failed} of ${total} checks failing`;
  if (state === "pending") return `${pending} of ${total} checks running`;
  if (state === "neutral") return `${total} checks reported nothing conclusive`;
  return `${total} checks passing`;
}

export function CheckBadge({ summary }: { summary: CheckSummary }) {
  if (summary.state === "none") return null;
  return (
    <span
      className={cx("shrink-0", CHECK_TONES[summary.state])}
      title={checkTitle(summary)}
    >
      <CircleDot aria-label={checkTitle(summary)} size={11} strokeWidth={2.5} />
    </span>
  );
}

// Only open pull requests reach a branch row, but a draft is drawn apart from
// one that is ready: they mean different things to the person looking at it.
export function PullRequestBadge({
  pull,
  onOpen,
}: {
  pull: PullRequestInfo;
  onOpen?: (pull: PullRequestInfo) => void;
}) {
  const Icon = pull.state === "draft" ? GitPullRequestDraft : GitPullRequest;
  const label = `#${pull.number} ${pull.title}`;
  return (
    <button
      className={cx(
        "flex shrink-0 items-center gap-0.75 rounded px-1 py-0.25 text-[10px] hover:bg-foreground/8",
        pull.state === "draft" ? "text-muted" : "text-accent",
        onOpen ? "cursor-pointer" : "cursor-default",
      )}
      disabled={!onOpen}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.(pull);
      }}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={11} />
      {pull.number}
    </button>
  );
}
