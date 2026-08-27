import { Cloud, Server } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ForgeKind } from "./types";

/**
 * How far GitCat can go with one hosting service.
 *
 * - `sign_in`: the device flow is registered for it, so an account can be
 *   connected from inside the application.
 * - `token`: there is a client for it, but no registered application, so the
 *   user brings a token of their own. Self-hosted GitHub is the case: an
 *   OAuth application has to be registered on the instance itself.
 * - `links_only`: the host is recognised and its links are built correctly,
 *   but nothing here talks to it -- no pull requests, checks, author pictures
 *   or repository list.
 */
export type IntegrationSupport = "sign_in" | "token" | "links_only";

export interface Integration {
    id: string;
    label: string;
    /** The one host it lives on, or `null` when the user names their own. */
    host: string | null;
    forge: ForgeKind;
    support: IntegrationSupport;
    icon: LucideIcon;
}

/**
 * The hosting services GitCat knows about, in the order they are offered.
 *
 * Every entry is listed even where GitCat can do little with it, because the
 * absence of an entry reads as "not supported yet" while a listed one can say
 * exactly what it does and does not do.
 */
export const INTEGRATIONS: readonly Integration[] = [
    { id: "github", label: "GitHub.com", host: "github.com", forge: "github", support: "sign_in", icon: Cloud },
    { id: "github-enterprise", label: "GitHub Enterprise Server", host: null, forge: "github", support: "token", icon: Server },
    { id: "gitlab", label: "GitLab.com", host: "gitlab.com", forge: "gitlab", support: "links_only", icon: Cloud },
    { id: "gitlab-self", label: "GitLab (Self-Managed)", host: null, forge: "gitlab", support: "links_only", icon: Server },
    { id: "bitbucket", label: "Bitbucket.org", host: "bitbucket.org", forge: "bitbucket", support: "links_only", icon: Cloud },
    { id: "bitbucket-data-center", label: "Bitbucket Data Center", host: null, forge: "bitbucket", support: "links_only", icon: Server },
    { id: "azure", label: "Azure DevOps", host: "dev.azure.com", forge: "azure_devops", support: "links_only", icon: Cloud },
    { id: "gitea", label: "Gitea / Forgejo", host: null, forge: "gitea", support: "links_only", icon: Server },
];

/**
 * Why a host cannot be used, or `null` when it can.
 *
 * The backend matches against the host it parsed out of the remote URL, which
 * carries no scheme, port, credentials or path.
 */
export function hostNameError(host: string): string | null {
    if (!host) return null;
    if (host.includes("://")) return "host only, without the scheme";
    if (/[/:@\s]/.test(host)) return "host only, without port or path";
    if (!host.includes(".")) return "expected a domain name";
    return null;
}

export function integrationById(id: string): Integration | undefined {
    return INTEGRATIONS.find((integration) => integration.id === id);
}

/**
 * The integration one host belongs to.
 *
 * A public host names itself. Anything else is a self-hosted install, which
 * only the settings override can place -- and an unplaced host belongs to no
 * integration rather than to a guessed one.
 */
export function integrationForHost(
    host: string,
    overrides: Readonly<Record<string, ForgeKind>> = {},
): Integration | undefined {
    const target = host.trim().toLowerCase();
    if (!target) return undefined;
    const public_ = INTEGRATIONS.find((integration) => integration.host === target);
    if (public_) return public_;
    const forge = overrides[target];
    if (!forge || forge === "unknown") return undefined;
    return INTEGRATIONS.find((integration) => integration.host === null && integration.forge === forge);
}

/** The hosts a self-hosted integration covers, taken from the overrides. */
export function selfHostedHosts(
    integration: Integration,
    overrides: Readonly<Record<string, ForgeKind>>,
): string[] {
    if (integration.host !== null) return [integration.host];
    return Object.entries(overrides)
        .filter(([, forge]) => forge === integration.forge)
        .map(([host]) => host)
        .sort((left, right) => left.localeCompare(right));
}
