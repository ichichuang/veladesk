import type { AppDecorationStyle, AppIcon, AppShortcut, AppVisualStyle } from "@veladesk/domain";

import { normalizeAppHexColor } from "./app-icon";
import { generatedIconText } from "./generated-icon";

/**
 * Pure draft model of the App Visual Editor (task 016-A).
 *
 * The editor edits a DRAFT; only Save touches the workspace (via
 * `replaceApp`). These helpers build the draft from an app, turn a draft
 * back into persisted domain values, and compare drafts — all pure.
 */

export const APP_ICON_TEXT_MAX_CODE_POINTS = 4;

export const MIN_SCALE_PERCENT = 50;
export const MAX_SCALE_PERCENT = 160;
export const SCALE_STEP_PERCENT = 5;

/** Where the icon comes from — the editor's icon-source tabs. */
export type AppVisualDraftSource = "library" | "text";

export interface AppVisualDraft {
  readonly source: AppVisualDraftSource;
  /** The selected library icon id (`<collection>:<name>`); "" = none yet. */
  readonly libraryIcon: string;
  /** Text mode: derived initials that follow renames, or user-owned text. */
  readonly textMode: "auto" | "custom";
  readonly customText: string;
  readonly iconScale: number;
  readonly decorationStyle: AppDecorationStyle;
  /** undefined = Auto (no persisted color). */
  readonly foregroundColor?: string | undefined;
  readonly decorationColor?: string | undefined;
}

const DECORATION_STYLES: readonly AppDecorationStyle[] = [
  "gradient",
  "solid",
  "glass",
  "none",
];

/**
 * The draft an editor opens with: the app's CURRENT effective look, never
 * the defaults — so Cancel-and-reopen is always a no-op round trip.
 */
export function draftFromApp(app: AppShortcut): AppVisualDraft {
  const icon = app.icon;
  const visual = app.visual;
  let source: AppVisualDraftSource = "text";
  let libraryIcon = "";
  let textMode: "auto" | "custom" = "auto";
  let customText = "";
  if (icon.kind === "iconify") {
    source = "library";
    libraryIcon = icon.icon;
  } else if (icon.kind === "generated" && icon.source === "custom") {
    textMode = "custom";
    customText = icon.text;
  }
  return {
    source,
    libraryIcon,
    textMode,
    customText,
    iconScale: visual?.iconScale ?? 1,
    decorationStyle: visual?.decorationStyle ?? "gradient",
    foregroundColor: normalizeAppHexColor(visual?.foregroundColor),
    decorationColor: normalizeAppHexColor(visual?.decorationColor),
  };
}

/** Why a custom icon text is not savable. */
export type IconTextIssue = "empty" | "too-long";

/**
 * Validates custom icon text: 1–4 Unicode code points (Array.from — no
 * grapheme dependency), not blank after trimming. 中文/英文/emoji/数字 all
 * count by code point.
 */
export function validateIconText(text: string): IconTextIssue | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "empty";
  }
  if (Array.from(trimmed).length > APP_ICON_TEXT_MAX_CODE_POINTS) {
    return "too-long";
  }
  return undefined;
}

/** Slider percent ↔ stored scale factor. */
export function scaleFromPercent(percent: number): number {
  return Math.round((percent / 100) * 100) / 100;
}

export function percentFromScale(scale: number): number {
  return Math.round(scale * 100);
}

/**
 * The persisted icon a draft stands for. Text+auto keeps deriving initials
 * from the app name (renames keep following); text+custom stores the
 * user's text verbatim; library stores the iconify id.
 */
export function buildDraftIcon(app: AppShortcut, draft: AppVisualDraft): AppIcon {
  if (draft.source === "library") {
    return { kind: "iconify", icon: draft.libraryIcon };
  }
  if (draft.textMode === "custom") {
    return { kind: "generated", text: draft.customText, source: "custom" };
  }
  return { kind: "generated", text: generatedIconText(app.name), source: "auto" };
}

/**
 * The persisted visual style of a draft. Colors are stored only when set —
 * "Auto" never writes a redundant default hex into the snapshot.
 */
export function buildDraftVisual(draft: AppVisualDraft): AppVisualStyle {
  const foreground = normalizeAppHexColor(draft.foregroundColor);
  const decoration = normalizeAppHexColor(draft.decorationColor);
  return {
    iconScale: draft.iconScale,
    decorationStyle: draft.decorationStyle,
    ...(foreground !== undefined ? { foregroundColor: foreground } : {}),
    ...(decoration !== undefined ? { decorationColor: decoration } : {}),
  };
}

/** The app a draft previews (and what Save persists via `replaceApp`). */
export function buildDraftApp(app: AppShortcut, draft: AppVisualDraft): AppShortcut {
  return {
    ...app,
    icon: buildDraftIcon(app, draft),
    visual: buildDraftVisual(draft),
  };
}

/**
 * Whether two drafts are semantically identical (colors compared
 * undefined-aware). Used to detect "no changes" drafts.
 */
export function draftEquals(a: AppVisualDraft, b: AppVisualDraft): boolean {
  return (
    a.source === b.source &&
    a.libraryIcon === b.libraryIcon &&
    a.textMode === b.textMode &&
    a.customText === b.customText &&
    a.iconScale === b.iconScale &&
    a.decorationStyle === b.decorationStyle &&
    normalizeAppHexColor(a.foregroundColor) === normalizeAppHexColor(b.foregroundColor) &&
    normalizeAppHexColor(a.decorationColor) === normalizeAppHexColor(b.decorationColor)
  );
}

/** Whether a draft can be saved as-is (library needs a pick, custom needs text). */
export function isDraftSavable(draft: AppVisualDraft): boolean {
  if (draft.source === "library") {
    return draft.libraryIcon.length > 0;
  }
  return draft.textMode === "auto" || validateIconText(draft.customText) === undefined;
}

/** The four decoration styles, in editor display order. */
export function decorationStyleChoices(): readonly AppDecorationStyle[] {
  return DECORATION_STYLES;
}
