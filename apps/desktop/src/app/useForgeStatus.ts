import { useEffect, useMemo, useRef, useState } from "react";

import { branchNameWithoutRemote, remoteNameOf } from "../components/ref-sidebar";
import { checksByOid, forgeRepoFor, pullRequestsByBranch } from "../lib/forge";
import { fetchChecks, fetchPullRequests } from "../lib/pullRequests";
import type {
    CheckSummary,
    ForgeSettings,
    PullRequestInfo,
    RepositorySnapshot,
} from "../lib/types";
import { linkRemoteName } from "./branches";

/**
 * What the hosting service knows about the branches on screen: the open pull
 * request each branch belongs to, and the checks reported for its tip.
 *
 * Both maps are keyed by branch name without its remote, so one lookup serves
 * a local row and the remote row that tracks it.
 */
export interface ForgeStatus {
    pullRequests: ReadonlyMap<string, PullRequestInfo>;
    checks: ReadonlyMap<string, CheckSummary>;
}

const NO_PULLS: ReadonlyMap<string, PullRequestInfo> = new Map();
const NO_CHECKS: ReadonlyMap<string, CheckSummary> = new Map();

/**
 * Checks cost two requests per commit, so only the branches worth decorating
 * are asked about: the ones with a pull request open, plus whatever is checked
 * out. Everything else keeps a plain row.
 */
const MAX_CHECKED_BRANCHES = 12;

export function useForgeStatus(
    snapshot: RepositorySnapshot | null,
    settings: ForgeSettings,
): ForgeStatus {
    const [pullRequests, setPullRequests] = useState(NO_PULLS);
    const [checks, setChecks] = useState(NO_CHECKS);

    // The repository the branches live in, which is what the service answers
    // about. A second remote is not asked: its pull requests would decorate
    // branch names that mean something else here.
    const remote = useMemo(() => {
        const name = linkRemoteName(snapshot);
        return snapshot?.remotes.find((entry) => entry.name === name) ?? null;
    }, [snapshot]);

    const repo = useMemo(() => forgeRepoFor(remote), [remote]);
    const repoKey = repo ? `${repo.host}/${repo.owner}/${repo.repo}/${repo.forge}` : "";

    // Which commit each branch would be judged on. A local branch is judged on
    // what was actually pushed, because nothing unpushed can have been built.
    const tips = useMemo(() => {
        const byBranch = new Map<string, string>();
        const remoteName = remote?.name;
        if (!snapshot || !remoteName) return byBranch;
        for (const branch of snapshot.remote_branches) {
            if (remoteNameOf(branch.name) !== remoteName) continue;
            byBranch.set(branchNameWithoutRemote(branch.name), branch.oid);
        }
        return byBranch;
    }, [remote?.name, snapshot]);

    const tipsSignature = useMemo(
        () => [...tips].map(([branch, oid]) => `${branch}:${oid}`).sort().join("\n"),
        [tips],
    );
    const lastTips = useRef<string | null>(null);

    const headBranch = snapshot?.head.kind === "branch" ? snapshot.head.name : null;
    const { pull_requests: wantPullRequests, checks: wantChecks } = settings;

    // A different repository, or a switched-off source, starts over rather than
    // leaving the previous repository's decorations on screen.
    useEffect(() => {
        lastTips.current = null;
        setPullRequests(NO_PULLS);
        setChecks(NO_CHECKS);
    }, [repoKey, wantPullRequests, wantChecks]);

    useEffect(() => {
        if (!repo || !wantPullRequests) return;
        // Remote tips that moved mean a fetch or a push brought real news, so
        // the service is asked again rather than answering from its cache. An
        // ordinary redraw takes whatever the cache holds.
        const refresh = lastTips.current !== null && lastTips.current !== tipsSignature;
        lastTips.current = tipsSignature;

        let cancelled = false;
        void (async () => {
            let byBranch: Map<string, PullRequestInfo>;
            try {
                const pulls = await fetchPullRequests(repo, refresh);
                byBranch = pullRequestsByBranch(pulls, repo.owner);
            } catch {
                // A service that cannot be reached leaves the rows plain; the
                // next snapshot asks again.
                return;
            }
            if (cancelled) return;
            setPullRequests(byBranch);

            if (!wantChecks) return;
            // Pull request heads first: those are the rows a check badge is
            // worth a request for. The checked-out branch follows, so a branch
            // without a pull request still reports its own build.
            const wanted = new Map<string, string>();
            for (const [branch, pull] of byBranch) wanted.set(branch, pull.head_oid);
            if (headBranch && !wanted.has(headBranch)) {
                const tip = tips.get(headBranch);
                if (tip) wanted.set(headBranch, tip);
            }

            const branches = [...wanted.keys()].slice(0, MAX_CHECKED_BRANCHES);
            let byOid: Map<string, CheckSummary>;
            try {
                const oids = branches.map((branch) => wanted.get(branch) ?? "");
                byOid = checksByOid(await fetchChecks(repo, oids, refresh));
            } catch {
                return;
            }
            if (cancelled) return;

            const byBranchName = new Map<string, CheckSummary>();
            for (const branch of branches) {
                const summary = byOid.get(wanted.get(branch) ?? "");
                if (summary) byBranchName.set(branch, summary);
            }
            setChecks(byBranchName);
        })();

        return () => {
            cancelled = true;
        };
    }, [headBranch, repo, tips, tipsSignature, wantChecks, wantPullRequests]);

    return { pullRequests, checks };
}
