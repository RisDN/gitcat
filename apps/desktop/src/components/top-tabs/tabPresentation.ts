import type { TabView } from "./RepositoryTab";

const PATH_SEPARATOR = /[\\/]+/;

export function repositoryLocation(path: string): string {
  const segments = path.split(PATH_SEPARATOR).filter(Boolean);
  const parents = segments.slice(0, -1);

  if (!parents.length) return path || "Repository not selected";
  return parents.slice(-2).join(" / ");
}

export function repositoryTabDescription(tab: TabView): string {
  if (tab.kind === "start") return `${tab.label}, start page`;

  const states: string[] = [];
  if (tab.dirty) states.push("uncommitted changes");
  if (tab.conflictCount) {
    states.push(`${tab.conflictCount} unresolved conflict${tab.conflictCount === 1 ? "" : "s"}`);
  }
  if (tab.unavailable) states.push("repository unavailable");

  return [tab.label, tab.path, ...states].filter(Boolean).join(", ");
}
