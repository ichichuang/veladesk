"use client";

import { useEffect, useState } from "react";
import { moveAppToFolder } from "@veladesk/domain";
import type { EntityId, Folder, WorkspaceSnapshot, WorkspaceEditFailureReason } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import "./home-shell.css";

interface MoveToFolderDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly appId: EntityId;
  /** The folder the app currently lives in (excluded from the list). */
  readonly currentFolderId: EntityId | null;
  readonly onClose: () => void;
}

/**
 * Folders an app may move into.
 *
 * UI usability filter only — the domain move stays general: a folder is
 * eligible when it is reachable (placed on any page or pinned to the
 * dock), so an app is never moved into an inaccessible unplaced folder.
 */
export function eligibleFoldersForMove(
  workspace: WorkspaceSnapshot,
  currentFolderId: EntityId | null
): Folder[] {
  const placedIds = new Set(
    workspace.pages.flatMap((page) => page.layout.items.map((item) => item.id))
  );
  return workspace.entities.filter(
    (entity): entity is Folder =>
      entity.kind === "folder" &&
      entity.id !== currentFolderId &&
      (placedIds.has(entity.id) || workspace.dock.items.includes(entity.id))
  );
}

/** Move-to-Folder chooser for desktop and folder-overlay apps. */
export function MoveToFolderDialog({
  workspace,
  appId,
  currentFolderId,
  onClose,
}: MoveToFolderDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  const [movingId, setMovingId] = useState<EntityId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folders = eligibleFoldersForMove(workspace, currentFolderId);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleMove(folderId: EntityId) {
    if (movingId !== null) {
      return;
    }
    setMovingId(folderId);
    setError(null);
    try {
      const result = moveAppToFolder(workspace, appId, folderId);
      if (!result.ok) {
        setError(describeMoveFailure(result.reason, t));
        setMovingId(null);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
      if (!staged.ok) {
        setError(t("dialog.moveToFolder.error.failed"));
        setMovingId(null);
        return;
      }
      onClose();
    } catch (moveError: unknown) {
      setError(moveError instanceof Error ? moveError.message : t("dialog.moveToFolder.error.exception"));
      setMovingId(null);
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
      <div className="vela-dialog" role="dialog" aria-modal="true" aria-labelledby="vela-move-title">
        <h2 id="vela-move-title" className="vela-dialog__title">
          {t("dialog.moveToFolder.title")}
        </h2>
        {folders.length === 0 ? (
          <p className="vela-dialog__message">{t("dialog.moveToFolder.empty")}</p>
        ) : (
          <ul className="vela-picker">
            {folders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  className="vela-picker__item"
                  disabled={movingId !== null && movingId !== folder.id}
                  aria-busy={movingId === folder.id}
                  onClick={() => {
                    void handleMove(folder.id);
                  }}
                >
                  <span className="vela-picker__name">{folder.name}</span>
                  <span className="vela-picker__meta">
                    {t("dialog.moveToFolder.appCount", { count: folder.children.length })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error !== null ? (
          <p className="vela-form__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="vela-dialog__actions">
          <button type="button" className="vela-button" onClick={onClose} disabled={movingId !== null}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

function describeMoveFailure(reason: WorkspaceEditFailureReason, t: TranslateFn): string {
  switch (reason) {
    case "app-not-found":
      return t("dialog.moveToFolder.error.appGone");
    case "folder-not-found":
      return t("dialog.moveToFolder.error.folderGone");
    case "already-in-folder":
      return t("dialog.moveToFolder.error.alreadyInside");
    default:
      return t("dialog.moveToFolder.error.failed");
  }
}
