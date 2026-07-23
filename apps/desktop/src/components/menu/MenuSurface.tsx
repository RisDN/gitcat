import type { ComponentPropsWithRef } from "react";

import { cx } from "../../lib";

// Floating panel shared by the context menu and the toolbar dropdowns; callers
// add their own position, width and max-height.
export function MenuSurface({ className = "", ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cx("overflow-y-auto rounded-md border border-border bg-menu p-1.5 shadow-panel", className)}
      {...props}
    />
  );
}
