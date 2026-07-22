import { RotateCcw } from "lucide-react";
import { useState } from "react";

import type { AppSettings, PullMode, ThemeColors } from "../lib/types";
import { Button, Modal } from "./Primitives";

const COLOR_FIELDS: Array<[keyof ThemeColors, string]> = [
  ["background", "Background"],
  ["surface", "Surface"],
  ["panel", "Panel"],
  ["border", "Border"],
  ["text", "Text"],
  ["muted_text", "Muted text"],
  ["accent", "Accent"],
  ["success", "Success"],
  ["warning", "Warning"],
  ["danger", "Danger"],
  ["diff_addition", "Diff addition"],
  ["diff_deletion", "Diff deletion"],
];

interface SettingsDialogProps {
  settings: AppSettings;
  defaults: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, defaults, onSave, onClose }: SettingsDialogProps) {
  const [draft, setDraft] = useState<AppSettings>(() => structuredClone(settings));
  const updateColor = (field: keyof ThemeColors, value: string) => {
    setDraft((current) => ({ ...current, theme: { ...current.theme, [field]: value } }));
  };

  return (
    <Modal
      description="Git behavior, performance limits, and semantic interface colors."
      footer={
        <>
          <Button icon={<RotateCcw size={15} />} onClick={() => setDraft(structuredClone(defaults))}>Reset defaults</Button>
          <span className="gc-modal__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(draft)} tone="accent">Save changes</Button>
        </>
      }
      onClose={onClose}
      title="Preferences"
      width="large"
    >
      <div className="gc-settings-grid">
        <section>
          <h3>Git behavior</h3>
          <label className="gc-field">
            <span>Default pull mode</span>
            <select
              onChange={(event) => setDraft((current) => ({ ...current, default_pull_mode: event.target.value as PullMode }))}
              value={draft.default_pull_mode}
            >
              <option value="merge">Merge (fast-forward if possible)</option>
              <option value="fast_forward_only">Fast-forward only</option>
              <option value="rebase">Rebase</option>
            </select>
          </label>
          <label className="gc-field">
            <span>Auto-fetch interval <small>minutes, 0 disables</small></span>
            <input
              max={60}
              min={0}
              onChange={(event) => setDraft((current) => ({ ...current, auto_fetch_interval_minutes: Number(event.target.value) }))}
              type="number"
              value={draft.auto_fetch_interval_minutes}
            />
          </label>
          <label className="gc-check-field">
            <input
              checked={draft.auto_prune}
              onChange={(event) => setDraft((current) => ({ ...current, auto_prune: event.target.checked }))}
              type="checkbox"
            />
            Prune stale remote branches when fetching
          </label>
          <h3>Performance</h3>
          <label className="gc-field">
            <span>Commits per page</span>
            <input
              max={500}
              min={1}
              onChange={(event) => setDraft((current) => ({ ...current, history_page_size: Number(event.target.value) }))}
              type="number"
              value={draft.history_page_size}
            />
          </label>
          <label className="gc-field">
            <span>Diff context lines</span>
            <input
              max={100}
              min={0}
              onChange={(event) => setDraft((current) => ({ ...current, diff_context_lines: Number(event.target.value) }))}
              type="number"
              value={draft.diff_context_lines}
            />
          </label>
        </section>
        <section>
          <h3>Interface colors</h3>
          <div className="gc-color-grid">
            {COLOR_FIELDS.map(([field, label]) => (
              <label key={field}>
                <input
                  aria-label={label}
                  onChange={(event) => updateColor(field, event.target.value)}
                  type="color"
                  value={draft.theme[field] as string}
                />
                <span>{label}</span>
                <code>{draft.theme[field] as string}</code>
              </label>
            ))}
          </div>
          <h3>Graph lanes</h3>
          <div className="gc-palette-editor">
            {draft.theme.graph_palette.map((color, index) => (
              <input
                aria-label={`Graph lane ${index + 1}`}
                key={`${index}:${color}`}
                onChange={(event) => {
                  const graph_palette = [...draft.theme.graph_palette];
                  graph_palette[index] = event.target.value;
                  setDraft((current) => ({ ...current, theme: { ...current.theme, graph_palette } }));
                }}
                type="color"
                value={color}
              />
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
