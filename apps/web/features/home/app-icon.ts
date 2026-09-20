import type { AppDecorationStyle, AppShortcut, AppVisualStyle } from "@veladesk/domain";
import {
  isValidAppHexColor,
  resolveAppVisualStyle,
} from "@veladesk/domain";
import { findIconCollection, isIconCollectionId } from "@veladesk/icon-catalog/meta";

import { generatedIconText } from "./generated-icon";

/**
 * Pure helpers behind the shared AppIconRenderer (task 016-A).
 *
 * Every user-influenced value is validated before it may reach CSS: icon
 * ids must resolve to a bundled collection with a strict name shape, colors
 * must be exact #RRGGBB, and the background strings are composed HERE from
 * validated parts — a renderer never interpolates a persisted string into
 * CSS directly.
 *
 * Collection membership and palette come from the catalog's browser-safe
 * metadata; this module never keeps its own collection list, so adding a
 * collection is a catalog change and nothing else.
 */

const ICON_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface ParsedIconifyIconId {
  readonly collection: string;
  readonly name: string;
}

/**
 * Parses a persisted `AppIcon.icon` value into a safe collection/name
 * pair. Anything that is not `<bundled-collection>:<strict-name>` is
 * rejected so the SVG URL can be built without escaping surprises.
 */
export function parseIconifyIconId(icon: string): ParsedIconifyIconId | undefined {
  const separator = icon.indexOf(":");
  if (separator <= 0 || separator === icon.length - 1) {
    return undefined;
  }
  const collection = icon.slice(0, separator);
  const name = icon.slice(separator + 1);
  if (!isIconCollectionId(collection) || !ICON_NAME_PATTERN.test(name)) {
    return undefined;
  }
  return { collection, name };
}

/** The self-hosted SVG endpoint URL for a bundled icon. */
export function iconSvgUrl(collection: string, name: string): string {
  return `/api/v1/icons/${encodeURIComponent(collection)}/${encodeURIComponent(name)}.svg`;
}

/** The icon URL for a parsed id — the only URL the renderer ever loads. */
export function iconSvgUrlForId(icon: string): string | undefined {
  const parsed = parseIconifyIconId(icon);
  return parsed === undefined ? undefined : iconSvgUrl(parsed.collection, parsed.name);
}

/**
 * How a library glyph must be drawn:
 *  - `mask` — the body is `currentColor`, so a CSS mask + foreground color
 *    gives the icon the app's tint (monochrome collections);
 *  - `image` — the body ships its own pigments, so it is loaded as an
 *    `<img>` from the same self-hosted route and its colors survive
 *    (multicolor collections).
 * `undefined` means the id can never render, which is the caller's cue to
 * fall back to the generated initials.
 */
export type IconifyGlyphModel =
  | { readonly kind: "mask"; readonly url: string }
  | { readonly kind: "image"; readonly url: string };

export function iconifyGlyphModel(icon: string): IconifyGlyphModel | undefined {
  const parsed = parseIconifyIconId(icon);
  if (parsed === undefined) {
    return undefined;
  }
  const url = iconSvgUrl(parsed.collection, parsed.name);
  const info = findIconCollection(parsed.collection);
  return info?.palette === "multicolor" ? { kind: "image", url } : { kind: "mask", url };
}

/**
 * Whether an app's glyph follows the app's own colors ("tinted", so
 * `foregroundColor` applies) or keeps whatever the source drew
 * ("original", so a foreground tint must be ignored). Multicolor library
 * icons and uploaded images are always original — exactly like the
 * generated-text case is always tinted.
 */
export type AppGlyphColorModel = "tinted" | "original";

export function appGlyphColorModel(app: AppShortcut): AppGlyphColorModel {
  if (app.icon.kind === "asset") {
    return "original";
  }
  if (app.icon.kind === "iconify") {
    return iconifyGlyphModel(app.icon.icon)?.kind === "image" ? "original" : "tinted";
  }
  return "tinted";
}

// --- Controlled color math (validated #RRGGBB in, derived #RRGGBB out) ---

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[r, g, b].map((value) => clamp(value).toString(16).padStart(2, "0")).join("")}`;
}

/** Scales a validated hex color's brightness by `factor` (1 = unchanged). */
export function shadedAppHex(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * factor, g * factor, b * factor);
}

/** Converts a validated hex color to an `rgba()` string with 0–1 alpha. */
export function rgbaFromAppHex(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Normalizes a user-provided color to the persisted #RRGGBB form
 * (lowercase), or undefined when the value is not a valid color — "Auto"
 * is expressed as the absence of the field, never as a sentinel hex.
 */
export function normalizeAppHexColor(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const lowered = value.trim().toLowerCase();
  return isValidAppHexColor(lowered) ? lowered : undefined;
}

// --- Renderer inputs ------------------------------------------------------

/**
 * CSS custom properties for the icon tile, all composed from validated
 * data. `--vd-app-icon-bg` is only emitted for a custom decoration color
 * (the CSS default per decoration style handles "Auto"), and the
 * foreground var only for a custom foreground color.
 */
export function buildAppIconStyleVars(style: AppVisualStyle): Readonly<Record<string, string>> {
  const vars: Record<string, string> = {
    "--vd-app-icon-scale": String(style.iconScale),
  };

  const decoration = style.decorationColor;
  if (decoration !== undefined && isValidAppHexColor(decoration)) {
    vars["--vd-app-icon-bg"] = decorationBackground(style.decorationStyle, decoration);
  }
  if (
    style.foregroundColor !== undefined &&
    isValidAppHexColor(style.foregroundColor)
  ) {
    vars["--vd-app-icon-fg"] = style.foregroundColor.toLowerCase();
  }
  return vars;
}

/** Composes the controlled background for a decoration style + color. */
export function decorationBackground(
  decorationStyle: AppDecorationStyle,
  decorationColor: string
): string {
  switch (decorationStyle) {
    case "gradient":
      // Controlled two-stop gradient derived from the validated hex.
      return `linear-gradient(150deg, ${shadedAppHex(decorationColor, 1.18)}, ${shadedAppHex(decorationColor, 0.72)})`;
    case "solid":
      return decorationColor.toLowerCase();
    case "glass":
      return rgbaFromAppHex(decorationColor, 0.34);
    case "none":
      // "none" ignores the decoration color entirely.
      return "transparent";
  }
}

/**
 * The text a generated/fallback icon shows. `source: "custom"` text is
 * user-owned and shown verbatim; everything else derives the initials from
 * the app name (blank custom text degrades to derived initials too).
 */
export function appIconDisplayText(app: AppShortcut): string {
  if (app.icon.kind === "generated") {
    const text = app.icon.text.trim();
    if (text.length > 0) {
      return app.icon.text;
    }
  }
  return generatedIconText(app.name);
}

/**
 * Whether renaming an app may recalculate its generated initials: only for
 * `generated` icons with an auto source (explicit "auto" or the legacy
 * undefined). Custom text and every other icon kind are never touched.
 */
export function generatedIconFollowsName(app: AppShortcut): boolean {
  return (
    app.icon.kind === "generated" &&
    (app.icon.source === undefined || app.icon.source === "auto")
  );
}

/** The resolved visual style of an app (re-exported for ergonomics). */
export function appVisual(app: AppShortcut): AppVisualStyle {
  return resolveAppVisualStyle(app);
}
