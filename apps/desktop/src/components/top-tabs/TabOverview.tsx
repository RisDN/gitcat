import {
    AlertTriangle,
    Check,
    Folder,
    FolderGit2,
    FolderX,
    House,
    LayoutList,
    Search
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cx } from "../../lib";
import { MenuSurface } from "../menu";
import { IconButton } from "../ui";
import type { TabView } from "./RepositoryTab";
import type { TabGroupView } from "./TabGroup";
import { repositoryLocation, repositoryTabDescription } from "./tabPresentation";

interface TabOverviewProps {
  activeTabId?: string;
  disabled: boolean;
  groups: TabGroupView[];
  onSelect: (tabId: string) => void;
  ungroupedTabs: TabView[];
}

interface OverviewSection {
  id: string;
  label: string;
  tabs: TabView[];
  ungrouped?: boolean;
}

function OverviewRow({
  active,
  onSelect,
  tab,
}: {
  active: boolean;
  onSelect: () => void;
  tab: TabView;
}) {
  const StartIcon = tab.kind === "start" ? House : FolderGit2;

  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={repositoryTabDescription(tab)}
      className={cx(
        "group/overview-row flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-[5px] border px-2.5 py-1.75 text-left",
        "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--gc-accent)_18%,transparent)]",
        active
          ? "border-[color-mix(in_srgb,var(--gc-accent)_42%,var(--gc-border))] bg-row-selected"
          : "border-transparent bg-transparent hover:border-border/70 hover:bg-row-hover",
      )}
      onClick={onSelect}
      title={tab.path}
      type="button"
    >
      <span
        className={cx(
          "grid size-7.5 shrink-0 place-items-center rounded-[5px] border",
          active
            ? "border-[color-mix(in_srgb,var(--gc-accent)_45%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-accent)_13%,var(--gc-panel))] text-accent"
            : "border-border/70 bg-background/55 text-muted group-hover/overview-row:text-foreground",
        )}
      >
        <StartIcon size={15} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-[660] text-foreground">
            {tab.label}
          </strong>
          {tab.conflictCount ? (
            <span className="inline-flex shrink-0 items-center gap-0.75 text-danger">
              <AlertTriangle size={11} />
              <b className="font-mono text-[9px]">{tab.conflictCount}</b>
            </span>
          ) : null}
        </span>
        <span
          className={cx(
            "mt-px block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[9.5px]",
            tab.unavailable ? "text-danger" : "text-muted",
          )}
        >
          {tab.kind === "start"
            ? "Open, clone, or create a repository"
            : tab.unavailable
              ? `Unavailable · ${repositoryLocation(tab.path)}`
              : repositoryLocation(tab.path)}
        </span>
      </span>
      {active ? <Check aria-hidden="true" className="shrink-0 text-accent" size={15} /> : null}
    </button>
  );
}

export function TabOverview({
  activeTabId,
  disabled,
  groups,
  onSelect,
  ungroupedTabs,
}: TabOverviewProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabCount = ungroupedTabs.length + groups.reduce((total, group) => total + group.tabs.length, 0);

  const sections = useMemo<OverviewSection[]>(() => [
    ...(ungroupedTabs.length
      ? [{ id: "ungrouped", label: "No folder", tabs: ungroupedTabs, ungrouped: true }]
      : []),
    ...groups
      .filter((group) => group.tabs.length)
      .map((group) => ({ id: group.id, label: group.name, tabs: group.tabs })),
  ], [groups, ungroupedTabs]);

  const filteredSections = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return sections;

    return sections.flatMap((section) => {
      const tabs = section.tabs.filter((tab) => (
        `${tab.label} ${tab.path} ${section.label}`.toLocaleLowerCase().includes(needle)
      ));
      return tabs.length ? [{ ...section, tabs }] : [];
    });
  }, [query, sections]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <IconButton
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Browse ${tabCount} open ${tabCount === 1 ? "repository" : "repositories"}`}
        className={cx(
          "relative size-8.5! rounded-md!",
          open && "border-border-strong! bg-control-hover! text-foreground!",
        )}
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
        title="All open repositories"
      >
        <LayoutList size={16} />
        {tabCount ? (
          <span className="absolute -right-0.75 -top-0.75 grid min-w-3.75 place-items-center rounded-full border border-surface bg-panel px-0.75 font-mono text-[8px] font-bold leading-3.5 text-muted">
            {tabCount}
          </span>
        ) : null}
      </IconButton>

      {open ? (
        <MenuSurface
          aria-label="Open repositories"
          className="absolute right-0 top-[calc(100%+7px)] z-80 flex max-h-[min(430px,calc(100vh-80px))] w-[min(370px,calc(100vw-18px))] flex-col overflow-hidden p-0!"
          role="dialog"
        >
          <div className="border-b border-border bg-background/38 p-2">
            <label className="flex h-8 items-center gap-2 rounded-[5px] border border-border bg-background/72 px-2.25 text-muted focus-within:border-accent focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--gc-accent)_16%,transparent)]">
              <Search aria-hidden="true" size={14} />
              <input
                aria-label="Find open repository"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted/75"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find open repository…"
                ref={inputRef}
                type="search"
                value={query}
              />
              <kbd className="rounded border border-border bg-panel px-1 py-px font-mono text-[8px] text-muted">Esc</kbd>
            </label>
          </div>

          <div className="min-h-0 overflow-y-auto p-1.5">
            {filteredSections.length ? filteredSections.map((section) => (
              <section className="not-last:mb-1.5" key={section.id}>
                <div className="flex h-6 items-center gap-1.5 px-2 text-[9px] font-bold uppercase tracking-[0.08em] text-muted">
                  {section.ungrouped ? <FolderX size={12} /> : <Folder size={12} />}
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    {section.label}
                  </span>
                  <span className="font-mono text-[8px]">{section.tabs.length}</span>
                </div>
                <div className="space-y-0.5">
                  {section.tabs.map((tab) => (
                    <OverviewRow
                      active={tab.id === activeTabId}
                      key={tab.id}
                      onSelect={() => {
                        onSelect(tab.id);
                        setOpen(false);
                      }}
                      tab={tab}
                    />
                  ))}
                </div>
              </section>
            )) : (
              <div className="grid min-h-27 place-items-center px-5 text-center">
                <span>
                  <Search className="mx-auto mb-2 text-muted" size={18} />
                  <strong className="block text-[12px] font-semibold text-foreground">No matching repository</strong>
                  <small className="mt-0.75 block text-[10px] text-muted">Search by name, folder, or path.</small>
                </span>
              </div>
            )}
          </div>
        </MenuSurface>
      ) : null}
    </div>
  );
}
