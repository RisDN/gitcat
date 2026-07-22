import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { IconButton } from "./Primitives";

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

export function ToastRegion({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  return (
    <div aria-live="polite" aria-relevant="additions" className="gc-toasts">
      {toasts.map((toast) => (
        <div className={`gc-toast gc-toast--${toast.tone}`} key={toast.id} role={toast.tone === "error" ? "alert" : "status"}>
          <span>{ICONS[toast.tone]}</span>
          <div><strong>{toast.title}</strong>{toast.detail ? <p>{toast.detail}</p> : null}</div>
          <IconButton aria-label="Dismiss" onClick={() => onDismiss(toast.id)}><X size={14} /></IconButton>
        </div>
      ))}
    </div>
  );
}
