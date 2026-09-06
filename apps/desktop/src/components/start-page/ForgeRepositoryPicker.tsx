import { ChevronDown, GitFork, Globe, Lock, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { markForgeAccepted, markForgeRejected } from "../../app/forgeConnections";
import { getApiError } from "../../lib";
import { groupByOwner } from "../../lib/forge";
import { forgeRepositories } from "../../lib/forgeAuth";
import type { ForgeRepository } from "../../lib/types";
import { IconButton, Input, Spinner } from "../ui";

/**
 * What a repository is, in one glyph. Every row carries one: without a mark on
 * the public rows the lock reads as a property of the row's indentation rather
 * than of the repository.
 */
function RepositoryIcon({ repository }: { repository: ForgeRepository }) {
  if (repository.private) {
    return <Lock aria-label="Private" className="shrink-0 text-muted" size={11} />;
  }
  if (repository.fork) {
    return <GitFork aria-label="Public fork" className="shrink-0 text-muted" size={11} />;
  }
  return <Globe aria-label="Public" className="shrink-0 text-muted" size={11} />;
}

/**
 * The repositories one signed-in account can clone.
 *
 * The whole list is fetched once and filtered here: it is a few hundred rows
 * at most, and a request per keystroke would spend the service's rate limit on
 * typing.
 *
 * Picking one closes the list and names it in the field, the way a select
 * behaves: the choice stays visible while the rest of the clone form takes the
 * space the list was holding. The field reopens the list, because changing the
 * choice is the only thing left to do with it.
 */
export function ForgeRepositoryPicker({
  account,
  host,
  onSelect,
  selected,
}: {
  /** Login of the connected account, so its own repositories sort first. */
  account?: string;
  host: string;
  onSelect: (repository: ForgeRepository) => void;
  selected: string | null;
}) {
  const [repositories, setRepositories] = useState<ForgeRepository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [open, setOpen] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    forgeRepositories(host, reloadToken > 0)
      .then((listed) => {
        markForgeAccepted(host);
        if (cancelled) return;
        setRepositories(listed);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        const failure = getApiError(reason);
        // The list is the first thing that asks the service anything, so it is
        // where a credential that has stopped working is found out. Recording
        // it here is what keeps the service from being marked connected while
        // its own answer says otherwise.
        if (failure.code === "authentication_required") markForgeRejected(host);
        if (cancelled) return;
        setError(failure.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [host, reloadToken]);

  const matches = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) return repositories;
    // Only the name is matched, because only the name is on the rows: a hit
    // whose reason is invisible reads as a wrong result.
    return repositories.filter((repository) =>
      repository.full_name.toLocaleLowerCase().includes(needle));
  }, [filter, repositories]);

  const groups = useMemo(() => groupByOwner(matches, account), [account, matches]);
  const chosen = selected
    ? repositories.find((repository) => repository.full_name === selected) ?? null
    : null;

  const openList = () => {
    // The search that found the repository is kept: reopening usually means
    // picking a neighbour out of the same results, and retyping the query to
    // get back to them is work the field already did. The text is selected, so
    // a different search still costs one keystroke.
    setOpen(true);
    requestAnimationFrame(() => searchRef.current?.select());
  };

  const choose = (repository: ForgeRepository) => {
    onSelect(repository);
    setOpen(false);
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {open || !chosen ? (
          <div className="flex h-8.5 min-w-0 flex-1 items-center gap-2 rounded-[5px] border border-border bg-background px-2.25 text-muted focus-within:border-accent focus-within:text-accent">
            <Search size={14} />
            <Input
              aria-label="Search repositories"
              className="min-w-0 flex-1 border-0 bg-transparent text-foreground outline-0 placeholder:text-muted"
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                // Escape backs out of a search that changed nothing, and only
                // where there is still a choice to fall back to.
                if (event.key === "Escape" && chosen) {
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
              placeholder="Search Remotes"
              ref={searchRef}
              value={filter}
            />
          </div>
        ) : (
          <button
            aria-expanded={false}
            aria-label={`Selected repository ${chosen.full_name}. Choose another`}
            className="flex h-8.5 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[5px] border border-accent bg-accent/12 px-2.25 text-left text-[11px] text-foreground"
            onClick={openList}
            type="button"
          >
            <RepositoryIcon repository={chosen} />
            <span className="min-w-0 flex-1 truncate">{chosen.full_name}</span>
            <ChevronDown className="shrink-0 text-muted" size={14} />
          </button>
        )}
        <IconButton
          aria-label="Reload the repository list"
          disabled={loading}
          onClick={() => {
            setReloadToken((current) => current + 1);
            openList();
          }}
          title="Reload"
        >
          <RefreshCw size={14} />
        </IconButton>
      </div>

      {!open && chosen ? null : loading ? (
        <div className="flex h-40 items-center justify-center gap-2 text-[11px] text-muted">
          <Spinner label="Loading repositories" /> Loading repositories…
        </div>
      ) : error ? (
        <p className="rounded-[5px] border border-border bg-background p-2.25 text-[11px] leading-[1.45] text-danger">
          {error}
        </p>
      ) : (
        <ul className="h-40 overflow-y-auto rounded-[5px] border border-border bg-background">
          {groups.map((group) => (
            <li key={group.owner}>
              <p className="sticky top-0 z-1 flex items-center gap-1.5 border-b border-border bg-panel px-2.25 py-1 text-[10px] font-medium text-muted">
                <span className="min-w-0 truncate">{group.owner}</span>
                <span className="text-muted/70">{group.repositories.length}</span>
              </p>
              <ul>
                {group.repositories.map((repository) => (
                  <li key={repository.full_name}>
                    <button
                      // The list only opens to change the choice, and the
                      // field above already names it, so no row is marked.
                      className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 px-2.25 py-1.5 pl-3.5 text-left text-[11px] text-foreground hover:bg-foreground/5"
                      onClick={() => choose(repository)}
                      type="button"
                    >
                      <RepositoryIcon repository={repository} />
                      <span className="min-w-0 truncate">{repository.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {groups.length === 0 ? (
            <li className="px-2.25 py-3 text-center text-[11px] text-muted">
              {repositories.length === 0
                ? "This account can reach no repositories."
                : "No repository matches the search."}
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
