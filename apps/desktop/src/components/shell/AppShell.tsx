import type { ReactNode } from "react";

import { cx } from "../../lib";

// Window-sized root: the min sizes keep the three-pane layout from collapsing.
export function AppShell({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "isolate flex size-full min-h-135 min-w-205 flex-col overflow-hidden bg-[radial-gradient(circle_at_78%_-15%,color-mix(in_srgb,var(--gc-accent)_5%,transparent),transparent_34%),var(--gc-background)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
