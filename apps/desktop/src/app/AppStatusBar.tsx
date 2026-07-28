import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { BuildIdentity, StatusBar, StatusItem, StatusSpacer, UpdateIndicator } from "../components/shell";
import { gitcatApi } from "../lib/api";
import type { AppMetadata, RepositorySnapshot, StashEntry } from "../lib/types";
import type { useAppUpdate } from "../lib/updates";
import type { RuntimeRepository } from "./state";

export interface AppStatusBarProps {
    activeConflictCount: number;
    activeRepository: RuntimeRepository | undefined;
    appMetadata: AppMetadata;
    appUpdate: ReturnType<typeof useAppUpdate>;
    snapshot: RepositorySnapshot | null;
    stashes: StashEntry[];
}

export function AppStatusBar({
    activeConflictCount,
    activeRepository,
    appMetadata,
    appUpdate,
    snapshot,
    stashes,
}: AppStatusBarProps) {
    return (
        <StatusBar>
            <StatusItem className={gitcatApi.runtime === "tauri" ? "text-success" : "text-warning"}>
                {gitcatApi.runtime === "tauri" ? "Native Git" : "Browser demo"}
            </StatusItem>
            {snapshot ? <StatusItem>{snapshot.status.clean ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {snapshot.status.clean ? "Working tree clean" : `${snapshot.status.entries.length} changed`}</StatusItem> : null}
            {activeConflictCount ? <StatusItem className="text-danger"><AlertTriangle size={12} /> {activeConflictCount} conflicts</StatusItem> : null}
            {snapshot?.status.ahead ? <StatusItem>↑ {snapshot.status.ahead} ahead</StatusItem> : null}
            {snapshot?.status.behind ? <StatusItem>↓ {snapshot.status.behind} behind</StatusItem> : null}
            <StatusSpacer />
            {activeRepository ? <StatusItem>{stashes.length} stashes</StatusItem> : null}
            {activeRepository ? <StatusItem>{activeRepository.info.object_format.toUpperCase()}</StatusItem> : null}
            <UpdateIndicator update={appUpdate} />
            <BuildIdentity title={`Build commit ${appMetadata.commit}`}>
                GitCat v{appMetadata.version} · {appMetadata.commit}
            </BuildIdentity>
        </StatusBar>
    );
}
