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

export async function chooseDirectory(title: string): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
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
