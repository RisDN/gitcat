import { useState } from "react";

import { cx } from "../lib";
import type { ResetMode } from "../lib/types";
import { Button, Modal, ModalSpacer } from "./ui";

const RESET_COPY: Record<ResetMode, { title: string; detail: string; danger: boolean }> = {
  soft: { title: "Soft", detail: "Move branch only. Keep index and working tree.", danger: false },
  mixed: { title: "Mixed", detail: "Move branch and unstage changes. Keep working tree.", danger: false },
  hard: { title: "Hard", detail: "Move branch and discard index and working tree changes.", danger: true },
};

export function ResetDialog({
  shortOid,
  onConfirm,
  onClose,
}: {
  shortOid: string;
  onConfirm: (mode: ResetMode) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ResetMode>("mixed");
  const hard = mode === "hard";
  return (
    <Modal
      description={`Move current branch to ${shortOid}.`}
      footer={
        <>
          <ModalSpacer />
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => onConfirm(mode)} tone={hard ? "danger" : "accent"}>Reset branch</Button>
        </>
      }
      onClose={onClose}
      title="Reset branch"
      width="small"
    >
      <div className="flex flex-col gap-1.5">
        {(Object.keys(RESET_COPY) as ResetMode[]).map((value) => (
          <label
            className={cx(
              "flex cursor-pointer items-start gap-2.25 rounded-[5px] border border-border p-2.5",
              RESET_COPY[value].danger
                ? "has-[input:checked]:border-danger has-[input:checked]:bg-danger/8"
                : "has-[input:checked]:border-accent has-[input:checked]:bg-accent/7",
            )}
            key={value}
          >
            <input
              checked={mode === value}
              className="mt-0.5 accent-accent"
              name="reset-mode"
              onChange={() => setMode(value)}
              type="radio"
            />
            <span className="flex flex-col gap-0.75">
              <strong>{RESET_COPY[value].title}</strong>
              <small className="leading-[1.35] text-muted">{RESET_COPY[value].detail}</small>
            </span>
          </label>
        ))}
      </div>
      {hard ? (
        <p className="mt-3 border-l-[3px] border-danger bg-danger/8 p-2.25 text-[11px] leading-[1.45] text-[color-mix(in_srgb,var(--gc-danger)_72%,var(--gc-text))]">
          Hard reset permanently discards uncommitted changes. This cannot be undone.
        </p>
      ) : null}
    </Modal>
  );
}
