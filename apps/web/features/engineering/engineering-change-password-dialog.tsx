"use client";

import { useState, type FormEvent } from "react";

import { VdFormDialog } from "@components/vd/form-dialog";
import { Input } from "@components/ui/input";
import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";

/**
 * The 修改密码 dialog inside Engineering-mode Settings (t181): requires
 * the CURRENT password (re-verified server-side), a new 6-digit password
 * and its confirmation. Runs on the shared VdFormDialog skeleton (Radix
 * semantics + the designed form motion), so Enter submits and Esc cancels.
 */
export function EngineeringChangePasswordDialog({
  open,
  onExitComplete,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  readonly onExitComplete?: (() => void) | undefined;
  readonly onClose: () => void;
  /** Called after a successful change (shows the confirmation toast). */
  readonly onSaved: () => void;
}) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("engineering.password.mismatch"));
      return;
    }
    if (!/^[0-9]{6}$/.test(newPassword)) {
      setError(t("engineering.password.invalid"));
      return;
    }
    setBusy(true);
    setError(null);
    let outcome: "ok" | "wrong" | "invalid" | "error";
    try {
      const response = await fetch("/api/v1/engineering/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (response.status === 200) {
        outcome = "ok";
      } else if (response.status === 401) {
        outcome = "wrong";
      } else if (response.status === 422) {
        outcome = "invalid";
      } else {
        outcome = "error";
      }
    } catch {
      outcome = "error";
    }
    setBusy(false);
    if (outcome === "ok") {
      reset();
      onSaved();
      return;
    }
    setError(describePasswordChangeFailure(outcome, t));
  }

  function handleCancel() {
    if (busy) {
      return;
    }
    reset();
    onClose();
  }

  const digitInput = (value: string, onChange: (next: string) => void) => ({
    inputMode: "numeric" as const,
    autoComplete: "off",
    pattern: "[0-9]*",
    maxLength: 6,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value.replace(/[^0-9]/g, "").slice(0, 6));
    },
  });

  return (
    <VdFormDialog
      open={open}
      onExitComplete={onExitComplete}
      title={t("engineering.password.title")}
      description={t("engineering.password.description")}
      submitLabel={t("engineering.password.submit")}
      busyLabel={t("engineering.password.busy")}
      busy={busy}
      error={error}
      cancelLabel={t("common.close")}
      onCancel={handleCancel}
      onSubmit={handleSubmit}
    >
      <label className="vela-form__label" htmlFor="veladesk-engineering-current">
        {t("engineering.password.current")}
      </label>
      <Input
        id="veladesk-engineering-current"
        type="password"
        disabled={busy}
        {...digitInput(currentPassword, setCurrentPassword)}
      />
      <label className="vela-form__label" htmlFor="veladesk-engineering-next">
        {t("engineering.password.next")}
      </label>
      <Input
        id="veladesk-engineering-next"
        type="password"
        disabled={busy}
        {...digitInput(newPassword, setNewPassword)}
      />
      <label className="vela-form__label" htmlFor="veladesk-engineering-confirm">
        {t("engineering.password.confirm")}
      </label>
      <Input
        id="veladesk-engineering-confirm"
        type="password"
        disabled={busy}
        {...digitInput(confirmPassword, setConfirmPassword)}
      />
    </VdFormDialog>
  );
}

function describePasswordChangeFailure(
  outcome: "wrong" | "invalid" | "error",
  t: TranslateFn,
): string {
  switch (outcome) {
    case "wrong":
      return t("engineering.password.wrong");
    case "invalid":
      return t("engineering.password.invalid");
    case "error":
      return t("engineering.dialog.network");
  }
}
