"use client";

import type { RefObject } from "react";

import type {
  AppShortcut,
  DesktopPage,
  DesktopPageId,
  EntityId,
  Folder,
  WorkspaceAppearancePreferences,
  WorkspaceSnapshot,
} from "@veladesk/domain";

import { AddAppDialog } from "../add-app-dialog";
import { AppAppearanceInspector } from "../app-appearance-inspector";
import type { AppAppearanceSession } from "../app-appearance-session";
import { ConfirmDialog } from "../confirm-dialog";
import { ContextMenu } from "../context-menu";
import type { ContextMenuState } from "../context-menu";
import { EditAppDialog } from "../edit-app-dialog";
import { FolderDialog } from "../folder-dialog";
import { FolderOverlay } from "../folder-overlay";
import { MoveToSectionDialog } from "../move-to-section-dialog";
import { SectionDialog } from "../section-dialog";
import { Launcher } from "../launcher";
import type { LauncherEntry } from "../launcher-types";
import { SettingsCenter } from "../settings-center";
import type { SettingsSaveResult } from "../settings-center";
import type { WorkspaceSettingsDraft } from "../settings-draft";
import type { PreparedWallpaperImage } from "../wallpaper-prep";
import { findDesktopPage } from "@veladesk/domain";
import { useI18n } from "../../i18n/use-i18n";
import { useWorkspaceManager } from "../workspace-manager";
import type { ContextMenuTarget } from "./shell-context";
import type { ShellDialogs } from "./use-shell-dialogs";
import type { TranslateFn } from "../../i18n/use-i18n";

function findFolderEntity(workspace: WorkspaceSnapshot, folderId: EntityId): Folder | undefined {
  const entity = workspace.entities.find((candidate) => candidate.id === folderId);
  return entity !== undefined && entity.kind === "folder" ? entity : undefined;
}

function DeleteAppConfirm({
  workspace,
  appId,
  error,
  onConfirm,
  onCancel,
}: {
  workspace: WorkspaceSnapshot;
  appId: EntityId;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const app = workspace.entities.find(
    (entity): entity is AppShortcut => entity.kind === "app" && entity.id === appId
  );
  return (
    <ConfirmDialog
      title={t("dialog.deleteApp.title", { name: app?.name ?? t("launcher.kind.app") })}
      message={t("dialog.deleteApp.message")}
      confirmLabel={t("dialog.deleteApp.confirm")}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export interface ShellSurfacesProps {
  // --- Dialog + folder-overlay session (the shell's dialogs hook) ------------
  readonly dialogs: ShellDialogs;
  // --- Workspace inputs --------------------------------------------------------
  readonly renderedSnapshot: WorkspaceSnapshot;
  readonly snapshot: WorkspaceSnapshot;
  readonly pages: readonly DesktopPage[];
  readonly activePage: DesktopPage | undefined;
  readonly effectiveActivePageId: DesktopPageId | null;
  readonly pendingRevealRef: RefObject<DesktopPageId | null>;
  readonly appearanceSession: AppAppearanceSession | null;
  readonly setAppearanceSession: (
    next: AppAppearanceSession | null | ((current: AppAppearanceSession | null) => AppAppearanceSession | null)
  ) => void;
  readonly containerPageId: (workspace: WorkspaceSnapshot, entityId: EntityId) => DesktopPageId | null;
  // --- Context menu -----------------------------------------------------------
  readonly contextMenu: ContextMenuState | null;
  readonly setContextMenu: (next: ContextMenuState | null) => void;
  // --- Launcher ------------------------------------------------------------------
  readonly launcherOpen: boolean;
  readonly launcherEntries: readonly LauncherEntry[];
  readonly launcherAppsById: ReadonlyMap<EntityId, AppShortcut>;
  readonly activateLauncherEntry: (entry: LauncherEntry) => void;
  readonly setLauncherOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  // --- Settings ------------------------------------------------------------------
  readonly settingsOpen: boolean;
  readonly handleSettingsSave: (
    draft: WorkspaceSettingsDraft,
    images?: readonly PreparedWallpaperImage[]
  ) => Promise<SettingsSaveResult>;
  readonly closeSettings: () => void;
  readonly settingsBackgroundSection: DesktopPageId | null;
  readonly setAppearancePreview: (next: WorkspaceAppearancePreferences | null) => void;
  /** Live Settings draft stream (t137): the desktop previews it. */
  readonly setSettingsDraftPreview: (next: WorkspaceSettingsDraft | null) => void;
  readonly openContextMenu: (target: ContextMenuTarget) => void;
  readonly t: TranslateFn;
}

/**
 * The shell's overlay surfaces (P1-ENG-1): the folder overlay, the dialog
 * group, the context menu, the Launcher and the Settings window — the
 * contiguous block above the Dock in the former desktop-shell render,
 * extracted VERBATIM. Open/close state stays in the shell; this component
 * only mounts what is open.
 */
export function ShellSurfaces(props: ShellSurfacesProps) {
  const {
    dialogs,
    renderedSnapshot,
    snapshot,
    pages,
    activePage,
    effectiveActivePageId,
    pendingRevealRef,
    appearanceSession,
    setAppearanceSession,
    containerPageId,
    contextMenu,
    setContextMenu,
    launcherOpen,
    launcherEntries,
    launcherAppsById,
    activateLauncherEntry,
    setLauncherOpen,
    settingsOpen,
    handleSettingsSave,
    closeSettings,
    settingsBackgroundSection,
    setAppearancePreview,
    setSettingsDraftPreview,
    openContextMenu,
    t,
  } = props;
  const {
    dialog,
    dialogError,
    overlayFolderId,
    lastOverlayFolder,
    folderActionError,
    closeDialog,
    closeFolderOverlay,
    handleDeleteSection,
    handleDeleteApp,
    handleDissolveFolder,
  } = dialogs;
  const workspaceManager = useWorkspaceManager();

  const overlayFolder =
    overlayFolderId !== null
      ? snapshot.entities.find(
          (entity): entity is Folder => entity.kind === "folder" && entity.id === overlayFolderId
        )
      : undefined;
  // During the overlay's EXIT the folder may already be closed: the last
  // OPENED folder (state, set by the open handler — never written during
  // render) keeps the fading surface rendering real content.
  const renderedOverlayFolder = overlayFolder ?? lastOverlayFolder;

  return (
    <>
      {renderedOverlayFolder !== null ? (
        <FolderOverlay
          open={overlayFolder !== undefined}
          folder={renderedOverlayFolder}
          workspace={renderedSnapshot}
          error={folderActionError ?? undefined}
          onClose={closeFolderOverlay}
          onChildContextMenu={(entityId, x, y) =>
            openContextMenu({ kind: "entity", entityId, source: "folder", x, y })
          }
        />
      ) : null}

      {dialog !== null && dialog.kind === "add-app" ? (
        <AddAppDialog
          workspace={snapshot}
          destination={{ kind: "page", pageId: dialog.pageId }}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "edit-app" ? (
        <EditAppDialog workspace={snapshot} appId={dialog.entityId} onClose={closeDialog} />
      ) : null}
      {appearanceSession !== null ? (
        <AppAppearanceInspector
          open={
            dialog !== null &&
            dialog.kind === "edit-visual" &&
            dialog.entityId === appearanceSession.appId
          }
          workspace={snapshot}
          appId={appearanceSession.appId}
          draft={appearanceSession.draft}
          onDraftChange={(draft) =>
            setAppearanceSession((current) => (current === null ? current : { ...current, draft }))
          }
          onClose={() => {
            // t138 autosave: closing only closes — the inspector has already
            // flushed the last edit, and the session STAYS as the zero-bounce
            // override until the staged snapshot carries the same projected
            // app (the desktop must never flash the pre-save appearance).
            closeDialog();
          }}
        />
      ) : null}
      {dialog !== null && dialog.kind === "delete-app" ? (
        <DeleteAppConfirm
          workspace={snapshot}
          appId={dialog.entityId}
          error={dialogError}
          onConfirm={() => void handleDeleteApp(dialog.entityId)}
          onCancel={closeDialog}
        />
      ) : null}
      {dialog !== null && (dialog.kind === "new-section" || dialog.kind === "rename-section") ? (
        <SectionDialog
          workspace={snapshot}
          gridSourcePage={activePage ?? pages[0]!}
          section={
            dialog.kind === "rename-section" ? findDesktopPage(snapshot, dialog.pageId) : undefined
          }
          onCreated={(pageId) => {
            pendingRevealRef.current = pageId;
          }}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "delete-section" ? (
        <ConfirmDialog
          title={t("dialog.deleteSection.title")}
          message={t("dialog.deleteSection.message")}
          confirmLabel={t("dialog.deleteSection.confirm")}
          error={dialogError}
          onConfirm={() => void handleDeleteSection(dialog.pageId)}
          onCancel={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "move-to-section" ? (
        <MoveToSectionDialog
          workspace={snapshot}
          appId={dialog.appId}
          currentPageId={containerPageId(snapshot, dialog.appId)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "rename-folder" ? (
        <FolderDialog
          workspace={snapshot}
          pageId={effectiveActivePageId ?? pages[0]!.id}
          folder={findFolderEntity(snapshot, dialog.folderId)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "delete-folder" ? (
        <ConfirmDialog
          title={t("dialog.deleteFolder.title")}
          message={t("dialog.deleteFolder.message")}
          confirmLabel={t("dialog.deleteFolder.confirm")}
          error={dialogError}
          onConfirm={() => void handleDissolveFolder(dialog.folderId)}
          onCancel={closeDialog}
        />
      ) : null}

      {contextMenu !== null ? (
        <ContextMenu state={{
          ...contextMenu,
          entries: contextMenu.entries.map(entry => entry.kind === "submenu" && entry.id === "workspaces" && workspaceManager !== null ? workspaceManager.menu : entry),
        }} onClose={() => setContextMenu(null)} />
      ) : null}

      {/*
        Open-driven overlay surfaces (022): the Launcher, Settings window
        and App Inspector stay mounted and own their presence, so a close
        intent plays the exit animation while focus/scroll semantics stand
        down coherently, reopening mid-exit retargets, and the subtree
        releases exactly once.
      */}
      <Launcher
        open={launcherOpen}
        entries={launcherEntries}
        appsById={launcherAppsById}
        onActivate={activateLauncherEntry}
        onClose={() => setLauncherOpen(false)}
      />

      <SettingsCenter
        open={settingsOpen}
        workspace={snapshot}
        onPreviewAppearance={setAppearancePreview}
        onDraftChange={setSettingsDraftPreview}
        onSave={handleSettingsSave}
        onClose={closeSettings}
        backgroundEntrySectionId={settingsBackgroundSection}
        activeSectionId={effectiveActivePageId}
      />
    </>
  );
}
