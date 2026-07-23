import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cx } from "../../lib";
import { IconButton } from "./IconButton";

const WIDTH = {
  small: "w-[min(430px,100%)]",
  medium: "w-[min(570px,100%)]",
  large: "w-[min(840px,100%)]",
  wide: "w-[min(1180px,100%)]",
} as const;

// Pushes the confirm/cancel pair to the right edge of a modal footer.
export function ModalSpacer() {
  return <span className="flex-1" />;
}

export function Modal({
  title,
  description,
  children,
  onClose,
  footer,
  width = "medium",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: keyof typeof WIDTH;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-300 grid place-items-center bg-[rgb(4_7_11/72%)] p-6 backdrop-blur-[5px]"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        aria-describedby={description ? "gc-modal-description" : undefined}
        aria-labelledby="gc-modal-title"
        aria-modal="true"
        className={cx(
          "flex max-h-[min(760px,calc(100vh-48px))] flex-col rounded-[9px] border border-[color-mix(in_srgb,var(--gc-border)_85%,white_5%)] bg-menu shadow-panel",
          WIDTH[width],
        )}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4.25 py-4">
          <div>
            <h2 className="text-[17px]" id="gc-modal-title">
              {title}
            </h2>
            {description ? (
              <p className="mt-1.25 text-[11px] text-muted" id="gc-modal-description">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </header>
        <div className="min-h-0 overflow-auto p-4.25">{children}</div>
        {footer ? (
          <footer className="flex shrink-0 items-center gap-1.75 border-t border-border bg-background/32 px-4.25 py-2.75">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>
  );
}
