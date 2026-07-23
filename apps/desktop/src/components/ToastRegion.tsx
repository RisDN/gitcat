import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { cx } from "../lib";
import { IconButton } from "./ui";

export interface ToastMessage {
  id: string;
  tone: "success" | "error" | "info";
  title: string;
  detail?: string;
}

const ICONS = {
  success: <CheckCircle2 size={16} />,
  error: <AlertTriangle size={16} />,
  info: <Info size={16} />,
};

const TONE_BORDER = {
  success: "border-l-success",
  error: "border-l-danger",
  info: "border-l-accent",
} as const;

const TONE_TEXT = {
  success: "text-success",
  error: "text-danger",
  info: "text-accent",
} as const;

export function ToastRegion({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed bottom-9.75 right-3.5 z-400 flex w-[min(370px,calc(100vw-28px))] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          className={cx(
            "pointer-events-auto flex items-start gap-2.25 rounded-md border border-l-[3px] border-border bg-menu p-2.5 shadow-[0_12px_34px_rgb(0_0_0/35%)]",
            TONE_BORDER[toast.tone],
          )}
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <span className={cx("grid pt-px", TONE_TEXT[toast.tone])}>{ICONS[toast.tone]}</span>
          <div className="min-w-0 flex-1">
            <strong className="text-[12px]">{toast.title}</strong>
            {toast.detail ? <p className="mt-0.75 text-[10px] leading-[1.4] text-muted">{toast.detail}</p> : null}
          </div>
          <IconButton aria-label="Dismiss" className="size-5.5!" onClick={() => onDismiss(toast.id)}>
            <X size={14} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
