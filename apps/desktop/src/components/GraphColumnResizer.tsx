import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

const KEYBOARD_STEP = 8;

// Drag handle sitting on the right edge of a commit list column header. The
// last visible column has none: it absorbs whatever the others leave behind.
export function GraphColumnResizer({
  label,
  width,
  minWidth,
  maxWidth,
  onResize,
  onResizeStart,
  onResizeEnd,
}: {
  label: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}) {
  const dragging = useRef(false);
  const frame = useRef(0);
  const pending = useRef(0);

  const clamp = (value: number) => Math.max(minWidth, Math.min(maxWidth, Math.round(value)));

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragging.current) return;

    event.preventDefault();
    event.stopPropagation();
    dragging.current = true;
    onResizeStart?.();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    // Pointer events can outpace the frame rate; resizing more than once per
    // frame only throws the extra layouts away. The newest position always
    // wins, so a fast drag still ends exactly under the cursor.
    const move = (moveEvent: PointerEvent) => {
      pending.current = clamp(startWidth + moveEvent.clientX - startX);
      if (frame.current) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0;
        onResize(pending.current);
      });
    };
    const end = () => {
      dragging.current = false;
      if (frame.current) {
        window.cancelAnimationFrame(frame.current);
        onResize(pending.current);
      }
      frame.current = 0;
      handle.releasePointerCapture?.(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      onResizeEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEYBOARD_STEP * 4 : KEYBOARD_STEP;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        onResize(clamp(width - step));
        break;
      case "ArrowRight":
        event.preventDefault();
        onResize(clamp(width + step));
        break;
      case "Home":
        event.preventDefault();
        onResize(minWidth);
        break;
      case "End":
        event.preventDefault();
        onResize(maxWidth);
        break;
      default:
        break;
    }
  };

  // A graph column whose lanes already all fit has nothing left to give: it
  // still draws the divider, but there is no range to drag through.
  if (maxWidth <= minWidth) {
    return <div aria-hidden="true" className="gc-graph-columns__handle gc-graph-columns__handle--fixed" />;
  }

  return (
    <div
      aria-label={`Resize ${label} column`}
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={minWidth}
      aria-valuenow={width}
      className="gc-graph-columns__handle"
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onPointerDown={beginDrag}
      role="separator"
      tabIndex={0}
    />
  );
}
