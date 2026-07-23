import type { ComponentPropsWithRef } from "react";

import { cx } from "../../lib";

export function MenuIcon({ className = "", ...props }: ComponentPropsWithRef<"span">) {
  return <span className={cx("grid w-4.25 shrink-0 place-items-center text-muted", className)} {...props} />;
}

export function MenuLabel({ className = "", ...props }: ComponentPropsWithRef<"span">) {
  return (
    <span
      className={cx("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap", className)}
      {...props}
    />
  );
}

export function MenuHeading({ className = "", ...props }: ComponentPropsWithRef<"p">) {
  return <p className={cx("uppercase text-muted", className)} {...props} />;
}

export function MenuNote({ className = "", ...props }: ComponentPropsWithRef<"small">) {
  return <small className={cx("leading-[1.45] text-muted", className)} {...props} />;
}

// `filled` distinguishes the conflict menu's solid dot from the pull menu's ring.
export function MenuRadio({
  checked,
  className = "",
  filled = false,
}: {
  checked: boolean;
  className?: string;
  filled?: boolean;
}) {
  return (
    <i
      aria-hidden="true"
      className={cx(
        "shrink-0 rounded-full",
        checked ? "border-accent" : "border-muted",
        checked && filled && "bg-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--gc-accent)_18%,transparent)]",
        className,
      )}
    />
  );
}
