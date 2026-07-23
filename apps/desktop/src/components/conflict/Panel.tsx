import type { ReactNode } from "react";

import { cx } from "../../lib";
import type { ConflictFileContent } from "../../lib/types";

// Bordered box shared by the two side panes and the result editor.
export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cx("min-w-0 overflow-hidden rounded-md border border-border bg-background", className)}>
      {children}
    </section>
  );
}

export function PanelHeader({ className = "", children }: { className?: string; children: ReactNode }) {
  return <header className={cx("border-b border-border bg-panel/74", className)}>{children}</header>;
}

export function contentMessage(content: ConflictFileContent): string {
  switch (content.kind) {
    case "missing": return "File does not exist on this side.";
    case "binary": return `Binary content${content.size === undefined ? "" : ` · ${content.size} bytes`}.`;
    case "too_large": return `Content is too large for the built-in editor${content.size === undefined ? "" : ` · ${content.size} bytes`}.`;
    case "text": return "Text content unavailable.";
  }
}
