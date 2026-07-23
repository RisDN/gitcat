import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { IconButton, Input, Spinner } from "./ui";

interface SearchBarProps {
  value: string;
  count: number;
  activeIndex: number;
  busy: boolean;
  focusToken: number;
  onChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function SearchBar({
  value,
  count,
  activeIndex,
  busy,
  focusToken,
  onChange,
  onPrevious,
  onNext,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  return (
    <div
      className="z-10 flex h-10.25 flex-[0_0_41px] items-center gap-1.25 border-b border-[color-mix(in_srgb,var(--gc-accent)_45%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-accent)_8%,var(--gc-panel))] py-1.25 pl-3 pr-1.75 text-accent"
      role="search"
    >
      <Search size={16} aria-hidden="true" />
      <Input
        aria-label="Search commit subject and description"
        className="min-w-20 flex-1 rounded border border-[color-mix(in_srgb,var(--gc-accent)_55%,var(--gc-border))] bg-background px-2 py-1.25 text-foreground outline-0"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          }
          if (event.key === "Escape") onClose();
        }}
        placeholder="Search subject and description"
        ref={inputRef}
        value={value}
      />
      {busy ? <Spinner label="Searching commits" /> : null}
      <span className="min-w-14.5 text-center text-[11px] text-muted">
        {count ? `${activeIndex + 1} of ${count}` : "0 results"}
      </span>
      <IconButton aria-label="Previous result" disabled={!count} onClick={onPrevious}>
        <ArrowUp size={15} />
      </IconButton>
      <IconButton aria-label="Next result" disabled={!count} onClick={onNext}>
        <ArrowDown size={15} />
      </IconButton>
      <IconButton aria-label="Close search" onClick={onClose}>
        <X size={15} />
      </IconButton>
    </div>
  );
}
