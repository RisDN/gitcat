import { useCallback, useEffect, useRef, useState } from "react";

import { invokeTauri, isTauriEnvironment } from "./platform";
import { connectUpdater, initialUpdateState, type NativeUpdateState } from "./updateClient";

export type { UpdateStatus } from "./updateClient";

export interface AppUpdateState extends NativeUpdateState {
  supported: boolean;
  check(): void;
  install(): void;
}

export function useAppUpdate(): AppUpdateState {
  const supported = isTauriEnvironment();
  const [state, setState] = useState(initialUpdateState);
  const client = useRef<ReturnType<typeof connectUpdater> | null>(null);

  useEffect(() => {
    if (!supported) return;
    const connection = connectUpdater({
      invoke: invokeTauri,
      async listen(onState) {
        const { listen } = await import("@tauri-apps/api/event");
        return listen<NativeUpdateState>("app-update", (event) => onState(event.payload));
      },
    }, setState);
    client.current = connection;
    return () => {
      client.current = null;
      connection.dispose();
    };
  }, [supported]);

  const check = useCallback(() => { void client.current?.check(); }, []);
  const install = useCallback(() => { void client.current?.install(); }, []);
  return { ...state, supported, check, install };
}
