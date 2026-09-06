import type { ReactNode } from "react";

import { cx } from "../../lib";

/**
 * One row of the service list the clone and initialize dialogs open with.
 *
 * The row carries no connection mark. Whether a credential works is only
 * known once something has been asked of the service, so a mark drawn from
 * what is merely stored can sit there saying the opposite of the panel beside
 * it. What a connection means belongs on the panel the row opens.
 */
export function SourceButton({
  active,
  badge = null,
  disabled = false,
  icon,
  label,
  onClick,
  title,
}: {
  active: boolean;
  badge?: ReactNode;
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
      {badge}
    </button>
  );
}
