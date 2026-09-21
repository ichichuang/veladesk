/**
 * Business domain contracts of a VelaDesk workspace.
 *
 * This module is pure TypeScript: no React, no DOM, no persistence.
 * Spatial layout geometry is owned by @veladesk/desktop-engine and
 * @veladesk/canvas-engine and only referenced here.
 */

import type { CanvasLayout } from "@veladesk/canvas-engine";
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
      /**
       * Where the text comes from. `auto` (and legacy `undefined`) means the
       * initials are derived from the app name and are recalculated on
       * rename; `custom` means the user owns the text and renames must
       * never overwrite it.
       */
      readonly source?: "auto" | "custom";
    };

/**
 * How an app's icon tile is painted. Ranges are semantic — see
 * `validateAppVisualStyle`.
 */
export type AppDecorationStyle = "gradient" | "solid" | "glass" | "none";

/**
 * Per-app visual style, optional on `AppShortcut` so every legacy snapshot
 * stays valid without a migration. Colors are exact `#RRGGBB` hex — never
 * arbitrary CSS. `iconScale` is a visual multiplier only; grid cells, spans
 * and drag metrics are never affected.
 */
export interface AppVisualStyle {
  readonly iconScale: number;
  readonly decorationStyle: AppDecorationStyle;

  readonly foregroundColor?: string;

  readonly decorationColor?: string;
}

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

  /**
   * Optional per-app visual style. Legacy apps without one resolve to
   * `DEFAULT_APP_VISUAL_STYLE` at render time — no migration, ever.
   */
  readonly visual?: AppVisualStyle;

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

/**
 * One desktop page.
 *
 * `layout.id` must equal `page.id`, and the grid of `layout.grid` stays the
 * snap lattice of the page even after a canvas exists.
 */
export interface DesktopPage {
  readonly id: DesktopPageId;
  readonly name: string;

  readonly layout: PageLayout;

  /**
   * Continuous canvas geometry and per-section placement mode.
   *
   * Optional for backward compatibility: snapshots persisted before canvas
   * existed stay valid forever and resolve to a virtual canvas derived from
   * `layout` (no migration, no write on render). When a canvas IS present it
   * is the authoritative membership and geometry source, and `layout.items`
   * must be empty.
   */
  readonly canvas?: CanvasLayout;
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

/** Visual color scheme of a workspace. `system` follows `prefers-color-scheme`. */
export type WorkspaceColorMode = "system" | "dark" | "light";

/** Built-in CSS-gradient wallpaper. No images in v1. */
export type WorkspaceWallpaperPreset = "aurora" | "midnight" | "dawn" | "mist";

/** Desktop icon scale. Grid cells and drag metrics are never affected. */
export type WorkspaceIconSize = "small" | "medium" | "large";

/**
 * Persisted visual preferences of a workspace.
 *
 * Ranges are semantic (see `validateWorkspaceAppearance`): accentHue is an
 * integer 0–359, surfaceOpacity 0.35–0.9, blurPx an integer 0–32 and
 * radiusPx an integer 8–24.
 */
export interface WorkspaceAppearancePreferences {
  readonly colorMode: WorkspaceColorMode;

  readonly accentHue: number;

  readonly wallpaperPreset: WorkspaceWallpaperPreset;

  readonly surfaceOpacity: number;

  readonly blurPx: number;

  readonly radiusPx: number;

  readonly iconSize: WorkspaceIconSize;
}

/** Persisted workspace preferences. Runtime drag state never lives here. */
export interface WorkspacePreferences {
  readonly defaultPageId: DesktopPageId;

  /**
   * Initial/default layout lock preference.
   * Runtime current drag state does not belong here.
   */
  readonly layoutLocked: boolean;

  /**
   * Grid gap in CSS pixels — a real geometry input for Grid sections.
   *
   * Optional for backward compatibility: snapshots persisted before the
   * gap existed stay valid forever; readers resolve them to
   * `DEFAULT_GRID_GAP_PX`. Deliberately NOT part of appearance, because it
   * affects layout geometry, not looks. Integer 0..32.
   */
  readonly gridGapPx?: number;

  /**
   * Visual preferences. Optional for backward compatibility: snapshots
   * persisted before appearance existed stay valid forever; readers resolve
   * them to `DEFAULT_WORKSPACE_APPEARANCE` without writing a migration.
   */
  readonly appearance?: WorkspaceAppearancePreferences;
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
