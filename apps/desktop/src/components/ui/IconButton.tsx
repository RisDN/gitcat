import type { ButtonHTMLAttributes } from "react";

import { cx } from "../../lib";

// Call sites that need a different size or tone override with `!` utilities,
// since Tailwind class order alone would not decide the winner.
export function IconButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        "inline-grid size-7.5 shrink-0 cursor-pointer place-items-center rounded-[5px] border border-transparent bg-transparent p-0 text-muted",
        "enabled:hover:border-border/75 enabled:hover:bg-foreground/7 enabled:hover:text-foreground",
        className,
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
