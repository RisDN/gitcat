import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect } from "react";
import { LoaderCircle, X } from "lucide-react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  compact?: boolean;
  tone?: "default" | "accent" | "danger";
};

export function Button({
  icon,
  children,
  compact = false,
  tone = "default",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`gc-button gc-button--${tone} ${compact ? "gc-button--compact" : ""} ${className}`}
      type="button"
      {...props}
    >
      {icon ? <span className="gc-button__icon">{icon}</span> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`gc-icon-button ${className}`} type="button" {...props}>
      {children}
    </button>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="gc-spinner" role="status" aria-label={label}>
      <LoaderCircle aria-hidden="true" size={16} />
    </span>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: string }) {
  return <span className={`gc-badge gc-badge--${tone}`}>{children}</span>;
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
  width?: "small" | "medium" | "large";
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="gc-modal-layer" role="presentation" onMouseDown={onClose}>
      <section
        aria-describedby={description ? "gc-modal-description" : undefined}
        aria-labelledby="gc-modal-title"
        aria-modal="true"
        className={`gc-modal gc-modal--${width}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="gc-modal__header">
          <div>
            <h2 id="gc-modal-title">{title}</h2>
            {description ? <p id="gc-modal-description">{description}</p> : null}
          </div>
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </header>
        <div className="gc-modal__body">{children}</div>
        {footer ? <footer className="gc-modal__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
