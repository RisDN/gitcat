import { BuildIdentity, StatusBar, StatusSpacer, UpdateIndicator } from "../components/shell";
import type { AppMetadata } from "../lib/types";
import type { useAppUpdate } from "../lib/updates";

export interface AppStatusBarProps {
    appMetadata: AppMetadata;
    appUpdate: ReturnType<typeof useAppUpdate>;
}

// Repository state lives where it is acted on -- conflicts on the working-copy
// row, ahead/behind on the branch row -- so the status bar carries only what
// belongs to the application itself.
export function AppStatusBar({ appMetadata, appUpdate }: AppStatusBarProps) {
    return (
        <StatusBar>
            <StatusSpacer />
            <UpdateIndicator update={appUpdate} />
            <BuildIdentity title={`Build commit ${appMetadata.commit}`}>
                GitCat v{appMetadata.version} · {appMetadata.commit}
            </BuildIdentity>
        </StatusBar>
    );
}
