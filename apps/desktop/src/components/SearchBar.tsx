import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { IconButton, Spinner } from "./Primitives";

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
    <div className="gc-search" role="search">
      <Search size={16} aria-hidden="true" />
      <input
        aria-label="Search commit subject and description"
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
      <span className="gc-search__count">
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
