export function pathSeparator(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function joinPath(parent: string, name: string): string {
  const trimmedParent = parent.trim().replace(/[\\/]+$/, "");
  const trimmedName = name.trim().replace(/^[\\/]+/, "");
  if (!trimmedParent) return trimmedName;
  if (!trimmedName) return trimmedParent;
  return `${trimmedParent}${pathSeparator(parent)}${trimmedName}`;
}

export function parentDirectory(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index <= 0 ? trimmed : trimmed.slice(0, index);
}

export function repositoryNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[\\/]+$/, "").replace(/\.git$/i, "");
  const segment = trimmed.split(/[\\/:]/).filter(Boolean).at(-1) ?? "";
  return /^[\w.-]+$/.test(segment) ? segment : "";
}
