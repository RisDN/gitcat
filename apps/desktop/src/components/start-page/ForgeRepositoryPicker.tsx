import { Lock, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cx } from "../../lib";
import { forgeRepositories } from "../../lib/forgeAuth";
import type { ForgeRepository } from "../../lib/types";
import { IconButton, Input, Spinner } from "../ui";

/**
 * The repositories one signed-in account can clone.
 *
 * The whole list is fetched once and filtered here: it is a few hundred rows
 * at most, and a request per keystroke would spend the service's rate limit on
 * typing.
 */
export function ForgeRepositoryPicker({
  host,
  onSelect,
  selected,
}: {
  host: string;
  onSelect: (repository: ForgeRepository) => void;
  selected: string | null;
}) {
  const [repositories, setRepositories] = useState<ForgeRepository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    forgeRepositories(host, reloadToken > 0)
      .then((listed) => {
        if (cancelled) return;
        setRepositories(listed);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [host, reloadToken]);

  const matches = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) return repositories;
    return repositories.filter((repository) =>
      repository.full_name.toLocaleLowerCase().includes(needle)
      || (repository.description ?? "").toLocaleLowerCase().includes(needle));
  }, [filter, repositories]);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <div className="flex h-8.5 min-w-0 flex-1 items-center gap-2 rounded-[5px] border border-border bg-background px-2.25 text-muted focus-within:border-accent focus-within:text-accent">
          <Search size={14} />
          <Input
            aria-label="Search repositories"
            className="min-w-0 flex-1 border-0 bg-transparent outline-0 placeholder:text-muted"
            onChange={(event) => setFilter(event.target.value)}
            placeholder={`Search ${host} repositories`}
            value={filter}
          />
        </div>
        <IconButton
          aria-label="Reload the repository list"
          disabled={loading}
          onClick={() => setReloadToken((current) => current + 1)}
          title="Reload"
        >
          <RefreshCw size={14} />
        </IconButton>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center gap-2 text-[11px] text-muted">
          <Spinner label="Loading repositories" /> Loading repositories…
        </div>
      ) : error ? (
        <p className="rounded-[5px] border border-border bg-background p-2.25 text-[11px] leading-[1.45] text-danger">
          {error}
        </p>
      ) : (
        <ul className="h-40 overflow-y-auto rounded-[5px] border border-border bg-background">
          {matches.map((repository) => (
            <li key={repository.full_name}>
              <button
                className={cx(
                  "flex w-full min-w-0 cursor-pointer items-center gap-1.5 px-2.25 py-1.5 text-left text-[11px]",
                  selected === repository.full_name
                    ? "bg-accent/16 text-foreground"
                    : "text-foreground hover:bg-foreground/5",
                )}
                onClick={() => onSelect(repository)}
                type="button"
              >
                {repository.private ? (
                  <Lock aria-label="Private" className="shrink-0 text-muted" size={11} />
                ) : null}
                <span className="min-w-0 truncate">{repository.full_name}</span>
                {repository.description ? (
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {repository.description}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          {matches.length === 0 ? (
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
