/**
 * Public API of @veladesk/domain.
 *
 * Explicit named exports only — no `export *`, so the surface stays
 * reviewable as the domain evolves.
 */

export { createEmptyWorkspace } from "./workspace";
export type { CreateEmptyWorkspaceArgs } from "./workspace";

export { findCategory, findDesktopPage, findWorkspaceEntity } from "./lookup";

export type {
  AppIcon,
  AppOpenMode,
  AppShortcut,
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
  WorkspaceEntity,
  WorkspaceId,
  WorkspacePreferences,
  WorkspaceSnapshot,
} from "./types";
