import { CloudDownload, FolderGit2, FolderPlus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { FIELD_INPUT } from "../../lib";
import type { RecentRepository } from "../../lib/types";
import { Button, IconButton, Input } from "../ui";

export function StartPage({
  busy,
  onClone,
  onCreate,
  onForgetRecent,
  onOpen,
  onSelectRecent,
  recents,
}: {
  busy: boolean;
  onClone: () => void;
  onCreate: () => void;
  onForgetRecent: (path: string) => void;
  onOpen: () => void;
  onSelectRecent: (recent: RecentRepository) => void;
  recents: RecentRepository[];
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return recents;
    return recents.filter((recent) => (
      recent.name.toLowerCase().includes(needle) || recent.path.toLowerCase().includes(needle)
    ));
  }, [query, recents]);

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-background">
      <section className="mx-auto flex w-[min(960px,100%)] flex-col gap-5 px-9 py-8">
        <h1 className="text-[21px] font-[640] tracking-[-0.02em]">Repositories</h1>

        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} icon={<FolderGit2 size={16} />} onClick={onOpen}>
            Open
          </Button>
          <Button disabled={busy} icon={<CloudDownload size={16} />} onClick={onClone}>
            Clone
          </Button>
          <Button disabled={busy} icon={<FolderPlus size={16} />} onClick={onCreate}>
            Create
          </Button>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.25 top-1/2 -translate-y-1/2 text-muted"
            size={14}
          />
          <Input
            aria-label="Search repositories"
            className={`${FIELD_INPUT} pl-7.5`}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search repositories"
            value={query}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-[11px] font-[650] uppercase tracking-[0.08em] text-muted">Recent</h2>
          {matches.length ? (
            <ul className="flex flex-col">
              {matches.map((recent) => (
                <li className="group flex items-center gap-2 rounded-[5px] hover:bg-foreground/5" key={recent.path}>
                  <button
                    className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-3 bg-transparent px-2 py-1.25 text-left"
                    disabled={busy}
                    onClick={() => onSelectRecent(recent)}
                    title={recent.path}
                    type="button"
                  >
                    <span className="shrink-0 text-[13px] font-[650] text-accent">{recent.name}</span>
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted">
                      {recent.path}
                    </span>
                  </button>
                  <IconButton
                    aria-label={`Remove ${recent.name} from recent repositories`}
                    className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => onForgetRecent(recent.path)}
                  >
                    <X size={13} />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-1.25 text-[12px] text-muted">
              {recents.length ? "No repository matches this search." : "Repositories you open show up here."}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
