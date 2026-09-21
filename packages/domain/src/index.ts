/**
 * Public API of @veladesk/domain.
 *
 * Explicit named exports only — no `export *`, so the surface stays
 * reviewable as the domain evolves.
 */

export { createEmptyWorkspace } from "./workspace";
export type { CreateEmptyWorkspaceArgs } from "./workspace";

export {
  DEFAULT_WORKSPACE_APPEARANCE,
  resolveWorkspaceAppearance,
  validateWorkspaceAppearance,
} from "./appearance";
export type { WorkspaceAppearanceValidationIssue } from "./appearance";

export {
  DEFAULT_APP_VISUAL_STYLE,
  MAX_ICON_SCALE,
  MIN_ICON_SCALE,
  isValidAppHexColor,
  resolveAppVisualStyle,
  validateAppVisualStyle,
} from "./app-visual";
export type { AppVisualValidationIssue } from "./app-visual";

export { findCategory, findDesktopPage, findWorkspaceEntity } from "./lookup";

export {
  isCanvasPage,
  materializePageCanvas,
  newCanvasItemRect,
  pageItemIds,
  placePageItem,
  resolvePageCanvas,
  withPageCanvas,
} from "./canvas";
export type {
  CanvasPage,
  NewCanvasItemRectArgs,
  PageItemPlacement,
} from "./canvas";

export { decodeWorkspaceSnapshot } from "./decoding";

export { validateWorkspace } from "./validation";
export type { WorkspaceValidationIssue } from "./validation";

export {
  addAppToPage,
  addAppToFolder,
  addFolderToPage,
  addPage,
  deleteApp,
  deleteEmptyPage,
  dissolveFolderToPage,
  moveAppToFolder,
  moveAppToPage,
  movePage,
  pinEntityToDock,
  relocateAppToPage,
  renameFolder,
  renamePage,
  replaceApp,
  replacePageCanvas,
  replaceWorkspacePreferences,
  setDefaultPage,
  unpinEntityFromDock,
} from "./editing";
export type { WorkspaceEditFailureReason, WorkspaceEditResult } from "./editing";

export type {
  AppDecorationStyle,
  AppIcon,
  AppOpenMode,
  AppShortcut,
  AppVisualStyle,
  AssetId,
  Category,
  CategoryId,
  DesktopPage,
  DesktopPageId,
  Dock,
  EntityId,
  Folder,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  WidgetInstance,
  WorkspaceAppearancePreferences,
  WorkspaceColorMode,
  WorkspaceEntity,
  WorkspaceIconSize,
  WorkspaceId,
  WorkspacePreferences,
  WorkspaceSnapshot,
  WorkspaceWallpaperPreset,
} from "./types";
