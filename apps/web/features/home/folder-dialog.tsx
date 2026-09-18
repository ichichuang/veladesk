"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import "./home-shell.css";

interface FolderDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly pageId: EntityId;
  /** Rename mode when a folder is given; create mode otherwise. */
  readonly folder?: Folder | undefined;
  readonly onClose: () => void;
}

/**
 * Folder name dialog — create (adds an empty folder to the page) and
 * rename share one surface. The stored name is the user's verbatim string.
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
    <div
      className="vela-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="vela-dialog" role="dialog" aria-modal="true" aria-labelledby="vela-folder-title">
        <h2 id="vela-folder-title" className="vela-dialog__title">
          {renaming ? t("dialog.folder.renameTitle") : t("dialog.folder.newTitle")}
        </h2>
        <form className="vela-form" onSubmit={handleSubmit}>
          <label className="vela-form__label" htmlFor="vela-folder-name">
            {t("dialog.folder.nameLabel")}
          </label>
          <input
            id="vela-folder-name"
            className="vela-input"
            type="text"
            value={name}
            maxLength={80}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setNameInput(event.target.value)}
            aria-describedby={error !== null ? "vela-folder-error" : undefined}
          />
          {error !== null ? (
            <p id="vela-folder-error" className="vela-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="vela-dialog__actions">
            <button type="button" className="vela-button" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="vela-button vela-button--primary" disabled={busy}>
              {busy ? t("dialog.folder.saving") : renaming ? t("dialog.folder.rename") : t("dialog.folder.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
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
