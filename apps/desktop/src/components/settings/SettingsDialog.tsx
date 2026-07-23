import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { duplicateKeybinds } from "../../lib/keybinds";
import type { AppSettings, PullMode, ThemeColors } from "../../lib/types";
import { Button, Input, Modal, ModalSpacer } from "../ui";
import { KeybindEditor } from "./KeybindEditor";
import { CheckField, FIELD_INPUT, Field, SectionHeading } from "./SettingsField";
import { ThemeEditor } from "./ThemeEditor";

interface SettingsDialogProps {
  settings: AppSettings;
  defaults: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, defaults, onSave, onClose }: SettingsDialogProps) {
  const [draft, setDraft] = useState<AppSettings>(() => structuredClone(settings));
  const duplicateActions = useMemo(() => duplicateKeybinds(draft.keybinds), [draft.keybinds]);

  return (
    <Modal
      description="Git behavior, interface colors, and keyboard shortcuts."
      footer={
        <>
          <Button icon={<RotateCcw size={15} />} onClick={() => setDraft(structuredClone(defaults))}>Reset defaults</Button>
          <ModalSpacer />
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={duplicateActions.size > 0} onClick={() => onSave(draft)} tone="accent">Save changes</Button>
        </>
      }
      onClose={onClose}
      title="Preferences"
      width="large"
    >
      <div className="grid grid-cols-[minmax(260px,0.8fr)_minmax(330px,1.2fr)] gap-7 max-[1080px]:grid-cols-1">
        <section className="min-w-0">
          <SectionHeading>Git behavior</SectionHeading>
          <Field label="Default pull mode">
            <select
              className={FIELD_INPUT}
              onChange={(event) => setDraft((current) => ({ ...current, default_pull_mode: event.target.value as PullMode }))}
              value={draft.default_pull_mode}
            >
              <option value="merge">Merge (fast-forward if possible)</option>
              <option value="fast_forward_only">Fast-forward only</option>
              <option value="rebase">Rebase</option>
            </select>
          </Field>
          <Field hint="minutes, 0 disables" label="Auto-fetch interval">
            <Input
              className={FIELD_INPUT}
              max={60}
              min={0}
              onChange={(event) => setDraft((current) => ({ ...current, auto_fetch_interval_minutes: Number(event.target.value) }))}
              type="number"
              value={draft.auto_fetch_interval_minutes}
            />
          </Field>
          <CheckField
            checked={draft.auto_prune}
            onChange={(auto_prune) => setDraft((current) => ({ ...current, auto_prune }))}
          >
            Prune stale remote branches when fetching
          </CheckField>
          <SectionHeading>Performance</SectionHeading>
          <Field label="Commits per page">
            <Input
              className={FIELD_INPUT}
              max={500}
              min={1}
              onChange={(event) => setDraft((current) => ({ ...current, history_page_size: Number(event.target.value) }))}
              type="number"
              value={draft.history_page_size}
            />
          </Field>
          <Field label="Diff context lines">
            <Input
              className={FIELD_INPUT}
              max={100}
              min={0}
              onChange={(event) => setDraft((current) => ({ ...current, diff_context_lines: Number(event.target.value) }))}
              type="number"
              value={draft.diff_context_lines}
            />
          </Field>
        </section>
        <ThemeEditor
          onColorChange={(field: keyof ThemeColors, value: string) =>
            setDraft((current) => ({ ...current, theme: { ...current.theme, [field]: value } }))}
          onPaletteChange={(graph_palette) =>
            setDraft((current) => ({ ...current, theme: { ...current.theme, graph_palette } }))}
          theme={draft.theme}
        />
        <KeybindEditor
          duplicateActions={duplicateActions}
          keybinds={draft.keybinds}
          onChange={(action, binding) =>
            setDraft((current) => ({ ...current, keybinds: { ...current.keybinds, [action]: binding } }))}
        />
      </div>
    </Modal>
  );
}
