import { GitCommitHorizontal } from "lucide-react";
import { useId } from "react";
import type { ReactNode } from "react";

export function ShaBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-9.25 flex-[0_0_37px] items-center gap-1.5 border-b border-border px-2.75 text-[10px] text-muted">
      <GitCommitHorizontal size={14} />
      {children}
    </div>
  );
}

// The short SHA is the copy control; the hover tooltip exposes the full oid.
export function ShaCopy({ oid, shortOid, onCopy }: { oid: string; shortOid: string; onCopy: () => void }) {
  const tooltipId = useId();
  return (
    <span className="group/sha relative inline-flex min-w-0">
      <button
        aria-describedby={tooltipId}
        aria-label={`Copy full commit SHA ${oid}`}
        className="cursor-pointer rounded-[3px] bg-transparent px-0.75 py-0.5 text-accent hover:bg-accent/11 hover:text-[color-mix(in_srgb,var(--gc-accent)_82%,white)]"
        onClick={onCopy}
        type="button"
      >
        <code>{shortOid}</code>
      </button>
      <span
        className="invisible pointer-events-none absolute -left-7.25 top-[calc(100%+7px)] z-90 flex w-[min(276px,calc(100vw-24px))] -translate-y-0.75 flex-col gap-1.25 rounded-[5px] border border-[color-mix(in_srgb,var(--gc-border)_82%,white_5%)] bg-menu px-2.25 py-2 opacity-0 shadow-panel transition-[opacity,transform] duration-90 before:absolute before:-top-1.25 before:left-8.75 before:size-2 before:rotate-45 before:border-l before:border-t before:border-border before:bg-menu before:content-[''] group-hover/sha:visible group-hover/sha:translate-y-0 group-hover/sha:opacity-100 group-focus-within/sha:visible group-focus-within/sha:translate-y-0 group-focus-within/sha:opacity-100"
        id={tooltipId}
        role="tooltip"
      >
        <code className="whitespace-normal text-[10px] leading-[1.45] text-foreground wrap-anywhere">{oid}</code>
        <small className="text-[9px] text-muted">Click to copy</small>
      </span>
    </span>
  );
}
