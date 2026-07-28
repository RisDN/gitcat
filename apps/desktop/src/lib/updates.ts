import { useCallback, useEffect, useRef, useState } from "react";

import { isTauriEnvironment } from "./platform";

type UpdateHandle = {
  version: string;
  body?: string;
  downloadAndInstall(onEvent: (event: DownloadEvent) => void): Promise<void>;
};

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface AppUpdateState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  progress: number | null;
  error: string | null;
  supported: boolean;
  check(): void;
  install(): void;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Update failed";
}

export function useAppUpdate(): AppUpdateState {
  const supported = isTauriEnvironment();
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<UpdateHandle | null>(null);
  const busyRef = useRef(false);

  const check = useCallback(() => {
    if (!supported || busyRef.current) return;
    busyRef.current = true;
    setStatus("checking");
    setError(null);
    void (async () => {
      try {
        const { check: checkForUpdate } = await import("@tauri-apps/plugin-updater");
        const update = (await checkForUpdate()) as UpdateHandle | null;
        updateRef.current = update;
        if (update) {
          setVersion(update.version);
          setNotes(update.body?.trim() ? update.body.trim() : null);
          setStatus("available");
        } else {
          setVersion(null);
          setNotes(null);
          setStatus("idle");
        }
      } catch (cause) {
        setError(errorMessage(cause));
        setStatus("error");
      } finally {
        busyRef.current = false;
      }
    })();
  }, [supported]);

  const install = useCallback(() => {
    const update = updateRef.current;
    if (!supported || !update || busyRef.current) return;
    busyRef.current = true;
    setStatus("downloading");
    setProgress(0);
    setError(null);
    void (async () => {
      try {
        let total = 0;
        let received = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? 0;
            setProgress(0);
          } else if (event.event === "Progress") {
            received += event.data.chunkLength;
            setProgress(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null);
          } else {
            setProgress(100);
          }
        });
        setStatus("ready");
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (cause) {
        setError(errorMessage(cause));
        setStatus("error");
        busyRef.current = false;
      }
    })();
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    const timer = window.setTimeout(check, 4000);
    return () => window.clearTimeout(timer);
  }, [check, supported]);

  return { status, version, notes, progress, error, supported, check, install };
}
