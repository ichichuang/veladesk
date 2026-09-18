import type { WorkspaceSnapshot } from "./types";

/**
 * Structural decoding of `WorkspaceSnapshot` from untrusted JSON.
 *
 * These guards verify that an unknown value HAS the `WorkspaceSnapshot`
 * structure before it is handed to the domain. Semantic rules (blank names,
 * bounds, overlaps, references) stay in `validateWorkspace` +
 * `@veladesk/desktop-engine` — nothing is duplicated here. Unknown extra
 * properties are ignored, and widget configs are accepted as recursive
 * JSON objects.
 *
 * Shared by the web server API boundary and the browser sync transport.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

/** A non-null, non-array object whose values are recursively JSON. */
function isJsonObject(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

const APP_OPEN_MODES: readonly string[] = ["new-tab", "same-tab", "new-window", "popup"];

function isAppIcon(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.kind) {
    case "favicon":
      return true;
    case "iconify":
      return typeof value.icon === "string";
    case "asset":
      return typeof value.assetId === "string";
    case "generated":
      return typeof value.text === "string";
    default:
      return false;
  }
}

function isWorkspaceEntity(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string") {
    return false;
  }
  switch (value.kind) {
    case "app":
      return (
        typeof value.name === "string" &&
        typeof value.url === "string" &&
        isOptionalString(value.description) &&
        isAppIcon(value.icon) &&
        APP_OPEN_MODES.includes(value.openMode as string) &&
        isOptionalString(value.categoryId) &&
        isStringArray(value.tags)
      );
    case "folder":
      return typeof value.name === "string" && isStringArray(value.children);
    case "widget":
      return (
        typeof value.widgetType === "string" &&
        isOptionalString(value.title) &&
        isJsonObject(value.config)
      );
    default:
      return false;
  }
}

function isLayoutItem(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string") {
    return false;
  }
  const { position, span } = value;
  return (
    isRecord(position) &&
    typeof position.column === "number" &&
    typeof position.row === "number" &&
    isRecord(span) &&
    typeof span.columns === "number" &&
    typeof span.rows === "number"
  );
}

function isPageLayout(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string") {
    return false;
  }
  return (
    isRecord(value.grid) &&
    typeof value.grid.columns === "number" &&
    typeof value.grid.rows === "number" &&
    Array.isArray(value.items) &&
    value.items.every(isLayoutItem)
  );
}

function isDesktopPage(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isPageLayout(value.layout)
  );
}

function isCategory(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isDock(value: unknown): boolean {
  return isRecord(value) && isStringArray(value.items);
}

const COLOR_MODES: readonly string[] = ["system", "dark", "light"];
const WALLPAPER_PRESETS: readonly string[] = ["aurora", "midnight", "dawn", "mist"];
const ICON_SIZES: readonly string[] = ["small", "medium", "large"];

/**
 * Structural shape of `WorkspaceAppearancePreferences` only — numeric
 * ranges are semantic and belong to `validateWorkspaceAppearance`
 * (accentHue 999 decodes fine and fails validation later).
 */
function isAppearancePreferences(value: unknown): boolean {
  return (
    isRecord(value) &&
    COLOR_MODES.includes(value.colorMode as string) &&
    typeof value.accentHue === "number" &&
    WALLPAPER_PRESETS.includes(value.wallpaperPreset as string) &&
    typeof value.surfaceOpacity === "number" &&
    typeof value.blurPx === "number" &&
    typeof value.radiusPx === "number" &&
    ICON_SIZES.includes(value.iconSize as string)
  );
}

function isPreferences(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.defaultPageId === "string" &&
    typeof value.layoutLocked === "boolean" &&
    // Optional for backward compatibility: pre-appearance snapshots stay
    // decodable forever; only a structurally valid appearance is accepted.
    (value.appearance === undefined || isAppearancePreferences(value.appearance))
  );
}

/**
 * Structural type guard for a whole `WorkspaceSnapshot`.
 * Returns `undefined` when the value does not have the required shape.
 */
export function decodeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !Array.isArray(value.pages) ||
    !value.pages.every(isDesktopPage) ||
    !Array.isArray(value.entities) ||
    !value.entities.every(isWorkspaceEntity) ||
    !Array.isArray(value.categories) ||
    !value.categories.every(isCategory) ||
    !isDock(value.dock) ||
    !isPreferences(value.preferences)
  ) {
    return undefined;
  }
  return value as unknown as WorkspaceSnapshot;
}
