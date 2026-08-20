import { useEffect, useRef, useState } from "react";

import { FIELD_INPUT } from "../lib";
import { Button, Input, Modal, ModalSpacer } from "./ui";

export function PromptDialog({
  title,
  description,
  label,
  initialValue = "",
  placeholder,
  secondaryLabel,
  secondaryPlaceholder,
  secondaryRequired = false,
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
  // Optional second field, used by prompts that need a message alongside a name.
  secondaryLabel?: string;
  secondaryPlaceholder?: string;
  secondaryRequired?: boolean;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (value: string, secondaryValue?: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [secondaryValue, setSecondaryValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const canConfirm = Boolean(value.trim()) && (!secondaryRequired || Boolean(secondaryValue.trim()));
  const confirm = () => {
    if (!canConfirm) return;
    onConfirm(value.trim(), secondaryLabel ? secondaryValue.trim() : undefined);
  };

  return (
    <Modal
      description={description}
      footer={
        <>
          <ModalSpacer />
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={!canConfirm} onClick={confirm} tone={danger ? "danger" : "accent"}>
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
            if (event.key === "Enter") confirm();
          }}
          placeholder={placeholder}
          ref={inputRef}
          value={value}
        />
      </label>
      {secondaryLabel ? (
        <label className="mt-2.5 flex flex-col gap-1.75 text-[11px] font-[650] text-muted">
          <span>{secondaryLabel}</span>
          <Input
            className={FIELD_INPUT}
            onChange={(event) => setSecondaryValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") confirm();
            }}
            placeholder={secondaryPlaceholder}
            value={secondaryValue}
          />
        </label>
      ) : null}
    </Modal>
  );
}
