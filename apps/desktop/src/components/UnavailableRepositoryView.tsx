import { FolderSearch, FolderX, LoaderCircle, RotateCcw, X } from "lucide-react";

import { Button } from "./ui";

export function UnavailableRepositoryView({
  busy,
  detail,
  loading,
  name,
  path,
  onClose,
  onLocate,
  onRetry,
}: {
  busy: boolean;
  detail?: string;
  loading: boolean;
  name: string;
  path: string;
  onClose: () => void;
  onLocate: () => void;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted [&>svg]:animate-orbit">
        <LoaderCircle size={22} />
        <span className="text-[13px]">Opening {name}…</span>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <FolderX className="text-danger" size={32} />
      <h1 className="text-[19px] font-[620] tracking-[-0.02em]">{name} is not available</h1>
      <p className="max-w-140 text-[13px] leading-[1.6] text-muted">
        {detail ?? "The folder may have moved or no longer be a Git repository."}
      </p>
      <code className="max-w-140 truncate rounded border border-border bg-control px-2.5 py-1.5 font-mono text-[11px] text-muted">
        {path}
      </code>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
        <Button disabled={busy} icon={<RotateCcw size={16} />} onClick={onRetry} tone="accent">
          Try again
        </Button>
        <Button disabled={busy} icon={<FolderSearch size={16} />} onClick={onLocate}>
          Open another folder
        </Button>
        <Button disabled={busy} icon={<X size={16} />} onClick={onClose}>
          Close tab
        </Button>
      </div>
    </main>
  );
}
