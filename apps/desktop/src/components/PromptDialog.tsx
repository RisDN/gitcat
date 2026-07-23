import { useEffect, useRef, useState } from "react";

import { FIELD_INPUT } from "../lib";
import { Button, Input, Modal, ModalSpacer } from "./ui";

export function PromptDialog({
  title,
  description,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "Create",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Modal
      description={description}
      footer={
        <>
          <ModalSpacer />
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={!value.trim()} onClick={() => onConfirm(value.trim())} tone={danger ? "danger" : "accent"}>
            {confirmLabel}
          </Button>
        </>
      }
      onClose={onClose}
      title={title}
      width="small"
    >
      <label className="flex flex-col gap-1.75 text-[11px] font-[650] text-muted">
        <span>{label}</span>
        <Input
          className={FIELD_INPUT}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim()) onConfirm(value.trim());
          }}
          placeholder={placeholder}
          ref={inputRef}
          value={value}
        />
      </label>
    </Modal>
  );
}
