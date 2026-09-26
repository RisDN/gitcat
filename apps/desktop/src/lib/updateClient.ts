/** The native updater owns polling, downloads, installation, and restart. */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "error";

export interface NativeUpdateState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  progress: number | null;
  error: string | null;
}

export const initialUpdateState: NativeUpdateState = {
  status: "idle", version: null, notes: null, progress: null, error: null,
};

export interface UpdateTransport {
  listen(onState: (state: NativeUpdateState) => void): Promise<() => void>;
  invoke<T>(command: string): Promise<T>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Update failed";
}

/** Subscribe before reading the snapshot, and ignore stale replies after events. */
export function connectUpdater(transport: UpdateTransport, onState: (state: NativeUpdateState) => void) {
  let state = initialUpdateState;
  let revision = 0;
  let disposed = false;
  let listening = false;
  let pending = false;
  let unlisten: (() => void) | undefined;

  const receive = (next: NativeUpdateState) => {
    if (disposed) return;
    revision += 1;
    state = next;
    onState(next);
  };
  const fail = (cause: unknown) => receive({ ...state, status: "error", error: errorMessage(cause) });

  const connected = (async () => {
    try {
      const stop = await transport.listen(receive);
      if (disposed) { stop(); return; }
      unlisten = stop;
      listening = true;
      const before = revision;
      try {
        const snapshot = await transport.invoke<NativeUpdateState>("get_update_state");
        if (revision === before) receive(snapshot);
      } catch (cause) {
        if (revision === before) fail(cause);
      }
    } catch (cause) {
      fail(cause);
    }
  })();

  const run = async (command: "check_update" | "install_update") => {
    if (disposed || pending) return;
    pending = true;
    try {
      await connected;
      if (disposed || !listening) return;
      if (["checking", "downloading", "installing", "ready"].includes(state.status)) return;
      if (command === "install_update" && !state.version) return;
      const before = revision;
      try {
        await transport.invoke<void>(command);
      } catch (cause) {
        // Operational failures also arrive as native state events. Never replace
        // a newer native state with the delayed rejection of an earlier command.
        if (revision === before) fail(cause);
      }
    } finally {
      pending = false;
    }
  };

  return {
    check: () => run("check_update"),
    install: () => run("install_update"),
    dispose: () => {
      disposed = true;
      unlisten?.();
      unlisten = undefined;
    },
  };
}
