import { branchNameWithoutRemote, remoteNameOf, type BranchScope } from "../components/ref-sidebar";
import { forgeBranchUrl, forgeCommitUrl, forgeOwnerIconUrl } from "../lib/forge";
import type { BranchInfo, ForgeKind, RemoteInfo, RepositorySnapshot } from "../lib/types";

// `git pull` always integrates into HEAD, so a branch row only offers it when
// pulling that branch is the same thing as pulling the checked-out branch.
export function branchAcceptsPull(
    snapshot: RepositorySnapshot | null,
    branch: BranchInfo,
    scope: BranchScope,
): boolean {
    const head = snapshot?.local_branches.find((candidate) => candidate.is_head);
    if (!head?.upstream) return false;
    return scope === "local" ? branch.is_head : head.upstream === branch.name;
}

// Pushing a row needs a concrete remote/branch pair: the branch upstream for
// local rows, the matching local branch for remote rows.
export function branchPushTarget(
    snapshot: RepositorySnapshot | null,
    branch: BranchInfo,
    scope: BranchScope,
): { remote: string; branch: string; setUpstream: boolean } | null {
    if (scope === "remote") {
        const shortName = branchNameWithoutRemote(branch.name);
        const local = snapshot?.local_branches.find((candidate) => candidate.name === shortName);
        return local ? { remote: remoteNameOf(branch.name), branch: shortName, setUpstream: false } : null;
    }
    if (branch.upstream) {
        return { remote: remoteNameOf(branch.upstream), branch: branch.name, setUpstream: false };
    }
    const remotes = snapshot?.remotes ?? [];
    return remotes.length === 1
        ? { remote: remotes[0].name, branch: branch.name, setUpstream: true }
        : null;
}

export function currentBranch(snapshot: RepositorySnapshot | null): string {
    if (!snapshot) return "-";
    if (snapshot.head.kind === "branch") return snapshot.head.name;
    if (snapshot.head.kind === "detached") return `detached @ ${snapshot.head.oid.slice(0, 7)}`;
    return snapshot.head.intended_branch;
}

export function remoteIconUrls(remotes: readonly RemoteInfo[]): Map<string, string> {
    const iconUrls = new Map<string, string>();
    for (const remote of remotes) {
        const iconUrl = forgeOwnerIconUrl(remote, remote.forge);
        if (iconUrl) iconUrls.set(remote.name, iconUrl);
    }
    return iconUrls;
}

// Web links follow the layout of the remote's own forge. The backend already
// resolved both the home page and the forge from the remote URL, so a link is
// only missing when the remote is a local path or an unresolved SSH alias.
export function remoteCommitUrl(
    snapshot: RepositorySnapshot | null,
    remoteName: string,
    oid: string,
): string | null {
    const target = remoteWebTarget(snapshot, remoteName);
    return target ? forgeCommitUrl(target.webUrl, target.forge, oid) : null;
}

export function remoteBranchUrl(
    snapshot: RepositorySnapshot | null,
    remoteName: string,
    branch: string,
): string | null {
    const target = remoteWebTarget(snapshot, remoteName);
    return target ? forgeBranchUrl(target.webUrl, target.forge, branch) : null;
}

function remoteWebTarget(
    snapshot: RepositorySnapshot | null,
    remoteName: string,
): { webUrl: string; forge: ForgeKind } | null {
    const remote = snapshot?.remotes.find((candidate) => candidate.name === remoteName);
    return remote?.web_url ? { webUrl: remote.web_url, forge: remote.forge } : null;
}

// The remote a commit row links to: the branch's own remote when the click
// landed on a remote ref, otherwise the upstream remote, otherwise origin.
export function linkRemoteName(
    snapshot: RepositorySnapshot | null,
    preferred?: string | null,
): string | null {
    const remotes = snapshot?.remotes ?? [];
    if (remotes.length === 0) return null;
    if (preferred && remotes.some((remote) => remote.name === preferred)) return preferred;
    const head = snapshot?.local_branches.find((candidate) => candidate.is_head);
    if (head?.upstream) {
        const upstreamRemote = remoteNameOf(head.upstream);
        if (remotes.some((remote) => remote.name === upstreamRemote)) return upstreamRemote;
    }
    return remotes.find((remote) => remote.name === "origin")?.name ?? remotes[0].name;
}
