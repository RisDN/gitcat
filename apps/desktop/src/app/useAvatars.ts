import { useEffect, useMemo, useRef, useState } from "react";

import {
    avatarEmailsToAsk,
    avatarLookupFor,
    remoteSupportsAvatars,
    resolveAvatars,
} from "../lib/avatars";
import type { AvatarSettings, CommitSummary, RepositorySnapshot } from "../lib/types";
import { linkRemoteName } from "./branches";

const EMPTY: ReadonlyMap<string, string> = new Map();

/**
 * Resolves the avatars for the authors currently in view.
 *
 * Only addresses that have not been answered before are sent, so paging
 * through history costs one request per new batch of authors and nothing at
 * all once the repository's authors are known. An address that stayed
 * unresolved is asked again once history advances -- a commit that has since
 * been pushed, or a request that did not get through, resolves on the next
 * tip -- so an author does not keep their initial until the next restart.
 * Everything else -- the network, the credential, the cache -- lives in the
 * backend.
 */
export function useAvatars(
    snapshot: RepositorySnapshot | null,
    commits: readonly CommitSummary[],
    settings: AvatarSettings,
): ReadonlyMap<string, string> {
    const [avatars, setAvatars] = useState<ReadonlyMap<string, string>>(EMPTY);
    const asked = useRef(new Set<string>());
    // Asked about and still without a picture, plus the tip they were asked
    // about, which is what a retry waits for.
    const unresolved = useRef(new Set<string>());
    const askedTip = useRef<string | null>(null);

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
        unresolved.current = new Set();
        askedTip.current = null;
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
        const tipMoved = tipOid !== askedTip.current;
        const pending = avatarEmailsToAsk(emails, asked.current, unresolved.current, tipMoved);
        if (pending.length === 0) return;
        askedTip.current = tipOid;
        for (const email of pending) {
            asked.current.add(email);
            unresolved.current.add(email);
        }

        const lookup = avatarLookupFor(remote, pending, tipOid);
        if (!lookup) return;

        let cancelled = false;
        resolveAvatars(lookup, { enabled, gravatar_fallback: gravatarFallback })
            .then((entries) => {
                if (cancelled) return;
                for (const entry of entries) unresolved.current.delete(entry.email);
                if (entries.length === 0) return;
                setAvatars((current) => {
                    const next = new Map(current);
                    for (const entry of entries) next.set(entry.email, entry.image);
                    return next;
                });
            })
            // A service that cannot be reached leaves the initials in place;
            // clearing the record asks for the whole set again rather than
            // holding a failed round against the authors in it.
            .catch(() => { asked.current = new Set(); });

        return () => { cancelled = true; };
    }, [emails, enabled, gravatarFallback, remote, tipOid]);

    return avatars;
}
