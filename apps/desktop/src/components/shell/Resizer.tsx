import type { PointerEvent as ReactPointerEvent } from "react";

// Drag handle between workspace columns; the wide ::after keeps the hit area
// comfortable without widening the visible line.
export function Resizer({ hidden, onPointerDown }: {
  hidden: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      aria-hidden="true"
      className="relative z-8 touch-none cursor-col-resize bg-border after:absolute after:inset-y-0 after:-left-0.75 after:w-2.75 after:content-[''] hover:bg-accent active:bg-accent"
      hidden={hidden}
      onPointerDown={onPointerDown}
    />
  );
}
