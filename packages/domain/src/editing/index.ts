/**
 * The workspace editing surface (P1 split of the former editing.ts
 * monolith — same public API, three focused modules):
 *
 *   ./shared   the failure/result vocabulary + immutable snapshot splices;
 *   ./entities app/folder/dock operations (create, edit, move, delete,
 *              dissolve, relocate);
 *   ./pages    section CRUD, wallpaper overrides, the preferences write
 *              path and the canvas/placement commits.
 *
 * This barrel preserves the historical `./editing` import path — including
 * `@veladesk/domain`'s own index — so no consumer changes. The shared
 * internals stay module-private by omission.
 */

export type {
  WorkspaceEditFailureReason,
  WorkspaceEditResult,
} from "./shared";

export type { DeletedAppRestoreEntry } from "./entities";

export {
  addAppToPage,
  addAppToFolder,
  addFolderToPage,
  replaceApp,
  renameFolder,
  moveAppToFolder,
  moveAppToPage,
  deleteApp,
  captureDeletedAppEntry,
  restoreDeletedApp,
  pinEntityToDock,
  unpinEntityFromDock,
  dissolveFolderToPage,
  relocateAppToPage,
} from "./entities";

export {
  replaceWorkspacePreferences,
  addPage,
  renamePage,
  replacePageWallpaper,
  replacePageModeWallpaper,
  movePage,
  setDefaultPage,
  deleteEmptyPage,
  replacePageCanvas,
  switchPagePlacementMode,
} from "./pages";
