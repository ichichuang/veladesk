/**
 * Business domain contracts of a VelaDesk workspace.
 *
 * This module is pure TypeScript: no React, no DOM, no persistence.
 * Spatial layout geometry is owned by @veladesk/desktop-engine and only
 * referenced here via `PageLayout`.
 */

import type { PageLayout } from "@veladesk/desktop-engine";

/** Stable identifier of a workspace. */
export type WorkspaceId = string;

/** Stable identifier of a desktop page. */
export type DesktopPageId = string;

/**
 * Stable identifier of a workspace entity (app, folder or widget).
 *
 * Entity ids are unique across ALL kinds within one workspace, because
 * desktop-engine `LayoutItem.id` references them directly.
 */
export type EntityId = string;

/** Stable identifier of a category. */
export type CategoryId = string;

/** Stable identifier of an uploaded asset. */
export type AssetId = string;

/** JSON scalar value. */
export type JsonPrimitive = string | number | boolean | null;

/** Any JSON-serializable value. */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

/** JSON object value. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** How an app shortcut opens when activated. */
export type AppOpenMode = "new-tab" | "same-tab" | "new-window" | "popup";

/** Icon description of an app shortcut. */
export type AppIcon =
  | {
      readonly kind: "favicon";
    }
  | {
      readonly kind: "iconify";
      readonly icon: string;
    }
  | {
      readonly kind: "asset";
      readonly assetId: AssetId;
    }
  | {
      readonly kind: "generated";
      readonly text: string;
    };

/**
 * A launchable shortcut.
 *
 * `url` is intentionally only required to be a non-empty string: VelaDesk is
 * trusted-LAN-first and custom protocols (steam://, obsidian://, vscode://,
 * …) must stay valid. No protocol allowlist, no URL() parsing.
 */
export interface AppShortcut {
  readonly kind: "app";

  readonly id: EntityId;

  readonly name: string;
  readonly url: string;

  readonly description?: string;

  readonly icon: AppIcon;

  readonly openMode: AppOpenMode;

  readonly categoryId?: CategoryId;

  readonly tags: readonly string[];
}

/**
 * A folder grouping shortcuts.
 *
 * V1 folders only contain apps — no nested folders, no widgets — to avoid
 * recursive trees, cycle detection and nested-folder UX at this stage.
 */
export interface Folder {
  readonly kind: "folder";

  readonly id: EntityId;
  readonly name: string;

  readonly children: readonly EntityId[];
}

/**
 * An instance of a widget on the workspace.
 *
 * `widgetType` is a stable type identifier (e.g. "builtin.clock" or
 * "plugin.example.weather"). Config schemas belong to the widget/plugin,
 * never hardcoded here.
 */
export interface WidgetInstance {
  readonly kind: "widget";

  readonly id: EntityId;

  readonly widgetType: string;

  readonly title?: string;

  readonly config: JsonObject;
}

/** Any entity stored in a workspace. `id` is globally unique across kinds. */
export type WorkspaceEntity = AppShortcut | Folder | WidgetInstance;

/** A user-defined app category. Array order is the display order. */
export interface Category {
  readonly id: CategoryId;
  readonly name: string;
}

/** One desktop page. `layout.id` must equal `page.id`. */
export interface DesktopPage {
  readonly id: DesktopPageId;
  readonly name: string;

  readonly layout: PageLayout;
}

/**
 * Pinned entity references.
 *
 * The dock is an orthogonal pin/reference list, not a container: an entity
 * may live on a page (or in a folder) and be docked at the same time.
 * Widgets are not dockable in V1. Ids appear at most once.
 */
export interface Dock {
  readonly items: readonly EntityId[];
}

/** Persisted workspace preferences. Runtime drag state never lives here. */
export interface WorkspacePreferences {
  readonly defaultPageId: DesktopPageId;

  /**
   * Initial/default layout lock preference.
   * Runtime current drag state does not belong here.
   */
  readonly layoutLocked: boolean;
}

/**
 * Serializable business snapshot of a whole workspace.
 *
 * Arrays (not records) on purpose: direct JSON serialization, deterministic
 * ordering, and small early-stage workspaces. This model is not the SQLite
 * schema; normalization belongs to the persistence layer.
 */
export interface WorkspaceSnapshot {
  readonly id: WorkspaceId;
  readonly name: string;

  readonly pages: readonly DesktopPage[];

  readonly entities: readonly WorkspaceEntity[];

  readonly categories: readonly Category[];

  readonly dock: Dock;

  readonly preferences: WorkspacePreferences;
}
