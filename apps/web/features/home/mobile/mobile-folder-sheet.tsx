"use client";

import type { AppShortcut, EntityId, WorkspaceSnapshot } from "@veladesk/domain";

import { AppIconTile } from "../app-icon-renderer";
import { resolveMobileFolderApps } from "./mobile-section-items";
import { MobileSheet } from "./mobile-sheet";
import "./mobile-shell.css";

/**
 * The mobile folder sheet (task 026 §30–§32): a bottom sheet over a normal
 * interface surface (never the wallpaper), listing the folder's apps in a
 * touch grid. Consumption only — open apps, nothing else: no move, no
 * delete, no rename, no dissolve, no drag. Escape/close returns focus to
 * the opener (the folder tile) through the Radix focus contract.
 */
export function MobileFolderSheet({
  folderId,
  workspace,
  onOpenApp,
  onFolderClosed,
}: {
  /** The open folder; null keeps the sheet unmounted. */
  readonly folderId: EntityId | null;
  readonly workspace: WorkspaceSnapshot;
  readonly onOpenApp: (app: AppShortcut) => void;
  readonly onFolderClosed: () => void;
}) {
  const folder =
    folderId === null
      ? undefined
      : workspace.entities.find(
          (entity) => entity.kind === "folder" && entity.id === folderId,
        );
  const apps = resolveMobileFolderApps(workspace, folderId);
  // The sheet lives only while a folder is open — closing unmounts it
  // (consumption surfaces never linger).
  if (folderId === null || folder === undefined || folder.kind !== "folder") {
    return null;
  }
  return (
    <MobileSheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onFolderClosed();
        }
      }}
      variant="folder"
      label={folder.name}
    >
      <div className="vela-mobile-sheet__head">
        <h2 className="vela-mobile-sheet__title">{folder.name}</h2>
      </div>
      <div className="vela-mobile-sheet__body">
        <ul className="vela-mobile-grid" aria-label={folder.name}>
          {apps.map(({ app }) => (
            <li key={app.id} className="vela-mobile-tile">
              <button type="button" className="vela-mobile-tile__button" onClick={() => onOpenApp(app)}>
                <AppIconTile app={app} />
                <span className="vela-mobile-tile__label">{app.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </MobileSheet>
  );
}
