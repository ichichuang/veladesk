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
  INTERFACE_STYLES,
  inferInterfaceStyle,
  resolveInterfaceStyle,
  resolveWorkspaceAppearance,
  validateWorkspaceAppearance,
} from "./appearance";
export type { InterfaceStyleParameters, WorkspaceAppearanceValidationIssue } from "./appearance";

export {
  DEFAULT_GRID_GAP_PX,
  GRID_GAP_STEP_PX,
  MAX_GRID_GAP_PX,
  MIN_GRID_GAP_PX,
  isValidGridGapPx,
  resolveGridGapPx,
} from "./preferences";

export {
  DEFAULT_REDUCED_MOTION,
  resolveHelmMotionEnabled,
  resolveReducedMotionPreference,
  validateWorkspaceMotion,
} from "./motion";
export type { WorkspaceMotionValidationIssue } from "./motion";

export {
  DEFAULT_APP_LABEL_SCALE,
  DEFAULT_APP_LABEL_VISIBLE,
  DEFAULT_APP_VISUAL_STYLE,
  MAX_APP_LABEL_SCALE,
  MAX_ICON_SCALE,
  MIN_APP_LABEL_SCALE,
  MIN_ICON_SCALE,
  isValidAppHexColor,
  resolveAppVisualStyle,
  validateAppVisualStyle,
} from "./app-visual";
export type { AppVisualValidationIssue } from "./app-visual";

export { findCategory, findDesktopPage, findWorkspaceEntity } from "./lookup";

export {
  gridPlacementOf,
  isCanvasPage,
  materializePagePlacement,
  newCanvasItemRect,
  pageItemIds,
  placePageItem,
  placementSizeOf,
  resolvePagePlacement,
  snappedRectForGrid,
  spanFromFreeformRect,
  withPageCanvas,
} from "./canvas";
export type {
  CanvasPage,
  NewCanvasItemRectArgs,
  PageItemPlacement,
  PagePlacement,
} from "./canvas";

export { decodeWorkspaceSnapshot } from "./decoding";

export { exportRecipe, importRecipe, migrateRecipe } from "./recipe/recipe";
export type {
  ExportRecipeOptions,
  MigrateRecipeResult,
  RecipeMigrationFailure,
} from "./recipe/recipe";
export {
  RECIPE_FILE_EXTENSION,
  RECIPE_FORMAT_IDENTITY,
  RECIPE_VERSION,
} from "./recipe/types";
export type {
  RecipeImportPayload,
  RecipeMotionV1,
  RecipePluginV1,
  RecipeSpaceLayout,
  RecipeSpaceV1,
  RecipeThemeV1,
  RecipeTileV1,
  RecipeV1,
} from "./recipe/types";

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
  WorkspaceInterfaceStyle,
  WorkspaceMotionExperiments,
  WorkspaceMotionPreferences,
  WorkspacePreferences,
  WorkspaceReducedMotionPreference,
  WorkspaceSnapshot,
  WorkspaceWallpaperPreset,
} from "./types";

export {
  DEFAULT_WALLPAPER,
  isWallpaperConfig,
  resolveEffectiveWallpaper,
} from "./wallpaper";
export type {
  EffectiveWallpaper,
  WallpaperConfig,
  WallpaperFit,
  WallpaperProvenance,
  WorkspaceWallpaperDraft,
} from "./wallpaper";
export { replacePageWallpaper } from "./editing";
