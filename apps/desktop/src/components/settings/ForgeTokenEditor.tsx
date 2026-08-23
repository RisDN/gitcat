import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { forgeCredentials, setForgeToken } from "../../lib/avatars";
import { isTauriEnvironment } from "../../lib/platform";
import type { ForgeCredential } from "../../lib/types";
import { Button, IconButton, Input } from "../ui";
import { FIELD_INPUT } from "./SettingsField";

// Tokens are not part of the settings draft: they live in their own file so a
// settings export cannot carry one, which also means saving one here takes
// effect immediately rather than when the dialog is saved.
export function ForgeTokenEditor() {
  const [credentials, setCredentials] = useState<ForgeCredential[]>([]);
  const [host, setHost] = useState("github.com");
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    forgeCredentials()
      .then((stored) => { if (!cancelled) setCredentials(stored); })
      .catch(() => { /* an unreadable store shows as no tokens */ });
    return () => { cancelled = true; };
  }, []);

  async function store(nextHost: string, nextToken: string | null) {
    try {
      await setForgeToken(nextHost, nextToken);
      setCredentials(await forgeCredentials());
      setToken("");
      setNotice({
        tone: "success",
        message: nextToken ? `Token saved for ${nextHost}.` : `Token removed for ${nextHost}.`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!isTauriEnvironment()) {
    return (
      <p className="text-[11px] leading-[1.45] text-muted">
        Tokens can only be stored by the desktop application.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] leading-[1.45] text-muted">
        A token raises the request limit and reaches private repositories. It is stored outside the
        settings file and never included in an export.
      </p>

      {credentials.map((credential) => (
        <div className="flex items-center gap-1.5 text-[11px]" key={credential.host}>
          <span className="min-w-0 grow truncate text-foreground">{credential.host}</span>
          <span className="font-mono text-muted">{credential.hint}</span>
          <IconButton
            aria-label={`Remove the token for ${credential.host}`}
            onClick={() => void store(credential.host, null)}
            title="Remove token"
          >
            <X size={13} />
          </IconButton>
        </div>
      ))}

      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Host"
          className={FIELD_INPUT}
          onChange={(event) => setHost(event.target.value)}
          placeholder="github.com"
          spellCheck={false}
          value={host}
        />
        <Input
          aria-label="Access token"
          className={FIELD_INPUT}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Access token"
          type="password"
          value={token}
        />
        <Button
          compact
          disabled={!host.trim() || !token.trim()}
          onClick={() => void store(host.trim(), token.trim())}
        >
          Save
        </Button>
      </div>

      {notice ? (
        <small className={notice.tone === "error" ? "text-[10px] text-danger" : "text-[10px] text-muted"}>
          {notice.message}
        </small>
      ) : null}
    </div>
  );
}
