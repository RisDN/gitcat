import type { ComponentPropsWithRef } from "react";

import { cx } from "../../lib";

// Fills a workspace column: the three-pane layout sizes the slot, the panel fills it.
export function SidePanel({ className = "", ...props }: ComponentPropsWithRef<"aside">) {
  return (
    <aside className={cx("flex size-full min-h-0 min-w-0 flex-col overflow-auto bg-sunken", className)} {...props} />
  );
}
