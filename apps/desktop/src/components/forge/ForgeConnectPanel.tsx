import { Check, CircleCheck, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import {
  cancelForgeSignIn,
  connectForge,
  credentialFor,
  disconnectForge,
  storeForgeToken,
  useForgeConnections,
} from "../../app/forgeConnections";
import { cx, identityInitials } from "../../lib";
import { forgeAccount } from "../../lib/forgeAuth";
import { hostNameError } from "../../lib/integrations";
import type { Integration } from "../../lib/integrations";
import { isTauriEnvironment, openExternal } from "../../lib/platform";
import type { ForgeAccount, ForgeCredential } from "../../lib/types";
import { Button, IconButton, Input } from "../ui";

const FIELD =
  "h-8.5 w-full rounded-[5px] border border-border bg-background px-2.25 outline-0 focus:border-accent";

/**
 * The connection state of one hosting service, with whatever it takes to
 * connect it.
 *
 * The same block serves preferences and the start dialogs, so a service that
 * is not connected offers the connection where the user ran into it rather
 * than sending them to another window. Handing over a token is the exception:
 * that belongs on the preferences page (`allowToken`), where the host list it
 * goes with lives. Everywhere else the service says it is not connected and
 * the button stays inert, which is the honest state of a service GitCat has
 * no registered application for.
 */
export function ForgeConnectPanel({
  allowToken = false,
  className = "",
  host,
  integration,
  onHostNamed,
}: {
  /** Offer an access token, and an address for a self-hosted install. */
  allowToken?: boolean;
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
  const account = useForgeAccount(host, credential);
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

  const candidate = draftHost.trim().toLowerCase();
  const candidateError = hostNameError(candidate);
  const target = host ?? candidate;
  const tokenReady = Boolean(target) && !candidateError && Boolean(token.trim());
  const takesToken = allowToken && integration.support === "token";

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
        <ConnectedAccount
          account={account}
          credential={credential}
          host={host ?? ""}
          onDisconnect={() => { if (host) void disconnectForge(host); }}
        />
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
      ) : takesToken ? (
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
      ) : integration.support === "links_only" ? (
        <p className="rounded-[7px] border border-border bg-background/45 px-3.5 py-3 text-[11px] leading-[1.5] text-muted">
          GitCat recognises {integration.label} hosts and builds their commit and branch links, but
          it has no client for them: no pull requests, check state, author pictures or repository
          list. Cloning and pushing work through Git itself, with your own credentials.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-2.5 rounded-[7px] border border-border bg-background/45 px-4 py-6 text-center">
          <p className="text-[12px] text-muted">
            {host && integration.host === null
              ? `${host} is not connected`
              : `${integration.label} is not connected`}
          </p>
          <Button
            disabled={integration.support !== "sign_in" || !host || connections.pending !== null}
            onClick={() => { if (host) void connectForge(host); }}
            tone="accent"
          >
            Connect to {integration.label}
          </Button>
          {integration.support === "token" ? (
            <small className="max-w-[420px] text-[10px] leading-[1.5] text-muted/72">
              Signing in needs an OAuth application registered on the instance itself, which GitCat
              cannot ship. Connect it with an access token under Integrations in the preferences.
            </small>
          ) : null}
        </div>
      )}

      {notice ? (
        <small className={notice.tone === "error" ? "text-[10px] text-danger" : "text-[10px] text-muted"}>
          {notice.message}
        </small>
      ) : null}
    </div>
  );
}

/**
 * The account one connection belongs to: its picture, the name the service
 * shows it under, and the way out of it.
 *
 * The credential store never gives up more than a host and a hint, so who the
 * credential belongs to is asked of the service itself; until it answers, and
 * whenever it will not, the card falls back to what the credential already
 * knows.
 */
function ConnectedAccount({
  account,
  credential,
  host,
  onDisconnect,
}: {
  account: ForgeAccount | null;
  credential: ForgeCredential;
  host: string;
  onDisconnect: () => void;
}) {
  const name = account?.name ?? account?.login ?? credential.account ?? host;
  const handle = account?.login ?? credential.account;
  const secondary = handle && handle !== name ? handle : host;

  return (
    <div className="flex items-center gap-2.5 rounded-[7px] border border-border bg-background/45 px-3 py-2.5">
      <AccountPicture name={name} url={account?.avatar_url} />
      <div className="min-w-0">
        <div className="truncate text-[12px] font-[650] text-foreground">{name}</div>
        <div className="truncate text-[11px] text-muted">{secondary}</div>
      </div>
      <span className="mx-auto flex shrink-0 items-center gap-1.5 px-2 text-[12px] font-[600] text-success">
        <CircleCheck size={15} />
        Connected
      </span>
      <Button
        aria-label={`Disconnect from ${host}`}
        compact
        onClick={onDisconnect}
        tone="danger"
      >
        Disconnect
      </Button>
    </div>
  );
}

/** The account's picture, or its initials while there is none to draw. */
function AccountPicture({ name, url }: { name: string; url?: string }) {
  const [failed, setFailed] = useState(false);
  const shape = "size-9 shrink-0 rounded-[5px] border border-border";

  if (url && !failed) {
    return (
      <img
        alt=""
        className={cx(shape, "object-cover")}
        onError={() => setFailed(true)}
        src={url}
      />
    );
  }
  return (
    <span className={cx(shape, "grid place-items-center text-[12px] font-extrabold text-accent")}>
      {identityInitials(name) || "?"}
    </span>
  );
}

/**
 * The account behind a stored credential, asked of the service once per
 * credential.
 *
 * The answer is kept for the host and the credential it was asked about, so
 * reopening the dialog does not spend the request limit again while a new
 * credential on the same host is looked up afresh. A failed lookup is not
 * remembered: it is usually the network, and the card reads fine without it.
 */
const accounts = new Map<string, ForgeAccount | null>();

function useForgeAccount(
  host: string | null,
  credential: ForgeCredential | undefined,
): ForgeAccount | null {
  const key = host && credential
    ? `${host.toLowerCase()}:${credential.kind}:${credential.hint}`
    : null;
  const [account, setAccount] = useState<ForgeAccount | null>(
    () => (key ? accounts.get(key) ?? null : null),
  );

  useEffect(() => {
    if (!key || !host) {
      setAccount(null);
      return;
    }
    const cached = accounts.get(key);
    if (cached !== undefined) {
      setAccount(cached);
      return;
    }
    let live = true;
    void forgeAccount(host)
      .then((found) => {
        accounts.set(key, found);
        if (live) setAccount(found);
      })
      .catch(() => { if (live) setAccount(null); });
    return () => { live = false; };
  }, [host, key]);

  return account;
}
