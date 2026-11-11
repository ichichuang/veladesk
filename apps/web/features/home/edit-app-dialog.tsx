"use client";

import { useState, type FormEvent } from "react";
import type { AppOpenMode, AppShortcut, WorkspaceSnapshot } from "@veladesk/domain";

import { replaceApp } from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";
import { generatedIconFollowsName } from "./app-icon";
import { generatedIconText } from "./generated-icon";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import { validateAppUrlInput } from "./app-url-validation";
import { AppNameField, AppUrlField } from "./app-form-fields";
import { VdFormDialog } from "@components/vd/form-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import "./home-shell.css";

const OPEN_MODES: readonly AppOpenMode[] = ["new-tab", "same-tab", "new-window", "popup"];

interface EditAppDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly appId: AppShortcut["id"];
  readonly onClose: () => void;
}

/**
 * Edit App dialog (018 designed shell): name, URL and open mode.
 *
 * URLs go through the shared UX-04 gate (web-looking input auto-completes
 * to https://, free text is refused inline). Identity, description,
 * category, tags and container/dock placement are preserved; only a
 * generated icon is recalculated from the new name — every other icon kind
 * is kept as-is.
 */
export function EditAppDialog({ workspace, appId, onClose }: EditAppDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  const existing = workspace.entities.find(
    (entity): entity is AppShortcut => entity.kind === "app" && entity.id === appId
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [openMode, setOpenMode] = useState<AppOpenMode>(existing?.openMode ?? "new-tab");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  if (existing === undefined) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || existing === undefined) {
      return;
    }
    setNameError(null);
    setUrlError(null);
    if (name.trim().length === 0) {
      setNameError(t("dialog.addApp.error.enterName"));
      return;
    }
    // UX-04: the SAME gate as the Add dialog — web-looking input is
    // auto-completed to https://, everything else is refused inline.
    const validated = validateAppUrlInput(url);
    if (!validated.ok) {
      setUrlError(
        validated.reason === "empty"
          ? t("dialog.addApp.error.enterUrl")
          : t("dialog.addApp.error.invalidUrl"),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextApp: AppShortcut = {
        ...existing,
        name,
        url: validated.url,
        openMode,
        // Only AUTO generated icons follow renames — custom text and every
        // other icon kind are user-owned and stay untouched.
        icon: generatedIconFollowsName(existing)
          ? { kind: "generated", text: generatedIconText(name), source: "auto" }
          : existing.icon,
      };
      const result = replaceApp(workspace, nextApp);
      if (!result.ok) {
        setError(describeEditFailure(result.reason, t));
        setBusy(false);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
      if (!staged.ok) {
        setError(t("dialog.editApp.error.saveFailed"));
        setBusy(false);
        return;
      }
      onClose();
    } catch (dialogError: unknown) {
      setError(
        dialogError instanceof Error ? dialogError.message : t("dialog.editApp.error.exception")
      );
      setBusy(false);
    }
  }

  function describeOpenMode(mode: AppOpenMode): string {
    switch (mode) {
      case "new-tab":
        return t("dialog.editApp.mode.newTab");
      case "same-tab":
        return t("dialog.editApp.mode.sameTab");
      case "new-window":
        return t("dialog.editApp.mode.newWindow");
      case "popup":
        return t("dialog.editApp.mode.popup");
    }
  }

  return (
    <VdFormDialog
      title={t("dialog.editApp.title")}
      submitLabel={busy ? t("dialog.editApp.saving") : t("dialog.editApp.saveChanges")}
      busy={busy}
      error={error}
      cancelLabel={t("common.cancel")}
      onCancel={onClose}
      onSubmit={handleSubmit}
    >
      {/* UX-06: the shared field pair — identical order, labels and
          placeholder to the Add dialog (app-form-fields.tsx). */}
      <AppNameField
        id="vela-edit-app-name"
        value={name}
        autoFocus
        error={nameError}
        onChange={(event) => setName(event.target.value)}
      />
      <AppUrlField
        id="vela-edit-app-url"
        value={url}
        error={urlError}
        onChange={(event) => setUrl(event.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-vdu-fg" htmlFor="vela-edit-app-mode">
          {t("dialog.editApp.openMode")}
        </label>
        <Select value={openMode} onValueChange={(value) => setOpenMode(value as AppOpenMode)}>
          <SelectTrigger id="vela-edit-app-mode" className="max-w-[280px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPEN_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {describeOpenMode(mode)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </VdFormDialog>
  );
}

function describeEditFailure(reason: WorkspaceEditFailureReason, t: TranslateFn): string {
  switch (reason) {
    case "app-not-found":
      return t("dialog.editApp.error.appGone");
    case "invalid-name":
      return t("dialog.addApp.error.enterName");
    case "invalid-url":
      return t("dialog.addApp.error.enterUrl");
    default:
      return t("dialog.editApp.error.saveFailed");
  }
}
