import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { DiffMap, MarkKind } from "./rows";

const MARK_BACKGROUND: Record<MarkKind, string> = {
  addition: "color-mix(in srgb, var(--gc-success) 82%, transparent)",
  deletion: "color-mix(in srgb, var(--gc-danger) 82%, transparent)",
  change:
    "linear-gradient(to right, color-mix(in srgb, var(--gc-danger) 82%, transparent) 0 50%, color-mix(in srgb, var(--gc-success) 82%, transparent) 50% 100%)",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function DiffMinimap({ map, scrollRef }: {
  map: DiffMap;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef(0);
  const pendingClientYRef = useRef<number | null>(null);
  const frameRef = useRef(0);

  const syncThumb = useCallback(() => {
    const scroller = scrollRef.current;
    const thumb = thumbRef.current;
    if (!scroller || !thumb) return;

    const total = scroller.scrollHeight || 1;
    thumb.style.top = `${clamp(scroller.scrollTop / total, 0, 1) * 100}%`;
    thumb.style.height = `max(6px, ${clamp(scroller.clientHeight / total, 0, 1) * 100}%)`;
  }, [scrollRef]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    syncThumb();
    scroller.addEventListener("scroll", syncThumb, { passive: true });
    const observer = new ResizeObserver(syncThumb);
    observer.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", syncThumb);
      observer.disconnect();
    };
  }, [map, scrollRef, syncThumb]);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  const pointerFraction = useCallback((clientY: number): number | null => {
    const track = trackRef.current;
    if (!track) return null;

    const rect = track.getBoundingClientRect();
    if (rect.height === 0) return null;
    return clamp((clientY - rect.top) / rect.height, 0, 1);
  }, []);

  const applyPendingScroll = useCallback(() => {
    frameRef.current = 0;
    const clientY = pendingClientYRef.current;
    const scroller = scrollRef.current;
    if (clientY === null || !scroller) return;
    pendingClientYRef.current = null;

    const fraction = pointerFraction(clientY);
    if (fraction === null) return;

    const total = scroller.scrollHeight || 1;
    const thumb = clamp(scroller.clientHeight / total, 0, 1);
    const top = clamp(fraction - dragOffsetRef.current, 0, Math.max(0, 1 - thumb));
    scroller.scrollTop = top * total;
    syncThumb();
  }, [pointerFraction, scrollRef, syncThumb]);

  const queueScroll = useCallback((clientY: number) => {
    pendingClientYRef.current = clientY;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(applyPendingScroll);
  }, [applyPendingScroll]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const scroller = scrollRef.current;
    const fraction = pointerFraction(event.clientY);
    if (!scroller || fraction === null) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const total = scroller.scrollHeight || 1;
    const thumb = clamp(scroller.clientHeight / total, 0, 1);
    const thumbTop = clamp(scroller.scrollTop / total, 0, 1);
    const insideThumb = fraction >= thumbTop && fraction <= thumbTop + thumb;
    dragOffsetRef.current = insideThumb ? fraction - thumbTop : thumb / 2;
    queueScroll(event.clientY);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    queueScroll(event.clientY);
  };

  if (map.totalRows === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="relative w-3.5 shrink-0 cursor-grab touch-none border-l border-border bg-[color-mix(in_srgb,var(--gc-panel)_55%,var(--gc-background))] active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      ref={trackRef}
    >
      {map.marks.map((mark) => (
        <div
          className="absolute inset-x-0.5 rounded-[1px]"
          key={`${mark.kind}:${mark.start}`}
          style={{
            background: MARK_BACKGROUND[mark.kind],
            top: `${(mark.start / map.totalRows) * 100}%`,
            height: `max(2px, ${(mark.length / map.totalRows) * 100}%)`,
          }}
        />
      ))}
      <div
        className="pointer-events-none absolute inset-x-0 border-y border-[color-mix(in_srgb,var(--gc-muted)_45%,transparent)] bg-[color-mix(in_srgb,var(--gc-muted)_16%,transparent)]"
        ref={thumbRef}
        style={{ top: 0, height: "6px" }}
      />
    </div>
  );
}
