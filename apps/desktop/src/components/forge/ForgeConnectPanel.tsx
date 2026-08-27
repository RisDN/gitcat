import { Check, CircleCheck, Copy, ExternalLink, LogOut } from "lucide-react";
import { useState } from "react";

import {
  cancelForgeSignIn,
  connectForge,
  credentialFor,
  disconnectForge,
  storeForgeToken,
  useForgeConnections,
} from "../../app/forgeConnections";
import { cx } from "../../lib";
import { hostNameError } from "../../lib/integrations";
import type { Integration } from "../../lib/integrations";
import { isTauriEnvironment, openExternal } from "../../lib/platform";
import { Button, IconButton, Input } from "../ui";

const FIELD =
  "h-8.5 w-full rounded-[5px] border border-border bg-background px-2.25 outline-0 focus:border-accent";

/**
 * The connection state of one hosting service, with whatever it takes to
 * connect it.
 *
 * The same block serves preferences and the start dialogs, so a service that
 * is not connected offers the connection where the user ran into it rather
 * than sending them to another window. A self-hosted service with no host
 * named yet is the same case: `onHostNamed` lets the panel take the address
 * along with the token, so naming the install is part of connecting it.
 */
export function ForgeConnectPanel({
  className = "",
  host,
  integration,
  onHostNamed,
}: {
  className?: string;
  /** The install to connect, or `null` for a self-hosted one not named yet. */
  host: string | null;
  integration: Integration;
  onHostNamed?: (host: string) => void;
}) {
  const connections = useForgeConnections();
  const [token, setToken] = useState("");
  const [draftHost, setDraftHost] = useState("");
  const [copied, setCopied] = useState(false);
  const credential = host ? credentialFor(connections, host) : undefined;
  const pending = host && connections.pending?.host === host.toLowerCase()
    ? connections.pending
    : null;
  const notice = host && connections.notice?.host === host.toLowerCase()
    ? connections.notice
    : null;

  if (!isTauriEnvironment()) {
    return (
      <p className={cx("text-[11px] leading-[1.45] text-muted", className)}>
        Connecting to a hosting service is only possible in the desktop application.
      </p>
    );
  }

  // A self-hosted install with no address yet, and nowhere in this dialog to
  // put one: preferences is where the host list lives.
  if (!host && !onHostNamed) {
    return (
      <p className={cx("rounded-[7px] border border-border bg-background/45 px-3.5 py-3 text-[11px] leading-[1.5] text-muted", className)}>
        No {integration.label} host is named yet. Add one under Integrations in the preferences,
        then come back here.
      </p>
    );
  }

  const candidate = draftHost.trim().toLowerCase();
  const candidateError = hostNameError(candidate);
  const target = host ?? candidate;
  const tokenReady = Boolean(target) && !candidateError && Boolean(token.trim());

  const connectWithToken = () => {
    if (!tokenReady) return;
    // Naming the install is what tells the rest of GitCat which service
    // answers there, so it is recorded with the credential rather than after.
    if (!host) onHostNamed?.(target);
    void storeForgeToken(target, token.trim());
    setToken("");
  };

  return (
    <div className={cx("flex flex-col gap-2.5", className)}>
      {credential ? (
        <div className="flex items-center gap-2 rounded-[5px] border border-[color-mix(in_srgb,var(--gc-success)_45%,var(--gc-border))] bg-[color-mix(in_srgb,var(--gc-success)_8%,var(--gc-background))] px-2.5 py-2 text-[11px]">
          <CircleCheck className="shrink-0 text-success" size={14} />
          <span className="min-w-0 grow truncate text-foreground">
            {credential.account
              ? `Connected to ${host} as ${credential.account}`
              : `Connected to ${host}`}
          </span>
          <span className="shrink-0 text-muted">
            {credential.kind === "oauth" ? "signed in" : "token"} {credential.hint}
          </span>
          <IconButton
            aria-label={`Disconnect from ${host}`}
            onClick={() => { if (host) void disconnectForge(host); }}
            title="Disconnect"
          >
            <LogOut size={13} />
          </IconButton>
        </div>
      ) : pending ? (
        <div className="flex flex-col gap-1.5 rounded-[5px] border border-border bg-background p-2.5">
          <p className="flex flex-wrap items-center gap-1 text-[11px] leading-[1.45] text-muted">
            Open <span className="text-foreground">{pending.verification_uri}</span>
            <IconButton
              aria-label="Open the verification page"
              onClick={() => { void openExternal(pending.verification_uri).catch(() => undefined); }}
              title="Open in browser"
            >
              <ExternalLink size={13} />
            </IconButton>
            and enter this code:
          </p>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[15px] tracking-[0.18em] text-foreground">
              {pending.user_code}
            </span>
            <IconButton
              aria-label="Copy the sign-in code"
              onClick={() => {
                void navigator.clipboard.writeText(pending.user_code)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
              title="Copy code"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </IconButton>
          </div>
          <div className="flex items-center gap-2">
            <small className="grow text-[10px] text-muted">
              Waiting for you to authorise GitCat. This window can be closed.
            </small>
            <Button compact onClick={() => cancelForgeSignIn()}>Cancel</Button>
          </div>
        </div>
      ) : integration.support === "sign_in" ? (
        <div className="flex flex-col items-center gap-2.5 rounded-[7px] border border-border bg-background/45 px-4 py-6 text-center">
          <p className="text-[12px] text-muted">{integration.label} is not connected</p>
          <Button
            disabled={connections.pending !== null || !host}
            onClick={() => { if (host) void connectForge(host); }}
            tone="accent"
          >
            Connect to {integration.label}
          </Button>
        </div>
      ) : integration.support === "token" ? (
        <div className="flex flex-col gap-2 rounded-[7px] border border-border bg-background/45 px-3.5 py-3">
          <p className="text-[12px] text-muted">
            {host ? `${host} is not connected` : `${integration.label} is not connected`}
          </p>
          <p className="text-[10px] leading-[1.5] text-muted/72">
            Signing in needs an OAuth application registered on the instance itself, which GitCat
            cannot ship. A personal access token connects it instead.
          </p>
          {host ? null : (
            <Input
              aria-label={`Host of the ${integration.label} install`}
              className={FIELD}
              onChange={(event) => setDraftHost(event.target.value)}
              placeholder="git.example.com"
              spellCheck={false}
              value={draftHost}
            />
          )}
          <div className="flex items-center gap-1.5">
            <Input
              aria-label={`Access token for ${target || integration.label}`}
              className={FIELD}
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") connectWithToken(); }}
              placeholder="Access token"
              type="password"
              value={token}
            />
            <Button compact disabled={!tokenReady} onClick={connectWithToken} tone="accent">
              Connect
            </Button>
          </div>
          {candidateError ? (
            <small className="text-[10px] text-danger">{candidateError}</small>
          ) : null}
        </div>
      ) : (
        <p className="rounded-[7px] border border-border bg-background/45 px-3.5 py-3 text-[11px] leading-[1.5] text-muted">
          GitCat recognises {integration.label} hosts and builds their commit and branch links, but
          it has no client for them: no pull requests, check state, author pictures or repository
          list. Cloning and pushing work through Git itself, with your own credentials.
        </p>
      )}

      {notice ? (
        <small className={notice.tone === "error" ? "text-[10px] text-danger" : "text-[10px] text-muted"}>
          {notice.message}
        </small>
      ) : null}
    </div>
  );
}
