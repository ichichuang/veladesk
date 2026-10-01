"use client";

import { useState, type FormEvent } from "react";
import type { EntityId, Folder, WorkspaceSnapshot } from "@veladesk/domain";

import {
  addFolderToPage,
  renameFolder,
} from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";
import { createBrowserId } from "./browser-id";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import { VdFormDialog } from "@components/vd/form-dialog";
import { Input } from "@components/ui/input";
import "./home-shell.css";

interface FolderDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly pageId: EntityId;
  /** Rename mode when a folder is given; create mode otherwise. */
  readonly folder?: Folder | undefined;
  readonly onClose: () => void;
}

/**
 * Folder name dialog (018 designed shell) — create (adds an empty folder
 * to the page) and rename share one surface. The stored name is the
 * user's verbatim string.
 */
export function FolderDialog({ workspace, pageId, folder, onClose }: FolderDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  // null = untouched: shows the locale default until the stored locale
  // restores; the user's own typing always wins.
  const [nameInput, setNameInput] = useState<string | null>(null);
  const name = nameInput ?? (folder !== undefined ? folder.name : t("dialog.folder.defaultName"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renaming = folder !== undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (name.trim().length === 0) {
      setError(t("dialog.folder.error.enterName"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = renaming
        ? renameFolder(workspace, folder.id, name)
        : addFolderToPage(workspace, pageId, {
            kind: "folder",
            id: createBrowserId("folder"),
            name,
            children: [],
          });
      if (!result.ok) {
        setError(describeFolderFailure(result.reason, t));
        setBusy(false);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
      if (!staged.ok) {
        setError(t("dialog.folder.error.saveFailed"));
        setBusy(false);
        return;
      }
      onClose();
    } catch (dialogError: unknown) {
      setError(
        dialogError instanceof Error ? dialogError.message : t("dialog.folder.error.exception")
      );
      setBusy(false);
    }
  }

  return (
    <VdFormDialog
      title={renaming ? t("dialog.folder.renameTitle") : t("dialog.folder.newTitle")}
      submitLabel={
        busy ? t("dialog.folder.saving") : renaming ? t("dialog.folder.rename") : t("dialog.folder.create")
      }
      busy={busy}
      error={error}
      cancelLabel={t("common.cancel")}
      onCancel={onClose}
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-vdu-fg" htmlFor="vela-folder-name">
          {t("dialog.folder.nameLabel")}
        </label>
        <Input
          id="vela-folder-name"
          type="text"
          value={name}
          maxLength={80}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setNameInput(event.target.value)}
          aria-describedby={error !== null ? "vela-folder-error" : undefined}
        />
      </div>
    </VdFormDialog>
  );
}

function describeFolderFailure(reason: WorkspaceEditFailureReason, t: TranslateFn): string {
  switch (reason) {
    case "page-not-found":
      return t("dialog.folder.error.pageGone");
    case "folder-not-found":
      return t("dialog.folder.error.folderGone");
    case "duplicate-entity-id":
      return t("dialog.folder.error.duplicate");
    case "folder-must-be-empty":
      return t("dialog.folder.error.mustBeEmpty");
    case "invalid-name":
      return t("dialog.folder.error.enterName");
    case "no-space":
      return t("dialog.folder.error.noSpace");
    default:
      return t("dialog.folder.error.saveFailed");
  }
}
