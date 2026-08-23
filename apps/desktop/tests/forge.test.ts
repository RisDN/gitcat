import assert from "node:assert/strict";
import test from "node:test";

import { remoteBranchUrl, remoteCommitUrl, remoteIconUrls } from "../src/app/branches";
import { avatarLookupFor, remoteSupportsAvatars } from "../src/lib/avatars";
import { normalizeAppSettings } from "../src/app/workspace";
import {
    effectiveForge,
    forgeBranchUrl,
    forgeCommitUrl,
    forgeOwnerIconUrl,
    isForgeKind,
    withForgeOverrides,
} from "../src/lib/forge";
import type { ForgeKind, RemoteInfo, RepositorySnapshot } from "../src/lib/types";

const OID = "e90df7571bc1195ac454e29873f2bb2276f5dc04";

function remote(overrides: Partial<RemoteInfo> = {}): RemoteInfo {
    return {
        name: "origin",
        fetch_url: "git@github.com:ikoli/gitcat.git",
        push_url: "git@github.com:ikoli/gitcat.git",
        url: {
            scheme: "scp_like",
            host: "github.com",
            path: "ikoli/gitcat",
            owner: "ikoli",
            repo: "gitcat",
        },
        forge: "github",
        web_url: "https://github.com/ikoli/gitcat",
        ...overrides,
    };
}

function snapshot(...remotes: RemoteInfo[]): RepositorySnapshot {
    return {
        generation: "1",
        head: { kind: "branch", name: "main", oid: OID },
        operation_state: "normal",
        status: { clean: true, entries: [] },
        local_branches: [],
        remote_branches: [],
        tags: [],
        remotes,
        capabilities: { shallow: false, partial_clone: false, sparse_checkout: false, worktree: false },
    };
}

test("commit links follow each forge's own layout", () => {
    const base = "https://host.test/team/tool";
    assert.equal(forgeCommitUrl(base, "github", OID), `${base}/commit/${OID}`);
    assert.equal(forgeCommitUrl(base, "gitea", OID), `${base}/commit/${OID}`);
    assert.equal(forgeCommitUrl(base, "gitlab", OID), `${base}/-/commit/${OID}`);
    assert.equal(forgeCommitUrl(base, "bitbucket", OID), `${base}/commits/${OID}`);
    // An unrecognised host follows GitHub, which most self-hosted forges copy.
    assert.equal(forgeCommitUrl(base, "unknown", OID), `${base}/commit/${OID}`);
});

test("branch links follow each forge's own layout", () => {
    const base = "https://host.test/team/tool";
    assert.equal(forgeBranchUrl(base, "github", "main"), `${base}/tree/main`);
    assert.equal(forgeBranchUrl(base, "gitlab", "main"), `${base}/-/tree/main`);
    assert.equal(forgeBranchUrl(base, "bitbucket", "main"), `${base}/src/main/`);
    assert.equal(forgeBranchUrl(base, "gitea", "main"), `${base}/src/branch/main`);
    assert.equal(forgeBranchUrl(base, "azure_devops", "main"), `${base}?version=GBmain`);
});

test("a slash in a branch name stays a path separator", () => {
    const base = "https://host.test/team/tool";
    assert.equal(forgeBranchUrl(base, "github", "feature/diff viewer"), `${base}/tree/feature/diff%20viewer`);
    // Azure passes the branch as one query value, so the slash is escaped.
    assert.equal(forgeBranchUrl(base, "azure_devops", "feature/x"), `${base}?version=GBfeature%2Fx`);
});

test("only GitHub serves an owner avatar under a bare path", () => {
    assert.equal(
        forgeOwnerIconUrl(remote(), "github"),
        "https://github.com/ikoli.png?size=32",
    );
    assert.equal(forgeOwnerIconUrl(remote(), "gitlab"), null);
    assert.equal(forgeOwnerIconUrl(remote({ url: undefined }), "github"), null);
});

test("an override names the forge of a host the backend could not recognise", () => {
    const selfHosted = remote({
        fetch_url: "git@git.example.test:team/tool.git",
        push_url: "git@git.example.test:team/tool.git",
        url: {
            scheme: "scp_like",
            host: "git.example.test",
            path: "team/tool",
            owner: "team",
            repo: "tool",
        },
        forge: "unknown",
        web_url: "https://git.example.test/team/tool",
    });
    const overrides: Record<string, ForgeKind> = { "git.example.test": "gitlab" };

    assert.equal(effectiveForge(selfHosted, overrides), "gitlab");
    assert.equal(effectiveForge(selfHosted, {}), "unknown");
    // A recognised host is not overridden by an entry for a different host.
    assert.equal(effectiveForge(remote(), overrides), "github");

    const overridden = withForgeOverrides(snapshot(selfHosted), overrides);
    assert.equal(
        remoteCommitUrl(overridden, "origin", OID),
        `https://git.example.test/team/tool/-/commit/${OID}`,
    );
});

test("an unchanged snapshot keeps its identity so memoised consumers do not rerun", () => {
    const unchanged = snapshot(remote());
    assert.equal(withForgeOverrides(unchanged, {}), unchanged);
    assert.equal(withForgeOverrides(unchanged, { "other.test": "gitea" }), unchanged);
});

test("a remote without a web url offers no links", () => {
    const local = snapshot(remote({
        fetch_url: "/srv/git/tool.git",
        push_url: "/srv/git/tool.git",
        url: undefined,
        forge: "unknown",
        web_url: undefined,
    }));
    assert.equal(remoteCommitUrl(local, "origin", OID), null);
    assert.equal(remoteBranchUrl(local, "origin", "main"), null);
    assert.equal(remoteCommitUrl(snapshot(remote()), "upstream", OID), null);
    assert.equal(remoteIconUrls(local.remotes).size, 0);
});

test("remote icons are keyed by remote name", () => {
    const icons = remoteIconUrls(snapshot(remote()).remotes);
    assert.equal(icons.get("origin"), "https://github.com/ikoli.png?size=32");
});

test("stored overrides are sanitised to bare lower-case hosts", () => {
    const settings = normalizeAppSettings({
        forge_overrides: {
            "Git.Example.Test": "gitlab",
            "https://git.other.test": "gitea",
            "git.third.test/team": "gitea",
            "git.fourth.test": "not-a-forge",
            "git.fifth.test": "unknown",
        },
    });
    assert.deepEqual(settings.forge_overrides, { "git.example.test": "gitlab" });
});

test("only a GitHub remote with an owner and repository can resolve avatars", () => {
    assert.ok(remoteSupportsAvatars(remote()));
    assert.ok(!remoteSupportsAvatars(remote({ forge: "gitlab" })));
    assert.ok(!remoteSupportsAvatars(remote({ url: undefined })));
    assert.ok(!remoteSupportsAvatars(null));
});

test("a lookup carries the repository, the forge and the page tip", () => {
    assert.deepEqual(avatarLookupFor(remote(), ["a@b.test"], OID), {
        host: "github.com",
        owner: "ikoli",
        repo: "gitcat",
        forge: "github",
        tip_oid: OID,
        emails: ["a@b.test"],
    });
    // Without a tip the service walks from the default branch instead.
    assert.deepEqual(avatarLookupFor(remote(), [], null)?.tip_oid, undefined);
    assert.equal(avatarLookupFor(remote({ url: undefined }), ["a@b.test"], OID), null);
});

test("avatar settings fall back to the defaults, not to enabled Gravatar", () => {
    assert.deepEqual(normalizeAppSettings({}).avatars, {
        enabled: true,
        gravatar_fallback: false,
    });
    assert.deepEqual(
        normalizeAppSettings({ avatars: { enabled: false, gravatar_fallback: "yes" } }).avatars,
        { enabled: false, gravatar_fallback: false },
    );
});

test("forge kinds are recognised by name", () => {
    assert.ok(isForgeKind("github"));
    assert.ok(!isForgeKind("sourcehut"));
});
