export type GitCatRuntime = "tauri" | "browser";

type TauriGlobal = typeof globalThis & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

/** Runtime check kept separate so browser development never touches Tauri APIs. */
export function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const runtime = globalThis as TauriGlobal;
  return runtime.__TAURI_INTERNALS__ !== undefined || runtime.__TAURI__ !== undefined;
}

export function getGitCatRuntime(): GitCatRuntime {
  return isTauriEnvironment() ? "tauri" : "browser";
}

/**
 * Asks for a folder, starting where the caller says.
 *
 * `startIn` is the folder GitCat last put a repository in. It is a hint only:
 * a path that has since been renamed or removed leaves the dialog at the
 * platform's own default rather than failing to open.
 */
export async function chooseDirectory(
  title: string,
  startIn?: string | null,
): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const defaultPath = startIn?.trim() || undefined;
  const selected = await open({ defaultPath, directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

/**
 * Opens a link in the user's browser.
 *
 * Only `https:` is passed on, which is all the window's capability allows: a
 * link GitCat offers comes from a hosting service, and anything else arriving
 * in its place is not something to hand to the operating system.
 *
 * Answers `false` when the link was not opened -- outside the desktop
 * application, or for a scheme that is not offered -- so a caller can fall back
 * to putting the address on the clipboard.
 */
export async function openExternal(url: string): Promise<boolean> {
  if (!isTauriEnvironment() || !/^https:\/\//i.test(url)) return false;
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
  return true;
}

export async function invokeTauri<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!isTauriEnvironment()) {
    throw new Error(`Tauri command '${command}' requested outside Tauri`);
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
