import type { AppDecorationStyle, AppIcon, AppShortcut, AppVisualStyle } from "@veladesk/domain";
import {
  DEFAULT_APP_LABEL_SCALE,
  DEFAULT_APP_LABEL_VISIBLE,
} from "@veladesk/domain";

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

/** Where the icon comes from — the editor's icon-source tabs. */
export type AppVisualDraftSource = "library" | "text" | "upload";

export interface AppVisualDraft {
  readonly source: AppVisualDraftSource;
  /** The selected library icon id (`<collection>:<name>`); "" = none yet. */
  readonly libraryIcon: string;
  /**
   * The selected uploaded asset id (upload tab); "" = no file chosen yet.
   * The BLOB itself never enters the draft — it lives in component state
   * as a pending upload and is staged only on Save.
   */
  readonly assetId: string;
  /** Text mode: derived initials that follow renames, or user-owned text. */
  readonly textMode: "auto" | "custom";
  readonly customText: string;
  readonly iconScale: number;
  /**
   * Label presentation (017-C), resolved — the draft always holds concrete
   * values so equality can be field-by-field. Edits the INNER presentation
   * only; geometry is untouchable from here.
   */
  readonly labelVisible: boolean;
  readonly labelScale: number;
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
  let assetId = "";
  let textMode: "auto" | "custom" = "auto";
  let customText = "";
  if (icon.kind === "iconify") {
    source = "library";
    libraryIcon = icon.icon;
  } else if (icon.kind === "asset") {
    source = "upload";
    assetId = icon.assetId;
  } else if (icon.kind === "generated" && icon.source === "custom") {
    textMode = "custom";
    customText = icon.text;
  }
  return {
    source,
    libraryIcon,
    assetId,
    textMode,
    customText,
    iconScale: visual?.iconScale ?? 1,
    labelVisible: visual?.labelVisible ?? DEFAULT_APP_LABEL_VISIBLE,
    labelScale: visual?.labelScale ?? DEFAULT_APP_LABEL_SCALE,
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

/**
 * The persisted icon a draft stands for. Text+auto keeps deriving initials
 * from the app name (renames keep following); text+custom stores the
 * user's text verbatim; library stores the iconify id.
 */
export function buildDraftIcon(app: AppShortcut, draft: AppVisualDraft): AppIcon {
  if (draft.source === "library") {
    return { kind: "iconify", icon: draft.libraryIcon };
  }
  if (draft.source === "upload" && draft.assetId.length > 0) {
    // Preview/save projection of the chosen upload (existing or pending).
    return { kind: "asset", assetId: draft.assetId };
  }
  if (draft.textMode === "custom") {
    return { kind: "generated", text: draft.customText, source: "custom" };
  }
  return { kind: "generated", text: generatedIconText(app.name), source: "auto" };
}

/**
 * The persisted visual style of a draft. Colors are stored only when set —
 * "Auto" never writes a redundant default hex into the snapshot. Label
 * presentation persists compactly the same way: shown/100% stays absent so
 * legacy-shaped styles remain the norm, while a hidden label or a custom
 * scale is written explicitly (task 017-C).
 */
export function buildDraftVisual(draft: AppVisualDraft): AppVisualStyle {
  const foreground = normalizeAppHexColor(draft.foregroundColor);
  const decoration = normalizeAppHexColor(draft.decorationColor);
  return {
    iconScale: draft.iconScale,
    decorationStyle: draft.decorationStyle,
    ...(draft.labelVisible ? {} : { labelVisible: false }),
    ...(draft.labelScale !== DEFAULT_APP_LABEL_SCALE ? { labelScale: draft.labelScale } : {}),
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
    a.assetId === b.assetId &&
    a.textMode === b.textMode &&
    a.customText === b.customText &&
    a.iconScale === b.iconScale &&
    a.labelVisible === b.labelVisible &&
    a.labelScale === b.labelScale &&
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
  if (draft.source === "upload") {
    // A chosen (or pre-existing) asset id is required; the BLOB is staged
    // at Save time, never before.
    return draft.assetId.length > 0;
  }
  return draft.textMode === "auto" || validateIconText(draft.customText) === undefined;
}

/** The four decoration styles, in editor display order. */
export function decorationStyleChoices(): readonly AppDecorationStyle[] {
  return DECORATION_STYLES;
}
