"use client";

import type { FormEvent, ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@components/ui/dialog";
import { Button } from "@components/ui/button";

/**
 * VdFormDialog (task 018): the shared skeleton for the small configuration
 * forms (add/edit app, folder and section naming) — compact header, one
 * body column, fixed footer with Cancel + one primary submit. Radix owns
 * Escape/focus/backdrop semantics; the native form keeps Enter-to-submit.
 * Business validation stays in the caller: `onSubmit` receives the submit
 * event only when not busy and not disabled.
 */
export function VdFormDialog({
  title,
  description,
  submitLabel,
  busyLabel,
  busy = false,
  submitDisabled = false,
  error = null,
  cancelLabel,
  onCancel,
  onSubmit,
  children,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  readonly submitLabel: string;
  readonly busyLabel?: string;
  readonly busy?: boolean;
  readonly submitDisabled?: boolean;
  readonly error?: string | null;
  readonly cancelLabel: string;
  readonly onCancel: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={description !== undefined ? undefined : undefined}
        data-vd-wheel-scope="local"
        className={className ?? "w-[440px] max-w-[calc(100vw-32px)]"}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            if (busy || submitDisabled) {
              event.preventDefault();
              return;
            }
            onSubmit(event);
          }}
        >
          <header className="shrink-0 px-5 pb-3 pt-5">
            <DialogTitle className="text-base">{title}</DialogTitle>
            {description !== undefined ? (
              <DialogDescription className="mt-1">{description}</DialogDescription>
            ) : null}
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-2">
            {children}
            {error !== null ? (
              <p className="text-xs text-vdu-danger" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <footer className="flex shrink-0 items-center justify-end gap-2.5 px-5 pb-5 pt-3">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant="primary" disabled={busy || submitDisabled}>
              {busy && busyLabel !== undefined ? busyLabel : submitLabel}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
