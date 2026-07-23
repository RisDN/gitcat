import type { ReactNode } from "react";

import { cx } from "../../lib";

export const FIELD_INPUT =
  "h-8.5 w-full rounded-[5px] border border-border bg-background px-2.25 outline-0 focus:border-accent";

export function SectionHeading({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <h3 className={cx("mb-3 mt-6.25 text-[11px] uppercase tracking-[0.07em] text-foreground first:mt-0.5", className)}>
      {children}
    </h3>
  );
}

// Label above a full-width control; `hint` renders right-aligned next to it.
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-3.25 flex flex-col gap-1.5 text-[11px] text-muted">
      <span className="flex justify-between">
        {label}
        {hint ? <small className="text-muted/72">{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}

export function CheckField({ checked, children, onChange }: {
  checked: boolean;
  children: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-1.75 text-[11px] leading-[1.4] text-muted">
      <input
        checked={checked}
        className="mt-0.5 accent-accent"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {children}
    </label>
  );
}
