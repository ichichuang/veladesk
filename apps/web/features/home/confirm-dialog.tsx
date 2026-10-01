"use client";

import { useI18n } from "../i18n/use-i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@components/ui/alert-dialog";
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

/**
 * Custom confirmation dialog (018: Radix AlertDialog with Motion
 * lifecycle) — window.confirm is never used. Explicit confirmation
 * semantics: Escape/outside-interaction cancels, the destructive action is
 * the only primary.
 */
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

  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <AlertDialogContent aria-describedby={undefined} data-vd-wheel-scope="local">
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{message}</AlertDialogDescription>
        {error !== null ? (
          <p className="text-xs text-vdu-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2.5">
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={busy}>
            {busy ? t("common.working") : (confirmLabel ?? t("common.save"))}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
