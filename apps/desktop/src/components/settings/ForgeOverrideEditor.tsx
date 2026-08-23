import { Plus, X } from "lucide-react";
import { useState } from "react";

import { FORGE_KINDS, FORGE_LABELS } from "../../lib/forge";
import type { ForgeKind } from "../../lib/types";
import { Button, IconButton, Input } from "../ui";
import { FIELD_INPUT } from "./SettingsField";

interface OverrideRow {
  host: string;
  forge: ForgeKind;
}

// The stored map cannot hold a half-typed row, so editing happens on a list
// and only the rows that name a host reach the settings draft.
function toRows(overrides: Readonly<Record<string, ForgeKind>>): OverrideRow[] {
  return Object.entries(overrides).map(([host, forge]) => ({ host, forge }));
}

function toOverrides(rows: readonly OverrideRow[]): Record<string, ForgeKind> {
  const overrides: Record<string, ForgeKind> = {};
  for (const row of rows) {
    const host = row.host.trim().toLowerCase();
    if (host && !hostError(host) && row.forge !== "unknown") overrides[host] = row.forge;
  }
  return overrides;
}

// The backend matches against the host it parsed out of the remote URL, which
// carries no scheme, port, credentials or path.
function hostError(host: string): string | null {
  if (!host) return null;
  if (host.includes("://")) return "host only, without the scheme";
  if (/[/:@\s]/.test(host)) return "host only, without port or path";
  if (!host.includes(".")) return "expected a domain name";
  return null;
}

export function ForgeOverrideEditor({ overrides, onChange }: {
  overrides: Readonly<Record<string, ForgeKind>>;
  onChange: (overrides: Record<string, ForgeKind>) => void;
}) {
  const [rows, setRows] = useState<OverrideRow[]>(() => toRows(overrides));

  function commit(next: OverrideRow[]) {
    setRows(next);
    onChange(toOverrides(next));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] leading-[1.45] text-muted">
        GitCat recognises the public hosts on its own. Name a self-hosted install here so its
        commit and branch links use the right layout.
      </p>
      {rows.map((row, index) => {
        const error = hostError(row.host.trim().toLowerCase());
        return (
          <div className="flex flex-col gap-1" key={index}>
            <div className="flex items-center gap-1.5">
              <Input
                aria-label="Host"
                className={FIELD_INPUT}
                onChange={(event) => commit(rows.map((current, position) => (
                  position === index ? { ...current, host: event.target.value } : current
                )))}
                placeholder="git.example.com"
                spellCheck={false}
                value={row.host}
              />
              <select
                aria-label="Hosting service"
                className={FIELD_INPUT}
                onChange={(event) => commit(rows.map((current, position) => (
                  position === index ? { ...current, forge: event.target.value as ForgeKind } : current
                )))}
                value={row.forge}
              >
                {FORGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{FORGE_LABELS[kind]}</option>
                ))}
              </select>
              <IconButton
                aria-label="Remove host"
                onClick={() => commit(rows.filter((_, position) => position !== index))}
                title="Remove host"
              >
                <X size={13} />
              </IconButton>
            </div>
            {error ? <small className="text-[10px] text-danger">{error}</small> : null}
          </div>
        );
      })}
      <Button
        className="self-start"
        compact
        icon={<Plus size={13} />}
        onClick={() => commit([...rows, { host: "", forge: "github" }])}
      >
        Add host
      </Button>
    </div>
  );
}
