import { FolderGit } from "lucide-react";
import { useState } from "react";
import type { ComponentPropsWithRef, MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { cx } from "../../lib";

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
      className="size-3.5 shrink-0 rounded-[3px] object-cover shadow-[0_0_0_1px_color-mix(in_srgb,var(--gc-text)_18%,transparent)]"
      onError={() => setFailed(true)}
      src={iconUrl}
    />
  );
}
