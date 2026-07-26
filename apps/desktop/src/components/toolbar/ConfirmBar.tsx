import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { cx } from "../../lib";
import { Button } from "../ui";

interface ConfirmBarProps {
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmBar({
  message,
  confirmLabel,
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmBarProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  return (
    <header
      aria-label="Confirm action"
      className={cx(
        "z-15 flex min-h-15.25 flex-[0_0_61px] items-center justify-center gap-3 border-b px-3 py-2",
        danger
          ? "border-[color-mix(in_srgb,var(--gc-danger)_37%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-danger)_10%,var(--gc-panel))]"
          : "border-[color-mix(in_srgb,var(--gc-warning)_37%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-warning)_9%,var(--gc-panel))]",
      )}
      role="alertdialog"
    >
      <AlertTriangle
        aria-hidden="true"
        className={danger ? "shrink-0 text-danger" : "shrink-0 text-warning"}
        size={16}
      />
      <p className="min-w-0 text-[12px] leading-[1.35] text-foreground">{message}</p>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button autoFocus compact onClick={onConfirm} tone={danger ? "danger" : "accent"}>
          {confirmLabel}
        </Button>
        <Button compact onClick={onCancel}>Cancel</Button>
      </div>
    </header>
  );
}
