"use client";

import { useEffect } from "react";
import { useI18n } from "../i18n/use-i18n";
import "./home-shell.css";

interface ConfirmDialogProps {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Custom confirmation dialog — window.confirm is never used. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="vela-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="vela-dialog" role="dialog" aria-modal="true" aria-labelledby="vela-confirm-title">
        <h2 id="vela-confirm-title" className="vela-dialog__title">
          {title}
        </h2>
        <p className="vela-dialog__message">{message}</p>
        {error !== null ? (
          <p className="vela-form__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="vela-dialog__actions">
          <button type="button" className="vela-button" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="vela-button vela-button--danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t("common.working") : (confirmLabel ?? t("common.save"))}
          </button>
        </div>
      </div>
    </div>
  );
}
