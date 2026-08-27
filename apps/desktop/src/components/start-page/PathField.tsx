import { FolderOpen } from "lucide-react";
import { useId } from "react";
import type { ReactNode } from "react";

import { cx, FIELD_INPUT, gitcatApi } from "../../lib";
import { Button, Input, TextArea } from "../ui";

export function Field({
  hint,
  label,
  render,
}: {
  hint?: string;
  label: string;
  render: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.75 text-[11px] font-[650] text-muted">
      <label htmlFor={id}>{label}</label>
      {render(id)}
      {hint ? <span className="text-[10px] font-normal text-muted/80">{hint}</span> : null}
    </div>
  );
}

export function TextInputField({
  hint,
  label,
  onChange,
  placeholder,
  value,
}: {
  hint?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <Field
      hint={hint}
      label={label}
      render={(id) => (
        <Input
          className={FIELD_INPUT}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          value={value}
        />
      )}
    />
  );
}

export function TextAreaField({
  hint,
  label,
  onChange,
  placeholder,
  value,
}: {
  hint?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <Field
      hint={hint}
      label={label}
      render={(id) => (
        <TextArea
          className={cx(FIELD_INPUT, "h-20 resize-y py-1.75 font-normal leading-[1.5]")}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          value={value}
        />
      )}
    />
  );
}

// An option that is off until asked for. The control it reveals is rendered by
// the caller, so the box and what it turns on stay next to each other there.
export function CheckboxField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.75 text-[11px] font-[650] text-muted">
      <input
        checked={checked}
        className="accent-accent"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

export function PathField({
  hint,
  label,
  onBrowse,
  onChange,
  placeholder,
  value,
}: {
  hint?: string;
  label: string;
  onBrowse: () => void;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <Field
      hint={hint}
      label={label}
      render={(id) => (
        <span className="flex gap-1.75">
          <Input
            className={FIELD_INPUT}
            id={id}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            value={value}
          />
          {gitcatApi.runtime === "tauri" ? (
            <Button
              aria-label={`Browse for ${label.toLowerCase()}`}
              icon={<FolderOpen size={15} />}
              onClick={onBrowse}
            />
          ) : null}
        </span>
      )}
    />
  );
}
