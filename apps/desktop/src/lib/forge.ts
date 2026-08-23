import type { ForgeKind, RemoteInfo, RepositorySnapshot } from "./types";

// Human-readable names for the settings override list.
export const FORGE_LABELS: Record<ForgeKind, string> = {
    unknown: "Detect from host",
    github: "GitHub",
    gitlab: "GitLab",
    bitbucket: "Bitbucket",
    gitea: "Gitea / Forgejo",
    azure_devops: "Azure DevOps",
};

// The order the settings dropdown offers, detection first.
export const FORGE_KINDS: readonly ForgeKind[] = [
    "unknown",
    "github",
    "gitlab",
    "bitbucket",
    "gitea",
    "azure_devops",
];

export function isForgeKind(value: string): value is ForgeKind {
    return value in FORGE_LABELS;
}

// The backend recognises public hosts only, because a self-hosted install
// cannot be told apart from any other domain without asking it over the
// network. Settings map such a host to its forge by hand.
export function effectiveForge(
    remote: RemoteInfo | null | undefined,
    overrides: Readonly<Record<string, ForgeKind>> = {},
): ForgeKind {
    if (!remote) return "unknown";
    const host = remote.url?.host;
    const override = host ? overrides[host] : undefined;
    if (override && override !== "unknown") return override;
    return remote.forge;
}

// Re-labels every remote whose host is named in settings, so the rest of the
// app can keep reading `remote.forge` without knowing overrides exist. The
// home page the backend built stays correct: overriding only changes the path
// layout below it.
export function withForgeOverrides(
    snapshot: RepositorySnapshot | null,
    overrides: Readonly<Record<string, ForgeKind>>,
): RepositorySnapshot | null {
    if (!snapshot || Object.keys(overrides).length === 0) return snapshot;
    let changed = false;
    const remotes = snapshot.remotes.map((remote) => {
        const forge = effectiveForge(remote, overrides);
        if (forge === remote.forge) return remote;
        changed = true;
        return { ...remote, forge };
    });
    return changed ? { ...snapshot, remotes } : snapshot;
}

// Web layouts diverge below the repository home page: GitLab nests everything
// under `/-/`, Bitbucket pluralises commits, Gitea names the ref kind, and
// Azure passes the branch as a query parameter. An unrecognised host follows
// the GitHub layout, which is what most self-hosted forges imitate.
export function forgeCommitUrl(webUrl: string, forge: ForgeKind, oid: string): string {
    const base = webUrl.replace(/\/+$/, "");
    switch (forge) {
        case "gitlab":
            return `${base}/-/commit/${oid}`;
        case "bitbucket":
            return `${base}/commits/${oid}`;
        default:
            return `${base}/commit/${oid}`;
    }
}

export function forgeBranchUrl(webUrl: string, forge: ForgeKind, branch: string): string {
    const base = webUrl.replace(/\/+$/, "");
    // Path segments keep their slashes; `feature/x` is two segments, not one
    // escaped name.
    const path = branch.split("/").map(encodeURIComponent).join("/");
    switch (forge) {
        case "gitlab":
            return `${base}/-/tree/${path}`;
        case "bitbucket":
            return `${base}/src/${path}/`;
        case "gitea":
            return `${base}/src/branch/${path}`;
        case "azure_devops":
            return `${base}?version=GB${encodeURIComponent(branch)}`;
        default:
            return `${base}/tree/${path}`;
    }
}

// Only GitHub serves an owner avatar under a plain `<owner>.png` path, so the
// remote icon stays GitHub-only until an avatar layer lands.
export function forgeOwnerIconUrl(
    remote: RemoteInfo,
    forge: ForgeKind,
    size = 32,
): string | null {
    if (forge !== "github") return null;
    const owner = remote.url?.owner;
    return owner ? `https://github.com/${encodeURIComponent(owner)}.png?size=${size}` : null;
}
