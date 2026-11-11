"use client";

import type { RefObject } from "react";
import { useCallback, useState } from "react";

import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";
import {
  captureDeletedAppEntry,
  deleteApp,
  deleteEmptyPage,
  dissolveFolderToPage,
} from "@veladesk/domain";
import type {
  DeletedAppRestoreEntry,
  DesktopPageId,
  EntityId,
  Folder,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";

import { stageWorkspaceAndTrySync } from "../workspace-commit";
import { resolveSectionAfterDelete } from "../section-navigation-model";
import type { TranslateFn } from "../../i18n/use-i18n";
import type { HomeDialog } from "./shell-context";

export interface UseShellDialogsInput {
  readonly runtime: WorkspaceClientRuntime;
  readonly t: TranslateFn;
  /** Section ids in workspace order. */
  readonly pageIds: readonly DesktopPageId[];
  /** The render's authoritative snapshot (the dialogs edit persisted data). */
  readonly snapshot: WorkspaceSnapshot;
  readonly effectiveActivePageId: DesktopPageId | null;
  /** Latest-value mirror of the workspace record (folder lookup on open). */
  readonly workspaceRef: RefObject<LocalWorkspaceRecord>;
  /** Structural-reveal channel (create/reorder/delete-active). */
  readonly pendingRevealRef: RefObject<DesktopPageId | null>;
  /**
   * Delete-undo channel (UX-09): invoked with the captured restore entry
   * after a successful app delete — the shell shows the toast + undo.
   */
  readonly onAppDeleted?: ((entry: DeletedAppRestoreEntry) => void) | undefined;
}

/**
 * The shell's dialog + folder-overlay session state (P1-ENG-1), extracted
 * verbatim from the former desktop-shell.tsx: which dialog is open (one at
 * a time), its inline error surface, the folder overlay and its
 * exit-animation mirror, and the delete/dissolve submission handlers.
 */
export function useShellDialogs(input: UseShellDialogsInput) {
  const { runtime, t, pageIds, snapshot, effectiveActivePageId, workspaceRef, pendingRevealRef, onAppDeleted } =
    input;

  const [dialog, setDialog] = useState<HomeDialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [overlayFolderId, setOverlayFolderId] = useState<EntityId | null>(null);
  /**
   * The last OPENED folder entity (022): during the overlay's exit the id
   * is already null, so this mirror keeps the fading surface rendering
   * real content. Set together with the id (one batched open commit);
   * cleared only when the surface is fully closed.
   */
  const [lastOverlayFolder, setLastOverlayFolder] = useState<Folder | null>(null);

  /**
   * Presentation-only error for folder-overlay actions (dissolve). Never
   * written into the workspace snapshot.
   */
  const [folderActionError, setFolderActionError] = useState<string | null>(null);

  /**
   * Opens a folder overlay. Stable identity: warm section layers receive
   * it as a prop and must not re-render when the shell does (020-A2 §18).
   */
  const openFolderOverlay = useCallback((folderId: EntityId) => {
    setFolderActionError(null);
    setOverlayFolderId(folderId);
    // 022: remember the opened entity so the exit animation keeps real
    // content after the close intent clears the id (batched: one commit).
    const folder = workspaceRef.current.snapshot.entities.find(
      (entity): entity is Folder => entity.kind === "folder" && entity.id === folderId
    );
    setLastOverlayFolder(folder ?? null);
  }, [workspaceRef]);

  function closeFolderOverlay() {
    setFolderActionError(null);
    setOverlayFolderId(null);
  }

  function openDialog(next: HomeDialog) {
    setDialogError(null);
    setDialog(next);
  }

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
  }

  async function handleDeleteSection(pageId: DesktopPageId) {
    // Decide the surviving neighbor BEFORE the deletion so the reveal can
    // never land on an index that no longer exists.
    const neighbor = resolveSectionAfterDelete(pageIds, pageId);
    const result = deleteEmptyPage(snapshot, pageId);
    if (!result.ok) {
      setDialogError(
        result.reason === "page-not-found"
          ? t("dialog.deleteSection.error.sectionGone")
          : t("dialog.deleteSection.error.failed")
      );
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setDialogError(t("dialog.deleteSection.error.failed"));
      return;
    }
    closeDialog();
    if (neighbor !== null) {
      pendingRevealRef.current = neighbor;
    }
  }

  async function handleDeleteApp(appId: EntityId) {
    // Capture the undo entry BEFORE the immutable delete (UX-09): the
    // entry carries the entity, its exact placement, folder membership
    // and dock pin so an undo restores the tile in place.
    const entry = captureDeletedAppEntry(snapshot, appId);
    const result = deleteApp(snapshot, appId);
    if (!result.ok) {
      setDialogError(t("dialog.deleteApp.error.appGone"));
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setDialogError(t("dialog.deleteApp.error.failed"));
      return;
    }
    closeDialog();
    if (entry !== null) {
      onAppDeleted?.(entry);
    }
  }

  async function handleDissolveFolder(folderId: EntityId) {
    const pageId = effectiveActivePageId;
    if (pageId === null) {
      setDialogError(t("dialog.deleteFolder.error.noActivePage"));
      return;
    }
    const result = dissolveFolderToPage(snapshot, folderId, pageId);
    if (!result.ok) {
      setDialogError(
        result.reason === "folder-not-found"
          ? t("dialog.deleteFolder.error.folderGone")
          : t("dialog.deleteFolder.error.failed")
      );
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setDialogError(t("dialog.deleteFolder.error.failed"));
      return;
    }
    if (overlayFolderId === folderId) {
      closeFolderOverlay();
    }
    closeDialog();
  }

  return {
    dialog,
    setDialog,
    dialogError,
    overlayFolderId,
    lastOverlayFolder,
    folderActionError,
    openDialog,
    closeDialog,
    openFolderOverlay,
    closeFolderOverlay,
    handleDeleteSection,
    handleDeleteApp,
    handleDissolveFolder,
  };
}

/** The shell's dialog + folder-overlay session surface. */
export type ShellDialogs = ReturnType<typeof useShellDialogs>;
