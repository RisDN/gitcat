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

function looksLikeWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * The form of a path used to ask whether two paths name the same folder.
 *
 * The same folder reaches GitCat spelled several ways: Explorer's context menu
 * hands over exactly what was right-clicked, Git answers with its own root, and
 * a stored workspace carries whatever was written when the tab was opened. So
 * separators are unified and a trailing one dropped. A Windows path is folded
 * to lower case because its filesystem is case-insensitive; elsewhere case is
 * part of the name and is kept.
 */
export function comparablePath(path: string): string {
  const trimmed = path.trim();
  // A trailing separator is spelling rather than part of the name, except at a
  // root -- `/` or `C:\` -- where it is all the name there is.
  const unified = trimmed.replace(/[\\/]+/g, "/").replace(/(?<=[^:/])\/+$/, "");
  return looksLikeWindowsPath(trimmed) ? unified.toLowerCase() : unified;
}

/** Whether two paths name the same folder. An empty path names nothing. */
export function samePath(left: string, right: string): boolean {
  if (!left.trim() || !right.trim()) return false;
  return comparablePath(left) === comparablePath(right);
}
