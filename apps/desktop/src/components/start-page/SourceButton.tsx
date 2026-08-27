import type { ReactNode } from "react";

import { cx } from "../../lib";

/**
 * One row of the service list the clone and initialize dialogs open with.
 *
 * A connected service is marked rather than described: the list is a choice,
 * and what a connection means belongs on the panel it opens.
 */
export function SourceButton({
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
