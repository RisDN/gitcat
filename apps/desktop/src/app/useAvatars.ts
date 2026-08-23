import { useEffect, useMemo, useRef, useState } from "react";

import { avatarLookupFor, remoteSupportsAvatars, resolveAvatars } from "../lib/avatars";
import type { AvatarSettings, CommitSummary, RepositorySnapshot } from "../lib/types";
import { linkRemoteName } from "./branches";

const EMPTY: ReadonlyMap<string, string> = new Map();

/**
 * Resolves the avatars for the authors currently in view.
 *
 * Only addresses that have not been asked about before are sent, so paging
 * through history costs one request per new batch of authors and nothing at
 * all once the repository's authors are known. Everything else -- the network,
 * the credential, the cache -- lives in the backend.
 */
export function useAvatars(
    snapshot: RepositorySnapshot | null,
    commits: readonly CommitSummary[],
    settings: AvatarSettings,
): ReadonlyMap<string, string> {
    const [avatars, setAvatars] = useState<ReadonlyMap<string, string>>(EMPTY);
    const asked = useRef(new Set<string>());

    // The repository the authors belong to, which is what the hosting service
    // resolves them against.
    const remote = useMemo(() => {
        const name = linkRemoteName(snapshot);
        const candidate = snapshot?.remotes.find((entry) => entry.name === name) ?? null;
        return remoteSupportsAvatars(candidate) ? candidate : null;
    }, [snapshot]);

    const repositoryKey = remote?.web_url ?? "";
    const { enabled, gravatar_fallback: gravatarFallback } = settings;

    // A different repository, or a changed source, starts over: what was asked
    // before says nothing about what the new configuration would answer.
    useEffect(() => {
        asked.current = new Set();
        setAvatars(EMPTY);
    }, [enabled, gravatarFallback, repositoryKey]);

    const emails = useMemo(() => {
        const unique = new Set<string>();
        for (const commit of commits) {
            const email = commit.author.email.trim().toLowerCase();
            if (email) unique.add(email);
        }
        return [...unique].sort();
    }, [commits]);

    const tipOid = commits[0]?.oid ?? null;

    useEffect(() => {
        if (!remote || !enabled) return;
        const pending = emails.filter((email) => !asked.current.has(email));
        if (pending.length === 0) return;
        for (const email of pending) asked.current.add(email);

        const lookup = avatarLookupFor(remote, pending, tipOid);
        if (!lookup) return;

        let cancelled = false;
        resolveAvatars(lookup, { enabled, gravatar_fallback: gravatarFallback })
            .then((entries) => {
                if (cancelled || entries.length === 0) return;
                setAvatars((current) => {
                    const next = new Map(current);
                    for (const entry of entries) next.set(entry.email, entry.image);
                    return next;
                });
            })
            // A service that cannot be reached leaves the initials in place;
            // the authors are simply retried on the next repository open.
            .catch(() => { asked.current = new Set(); });

        return () => { cancelled = true; };
    }, [emails, enabled, gravatarFallback, remote, tipOid]);

    return avatars;
}
