import { LoaderCircle } from "lucide-react";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span
      className="inline-grid place-items-center text-accent [&>svg]:animate-orbit"
      role="status"
      aria-label={label}
    >
      <LoaderCircle aria-hidden="true" size={16} />
    </span>
  );
}
