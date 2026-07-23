import type { ReactNode } from "react";

import { cx } from "../../lib";

interface ToolbarActionProps {
  accent?: boolean;
  count?: number;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  title?: string;
}

// Label hides below 1080px, leaving an icon-only button.
export function ToolbarAction({ accent = false, count, disabled = false, icon, label, onClick, title }: ToolbarActionProps) {
  return (
    <button
      className={cx(
        "group flex min-w-13.5 cursor-pointer flex-col items-center justify-center gap-0.75 rounded-[5px] bg-transparent px-2 py-1",
        "transition-[background-color,color,transform] duration-110 ease-out",
        "enabled:hover:bg-row-hover enabled:active:translate-y-px",
        "disabled:cursor-default disabled:text-muted disabled:opacity-55",
        "max-[1080px]:min-w-8.5 max-[1080px]:p-0",
        accent ? "text-accent" : "text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      <span className="text-[11px] font-semibold leading-none tracking-[0.01em] max-[1080px]:hidden">
        {label}
      </span>
      <span
        className={cx(
          "relative grid place-items-center",
          accent
            ? "text-accent"
            : "text-[color-mix(in_srgb,var(--gc-text)_78%,var(--gc-muted))] group-[:enabled:hover]:text-foreground",
        )}
      >
        {icon}
        {count ? (
          <b className="absolute -right-2.25 -top-1.25 grid h-3.5 min-w-3.5 place-items-center rounded-[7px] bg-accent px-0.75 font-mono text-[8px] font-extrabold leading-none text-[#07161b]">
            {count > 99 ? "99+" : count}
          </b>
        ) : null}
      </span>
    </button>
  );
}
