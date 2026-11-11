"use client";

import type { ChangeEvent, ReactNode } from "react";

import { useI18n } from "../i18n/use-i18n";
import { Input } from "@components/ui/input";

/**
 * The shared 名称 / 网址 field pair of the Add and Edit App dialogs (UX-06):
 * ONE definition for label copy, placeholder, order (name above, URL
 * below), autofocus (the name opens both forms) and the inline error style
 * (the existing dialog-level alert look, rendered under the field it
 * belongs to). Validation itself lives in app-url-validation.ts.
 */

/** The inline error line under a field — same look as the dialog alert. */
function FieldError({ id, message }: { readonly id: string; readonly message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <p id={id} className="text-xs text-vdu-danger" role="alert">
      {message}
    </p>
  );
}

export function AppNameField({
  id,
  value,
  autoFocus = false,
  error = null,
  labelExtra = null,
  onChange,
}: {
  /** The dialog-prefixed input id (`vela-add-app-name` / `vela-edit-app-name`). */
  readonly id: string;
  readonly value: string;
  readonly autoFocus?: boolean;
  readonly error?: string | null;
  /** Optional right-aligned affordance on the label row (e.g. the smart-add
   * "use detected name" button) — the label copy itself stays shared. */
  readonly labelExtra?: ReactNode;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-vdu-fg" htmlFor={id}>
          {t("dialog.nameLabel")}
        </label>
        {labelExtra}
      </div>
      <Input
        id={id}
        type="text"
        value={value}
        maxLength={80}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={error !== null ? `${id}-error` : undefined}
        onChange={onChange}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function AppUrlField({
  id,
  value,
  error = null,
  onChange,
}: {
  /** The dialog-prefixed input id (`vela-add-app-url` / `vela-edit-app-url`). */
  readonly id: string;
  readonly value: string;
  readonly error?: string | null;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-vdu-fg" htmlFor={id}>
        {t("dialog.urlLabel")}
      </label>
      <Input
        id={id}
        type="text"
        inputMode="url"
        value={value}
        maxLength={2048}
        autoComplete="off"
        spellCheck={false}
        placeholder={t("dialog.urlPlaceholder")}
        aria-describedby={error !== null ? `${id}-error` : undefined}
        onChange={onChange}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
