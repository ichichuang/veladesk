import type { WorkspaceSnapshot } from "./types";

/**
 * Structural decoding of `WorkspaceSnapshot` from untrusted JSON.
 *
 * These guards verify that an unknown value HAS the `WorkspaceSnapshot`
 * structure before it is handed to the domain. Semantic rules (blank names,
 * bounds, overlaps, references, canvas rect validity) stay in
 * `validateWorkspace` + `@veladesk/desktop-engine` +
 * `@veladesk/canvas-engine` — nothing is duplicated here. Unknown extra
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

const GENERATED_ICON_SOURCES: readonly string[] = ["auto", "custom"];

function isGeneratedIcon(value: Record<string, unknown>): boolean {
  if (typeof value.text !== "string") {
    return false;
  }
  // Optional since forever (legacy apps have no source); when present it
  // must be a known source word. Semantic behavior (auto follows renames)
  // lives with the renderer/editor, not here.
  return value.source === undefined || GENERATED_ICON_SOURCES.includes(value.source as string);
}

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
      return isGeneratedIcon(value);
    default:
      return false;
  }
}

const APP_DECORATION_STYLES: readonly string[] = ["gradient", "solid", "glass", "none"];

/**
 * Structural shape of `AppVisualStyle` only — the numeric scale ranges and
 * hex color rules are semantic and belong to `validateAppVisualStyle`
 * (iconScale 99 or `url(...)` decode fine and fail validation later).
 * `labelVisible`/`labelScale` are optional and only shape-checked here:
 * boolean / number, exactly like the legacy fields.
 */
function isAppVisualStyle(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.iconScale === "number" &&
    APP_DECORATION_STYLES.includes(value.decorationStyle as string) &&
    (value.labelVisible === undefined || typeof value.labelVisible === "boolean") &&
    (value.labelScale === undefined || typeof value.labelScale === "number") &&
    (value.foregroundColor === undefined || typeof value.foregroundColor === "string") &&
    (value.decorationColor === undefined || typeof value.decorationColor === "string")
  );
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
        // Optional since forever (legacy apps have no visual); only a
        // structurally valid style is accepted. Ranges are semantic.
        (value.visual === undefined || isAppVisualStyle(value.visual)) &&
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

const CANVAS_PLACEMENT_MODES: readonly string[] = ["snap", "freeform"];

function isCanvasRect(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.width === "number" &&
    typeof value.height === "number"
  );
}

function isCanvasLayoutItem(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && isCanvasRect(value.rect);
}

function isGridCanvasItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.column === "number" &&
    typeof value.row === "number" &&
    typeof value.columnSpan === "number" &&
    typeof value.rowSpan === "number"
  );
}

/**
 * Structural shape of a `CanvasLayout` (any version) only — safe-integer
 * fields, bounds, version agreement and id uniqueness are semantic and
 * belong to the canvas engine's `validateCanvasLayout` (a rect beyond the
 * canvas or a span past the columns decodes fine and fails validation
 * later). v1 keeps both `snap` and `freeform`; v2 splits Grid (integer cell
 * items plus a column count) from Freeform (rect items).
 */
function isCanvasLayout(value: unknown): boolean {
  if (!isRecord(value) || typeof value.version !== "number") {
    return false;
  }
  if (value.version === 2 && value.mode === "grid") {
    return typeof value.columns === "number" && Array.isArray(value.items) && value.items.every(isGridCanvasItem);
  }
  if (value.version === 2 && value.mode === "freeform") {
    return Array.isArray(value.items) && value.items.every(isCanvasLayoutItem);
  }
  return (
    value.version === 1 &&
    CANVAS_PLACEMENT_MODES.includes(value.mode as string) &&
    Array.isArray(value.items) &&
    value.items.every(isCanvasLayoutItem)
  );
}

function isDesktopPage(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isPageLayout(value.layout) &&
    // Optional for backward compatibility: grid-era pages stay decodable
    // forever; only a structurally valid canvas is accepted.
    (value.canvas === undefined || isCanvasLayout(value.canvas))
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
    // Optional for backward compatibility: pre-gap snapshots stay decodable
    // forever; the integer range is semantic (validateWorkspace).
    (value.gridGapPx === undefined || typeof value.gridGapPx === "number") &&
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
