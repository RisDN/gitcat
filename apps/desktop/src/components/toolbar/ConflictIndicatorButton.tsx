import { AlertTriangle, GitMerge, LoaderCircle, ShieldCheck } from "lucide-react";

import { cx } from "../../lib";
import { IconButton } from "../ui";

export interface ConflictIndicator {
  state: "checking" | "clean" | "conflicting" | "active" | "unavailable";
  label: string;
  count?: number;
}

// `!` overrides IconButton's own text colour, which would otherwise win by order.
const TONE: Record<ConflictIndicator["state"], string> = {
  checking: "text-muted!",
  clean: "text-success!",
  conflicting: "text-warning!",
  active: "text-danger!",
  unavailable: "text-muted/55!",
};

export const CONFLICT_STATUS_TONE: Record<ConflictIndicator["state"], string> = {
  checking: "text-foreground",
  clean: "text-success",
  conflicting: "text-warning",
  active: "text-danger",
  unavailable: "text-foreground",
};

export function ConflictIndicatorButton({
  expanded,
  indicator,
  onClick,
}: {
  expanded: boolean;
  indicator: ConflictIndicator;
  onClick: () => void;
}) {
  return (
    <IconButton
      aria-expanded={expanded}
      aria-haspopup="menu"
      aria-label={indicator.label}
      className={cx("relative", TONE[indicator.state])}
      onClick={onClick}
      title={indicator.label}
    >
      {indicator.state === "checking" ? <LoaderCircle aria-hidden="true" className="animate-orbit" size={18} /> : null}
      {indicator.state === "clean" ? <ShieldCheck aria-hidden="true" size={18} /> : null}
      {indicator.state === "conflicting" || indicator.state === "active" ? <AlertTriangle aria-hidden="true" size={18} /> : null}
      {indicator.state === "unavailable" ? <GitMerge aria-hidden="true" size={18} /> : null}
      {indicator.count ? (
        <b className="absolute right-0 top-px grid h-3.25 min-w-3.25 place-items-center rounded-[7px] border border-current bg-background px-0.75 font-mono text-[8px] font-extrabold leading-none text-current">
          {indicator.count}
        </b>
      ) : null}
    </IconButton>
  );
}
