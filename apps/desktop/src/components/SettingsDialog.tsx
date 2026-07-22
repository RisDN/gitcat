import { Keyboard, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import type { AppSettings, PullMode, ThemeColors } from "../lib/types";
import {
  DEFAULT_KEYBINDS,
  duplicateKeybinds,
  keybindFromEvent,
  keybindValidationError,
  KEYBIND_DEFINITIONS,
  type KeybindAction,
} from "../lib/keybinds";
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
  const [recording, setRecording] = useState<KeybindAction | null>(null);
  const [captureError, setCaptureError] = useState<{ action: KeybindAction; message: string } | null>(null);
  const duplicateActions = useMemo(() => duplicateKeybinds(draft.keybinds), [draft.keybinds]);
  const updateColor = (field: keyof ThemeColors, value: string) => {
    setDraft((current) => ({ ...current, theme: { ...current.theme, [field]: value } }));
  };

  return (
    <Modal
      description="Git behavior, interface colors, and keyboard shortcuts."
      footer={
        <>
          <Button icon={<RotateCcw size={15} />} onClick={() => setDraft(structuredClone(defaults))}>Reset defaults</Button>
          <span className="gc-modal__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={duplicateActions.size > 0} onClick={() => onSave(draft)} tone="accent">Save changes</Button>
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
        <section className="gc-settings-keybinds">
          <h3><Keyboard size={14} /> Keybinds</h3>
          <p>Click a shortcut, then press the new key combination. Backspace/Delete clears it. Duplicate and reserved shortcuts are rejected.</p>
          <div className="gc-keybind-list">
            {KEYBIND_DEFINITIONS.map((definition) => {
              const duplicate = duplicateActions.has(definition.action);
              return (
                <div className={`gc-keybind-row${duplicate ? " gc-keybind-row--duplicate" : ""}`} key={definition.action}>
                  <div>
                    <strong>{definition.label}</strong>
                    <span>{definition.description}</span>
                    <small>{definition.scope}</small>
                  </div>
                  <button
                    aria-label={`Change ${definition.label} shortcut`}
                    className={recording === definition.action ? "gc-keybind-capture gc-keybind-capture--recording" : "gc-keybind-capture"}
                    onBlur={() => setRecording((current) => current === definition.action ? null : current)}
                    onClick={() => {
                      setCaptureError(null);
                      setRecording(definition.action);
                    }}
                    onKeyDown={(event) => {
                      if (recording !== definition.action) return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (event.key === "Escape") {
                        setRecording(null);
                        return;
                      }
                      if (event.key === "Backspace" || event.key === "Delete") {
                        setDraft((current) => ({
                          ...current,
                          keybinds: { ...current.keybinds, [definition.action]: "" },
                        }));
                        setCaptureError(null);
                        setRecording(null);
                        return;
                      }
                      const binding = keybindFromEvent(event.nativeEvent);
                      if (!binding) return;
                      const validationError = keybindValidationError(binding);
                      if (validationError) {
                        setCaptureError({ action: definition.action, message: validationError });
                        setRecording(null);
                        return;
                      }
                      setDraft((current) => ({
                        ...current,
                        keybinds: { ...current.keybinds, [definition.action]: binding },
                      }));
                      setCaptureError(null);
                      setRecording(null);
                    }}
                    type="button"
                  >
                    <kbd>{recording === definition.action ? "Press keys…" : draft.keybinds[definition.action] || "Unassigned"}</kbd>
                  </button>
                  <button
                    aria-label={`Reset ${definition.label} shortcut`}
                    className="gc-keybind-reset"
                    disabled={draft.keybinds[definition.action] === DEFAULT_KEYBINDS[definition.action]}
                    onClick={() => setDraft((current) => ({
                      ...current,
                      keybinds: { ...current.keybinds, [definition.action]: DEFAULT_KEYBINDS[definition.action] },
                    }))}
                    title="Reset shortcut"
                    type="button"
                  >
                    <RotateCcw size={13} />
                  </button>
                  {duplicate ? <span className="gc-keybind-error">Duplicate</span> : null}
                  {captureError?.action === definition.action ? <span className="gc-keybind-error">{captureError.message}</span> : null}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
}
