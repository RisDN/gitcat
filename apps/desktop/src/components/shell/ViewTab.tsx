import type { ReactNode } from "react";

import { cx } from "../../lib";

export function ViewTabs({ children }: { children: ReactNode }) {
  return <div className="flex self-stretch">{children}</div>;
}

export function ViewTab({ active, children, disabled, onClick }: {
  active: boolean;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cx(
        "relative min-w-14 cursor-pointer bg-transparent px-2.5 text-[11px] font-bold uppercase",
        active
          ? "text-accent after:absolute after:inset-x-1.75 after:bottom-0 after:h-0.5 after:bg-accent after:content-['']"
          : "text-muted enabled:hover:text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
