import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "../../lib";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  compact?: boolean;
  tone?: "default" | "accent" | "danger";
};

const TONE = {
  default:
    "border-border bg-control text-foreground enabled:hover:border-border-strong enabled:hover:bg-control-hover",
  accent:
    "border-accent bg-accent text-[#07161b] enabled:hover:border-[color-mix(in_srgb,var(--gc-accent)_82%,white)] enabled:hover:bg-[color-mix(in_srgb,var(--gc-accent)_82%,white)]",
  danger:
    "border-[color-mix(in_srgb,var(--gc-danger)_60%,var(--gc-border))] bg-control text-danger enabled:hover:border-danger enabled:hover:bg-[color-mix(in_srgb,var(--gc-danger)_13%,var(--gc-panel))]",
} as const;

export function Button({
  icon,
  children,
  compact = false,
  tone = "default",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex min-h-8.5 cursor-pointer items-center justify-center gap-2 rounded-[5px] border px-3.25 font-semibold transition-[background-color,border-color,transform] duration-110 ease-out enabled:active:translate-y-px",
        TONE[tone],
        compact && "min-h-7.5 px-2.5 text-[12px]",
        className,
      )}
      type="button"
      {...props}
    >
      {icon ? <span className="inline-grid place-items-center">{icon}</span> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}
