import { AlertTriangle, Download, RefreshCw } from "lucide-react";

import type { AppUpdateState } from "../../lib";
import { StatusItem } from "./StatusBar";

export function UpdateIndicator({ update }: { update: AppUpdateState }) {
  if (!update.supported) return null;

  if (update.status === "available") {
    return (
      <StatusItem className="text-accent">
        <button
          className="inline-flex cursor-pointer items-center gap-1 font-semibold text-accent underline-offset-2 hover:underline"
          onClick={update.install}
          title={update.notes ?? `Download and install GitCat v${update.version}`}
          type="button"
        >
          <Download size={12} /> Update to v{update.version}
        </button>
      </StatusItem>
    );
  }

  if (update.status === "downloading") {
    return (
      <StatusItem className="text-accent">
        <RefreshCw className="animate-spin" size={12} />
        {update.progress === null ? "Downloading update" : `Downloading update ${update.progress}%`}
      </StatusItem>
    );
  }

  if (update.status === "ready") {
    return (
      <StatusItem className="text-accent">
        <RefreshCw size={12} /> Restarting to install
      </StatusItem>
    );
  }

  if (update.status === "error") {
    return (
      <StatusItem className="text-danger">
        <button
          className="inline-flex cursor-pointer items-center gap-1 text-danger underline-offset-2 hover:underline"
          onClick={update.check}
          title={update.error ?? "Update check failed"}
          type="button"
        >
          <AlertTriangle size={12} /> Update failed
        </button>
      </StatusItem>
    );
  }

  return null;
}
