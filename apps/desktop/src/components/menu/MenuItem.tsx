import type { ComponentPropsWithRef } from "react";

import { cx } from "../../lib";

const SEPARATOR = "mt-1.25 rounded-b border-t border-border pt-2.25";

// Each menu in the app grew its own row metrics; the density picks between them.
const DENSITY = {
  default: "w-full min-h-7.75 gap-2.25 px-2 py-1.25",
  dense: "min-h-7.75 gap-2 px-2 py-1.25",
  roomy: "w-full gap-2.25 p-2",
} as const;

export function MenuItem({
  className = "",
  danger = false,
  density = "default",
  separatorBefore = false,
  ...props
}: ComponentPropsWithRef<"button"> & {
  danger?: boolean;
  density?: keyof typeof DENSITY;
  separatorBefore?: boolean;
}) {
  return (
    <button
      className={cx(
        "flex cursor-pointer items-center rounded bg-transparent text-left text-foreground",
        "focus:outline-none focus-visible:outline-none enabled:hover:bg-row-hover enabled:focus-visible:bg-row-hover",
        DENSITY[density],
        separatorBefore && SEPARATOR,
        danger && "text-danger",
        className,
      )}
      type="button"
      {...props}
    />
  );
}

// Anchors a submenu to its trigger, and carries the separator when the trigger
// itself starts a section.
export function MenuItemHost({
  className = "",
  separatorBefore = false,
  ...props
}: ComponentPropsWithRef<"div"> & { separatorBefore?: boolean }) {
  return <div className={cx("relative", separatorBefore && SEPARATOR, className)} {...props} />;
}
