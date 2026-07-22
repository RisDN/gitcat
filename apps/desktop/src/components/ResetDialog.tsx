import { useState } from "react";

import type { ResetMode } from "../lib/types";
import { Button, Modal } from "./Primitives";

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
          <span className="gc-modal__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => onConfirm(mode)} tone={hard ? "danger" : "accent"}>Reset branch</Button>
        </>
      }
      onClose={onClose}
      title="Reset branch"
      width="small"
    >
      <div className="gc-reset-options">
        {(Object.keys(RESET_COPY) as ResetMode[]).map((value) => (
          <label className={RESET_COPY[value].danger ? "danger" : ""} key={value}>
            <input checked={mode === value} name="reset-mode" onChange={() => setMode(value)} type="radio" />
            <span><strong>{RESET_COPY[value].title}</strong><small>{RESET_COPY[value].detail}</small></span>
          </label>
        ))}
      </div>
      {hard ? <p className="gc-danger-note">Hard reset permanently discards uncommitted changes. This cannot be undone.</p> : null}
    </Modal>
  );
}
