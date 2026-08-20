import { branchNameWithoutRemote, remoteNameOf, type BranchScope } from "../components/ref-sidebar";
import type { BranchInfo, RemoteInfo, RepositorySnapshot } from "../lib/types";

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

export function githubOwnerFromRemoteUrl(url: string): string | null {
    const trimmed = url.trim();
    const httpsMatch = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(trimmed);
    if (httpsMatch) return httpsMatch[1];

    const sshMatch = /^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(trimmed);
    if (sshMatch) return sshMatch[1];

    return null;
}

export function githubRemoteIconUrls(remotes: readonly RemoteInfo[]): Map<string, string> {
    const iconUrls = new Map<string, string>();
    for (const remote of remotes) {
        const owner = githubOwnerFromRemoteUrl(remote.fetch_url) ?? githubOwnerFromRemoteUrl(remote.push_url);
        if (owner) iconUrls.set(remote.name, `https://github.com/${encodeURIComponent(owner)}.png?size=32`);
    }
    return iconUrls;
}

// Turns a fetch/push URL into the repository's https web address so the UI can
// build links to commits and branches. Returns null for URLs that are not a
// host/path pair (local paths, unknown schemes).
export function remoteWebBaseUrl(url: string): string | null {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) return null;
    const httpMatch = /^https?:\/\/(?:[^@/\s]*@)?([^/\s:]+)(?::\d+)?\/(.+?)(?:\.git)?$/i.exec(trimmed);
    if (httpMatch) return `https://${httpMatch[1]}/${httpMatch[2]}`;
    const sshMatch = /^(?:ssh:\/\/)?(?:[^@/\s]+@)?([^/\s:]+)(?::\d+)?[:/](.+?)(?:\.git)?$/i.exec(trimmed);
    if (sshMatch && sshMatch[2].includes("/")) return `https://${sshMatch[1]}/${sshMatch[2]}`;
    return null;
}

// Web links follow the GitHub path layout, which GitLab and Bitbucket also
// redirect for commits; there is no per-host mapping yet.
export function remoteCommitUrl(
    snapshot: RepositorySnapshot | null,
    remoteName: string,
    oid: string,
): string | null {
    const base = remoteBaseFor(snapshot, remoteName);
    return base ? `${base}/commit/${oid}` : null;
}

export function remoteBranchUrl(
    snapshot: RepositorySnapshot | null,
    remoteName: string,
    branch: string,
): string | null {
    const base = remoteBaseFor(snapshot, remoteName);
    return base ? `${base}/tree/${branch.split("/").map(encodeURIComponent).join("/")}` : null;
}

function remoteBaseFor(snapshot: RepositorySnapshot | null, remoteName: string): string | null {
    const remote = snapshot?.remotes.find((candidate) => candidate.name === remoteName);
    if (!remote) return null;
    return remoteWebBaseUrl(remote.fetch_url) ?? remoteWebBaseUrl(remote.push_url);
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
