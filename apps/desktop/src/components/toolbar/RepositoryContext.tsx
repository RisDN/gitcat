// Repository / branch breadcrumb on the left of the toolbar.
function ContextField({ caption, value }: { caption: string; value: string }) {
  return (
    <div className="flex min-w-25 max-w-42.5 flex-col gap-px max-[1080px]:min-w-20">
      <span className="text-[9px] uppercase tracking-[0.08em] text-muted">{caption}</span>
      <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">{value}</strong>
    </div>
  );
}

export function RepositoryContext({ branchName, repositoryName }: { branchName: string; repositoryName: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.75">
      <ContextField caption="repository" value={repositoryName} />
      <span className="text-[25px] font-extralight text-muted/40" aria-hidden="true">/</span>
      <ContextField caption="branch" value={branchName} />
    </div>
  );
}
