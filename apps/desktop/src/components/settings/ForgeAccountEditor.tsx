import { Check, Copy, ExternalLink, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { forgeCredentials } from "../../lib/avatars";
import { forgeSignOut, pollForgeLogin, startForgeLogin } from "../../lib/forgeAuth";
import { isTauriEnvironment, openExternal } from "../../lib/platform";
import type { DeviceAuthorization, ForgeCredential } from "../../lib/types";
import { Button, IconButton, Input } from "../ui";
import { FIELD_INPUT } from "./SettingsField";

interface Notice {
  tone: "success" | "error";
  message: string;
}

// The sign-in is a device flow: GitCat shows a code, the user types it into the
// service's own page, and the backend collects the token by polling. Nothing
// here ever holds a credential -- not the device code, not the token.
export function ForgeAccountEditor() {
  const [credentials, setCredentials] = useState<ForgeCredential[]>([]);
  const [host, setHost] = useState("github.com");
  const [pending, setPending] = useState<DeviceAuthorization | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    void reload();
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function reload() {
    try {
      const stored = await forgeCredentials();
      if (!cancelled.current) setCredentials(stored);
    } catch {
      // An unreadable store shows as no accounts rather than as an error.
    }
  }

  // Polls until the user finishes on the service's page, the code expires, or
  // the component goes away. The interval is the one the service asked for.
  async function awaitAuthorization(authorization: DeviceAuthorization) {
    const deadline = Date.now() + authorization.expires_in_seconds * 1000;
    let wait = Math.max(authorization.interval_seconds, 1) * 1000;

    while (!cancelled.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (cancelled.current) return;

      let poll;
      try {
        poll = await pollForgeLogin(authorization.host);
      } catch (error) {
        setPending(null);
        setNotice({ tone: "error", message: message(error) });
        return;
      }

      if (poll.state === "complete") {
        setPending(null);
        setNotice({
          tone: "success",
          message: poll.account
            ? `Signed in to ${authorization.host} as ${poll.account.login}.`
            : `Signed in to ${authorization.host}.`,
        });
        await reload();
        return;
      }
      if (poll.state === "denied" || poll.state === "expired") {
        setPending(null);
        setNotice({
          tone: "error",
          message: poll.state === "denied"
            ? "The sign-in was refused on the verification page."
            : "The code expired before it was entered. Start again.",
        });
        return;
      }
      // Still pending. The backend raises the interval when the service asks
      // it to, so a slow poll is not an error.
      wait = Math.max(wait, authorization.interval_seconds * 1000);
    }

    if (!cancelled.current) {
      setPending(null);
      setNotice({ tone: "error", message: "The code expired. Start again." });
    }
  }

  async function signIn() {
    setNotice(null);
    setCopied(false);
    try {
      const authorization = await startForgeLogin(host.trim());
      setPending(authorization);
      // The code is useless without the page it goes into, so the page opens
      // with it. It stays on screen either way: a browser may refuse, and the
      // user may want to finish on another device.
      void openExternal(authorization.verification_uri).catch(() => undefined);
      void awaitAuthorization(authorization);
    } catch (error) {
      setNotice({ tone: "error", message: message(error) });
    }
  }

  async function signOut(target: string) {
    try {
      await forgeSignOut(target);
      await reload();
      setNotice({ tone: "success", message: `Signed out of ${target}.` });
    } catch (error) {
      setNotice({ tone: "error", message: message(error) });
    }
  }

  if (!isTauriEnvironment()) {
    return (
      <p className="text-[11px] leading-[1.45] text-muted">
        Signing in is only possible in the desktop application.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] leading-[1.45] text-muted">
        Signing in raises the request limit, reaches private repositories, and lets GitCat list the
        repositories you can clone. The token is kept in the operating system credential store and
        is never part of a settings export.
      </p>

      {credentials.map((credential) => (
        <div className="flex items-center gap-1.5 text-[11px]" key={credential.host}>
          <span className="min-w-0 grow truncate text-foreground">
            {credential.account ? `${credential.account} · ${credential.host}` : credential.host}
          </span>
          <span className="text-muted">
            {credential.kind === "oauth" ? "signed in" : "token"}
          </span>
          <span className="font-mono text-muted">{credential.hint}</span>
          <IconButton
            aria-label={`Sign out of ${credential.host}`}
            onClick={() => void signOut(credential.host)}
            title="Sign out"
          >
            <LogOut size={13} />
          </IconButton>
        </div>
      ))}

      {pending ? (
        <div className="flex flex-col gap-1.5 rounded-[5px] border border-border bg-background p-2.25">
          <p className="flex items-center gap-1 text-[11px] leading-[1.45] text-muted">
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
          <small className="text-[10px] text-muted">
            Waiting for you to authorise GitCat. This window can stay open.
          </small>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Input
            aria-label="Host"
            className={FIELD_INPUT}
            onChange={(event) => setHost(event.target.value)}
            placeholder="github.com"
            spellCheck={false}
            value={host}
          />
          <Button compact disabled={!host.trim()} onClick={() => void signIn()} tone="accent">
            Sign in
          </Button>
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
