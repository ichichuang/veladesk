import type { AppShortcut } from "@veladesk/domain";

/**
 * Adaptive app content layout (task 019-B) — the ONE pure resolver that
 * decides how an app's icon and title are composed INSIDE the outer box
 * the user gave it (grid area or freeform rect).
 *
 * The user owns only the OUTER geometry; icon size and title size are no
 * longer product controls. Everything here is derived from the RENDERED
 * box (W × H), deterministic and pixel-runtime only:
 *
 *  - pure function of its inputs — no DOM, no clocks, no randomness;
 *  - never persisted — nothing from here enters a workspace snapshot;
 *  - independent of Grid/Freeform storage geometry — the caller passes
 *    the measured pixel box, so the same resolver serves the desktop
 *    grid host, the freeform canvas and the visual-editor preview
 *    without per-host formulas.
 *
 * Consumers write the result as inline `--vd-app-*` CSS variables (see
 * buildAppContentStyleVars) — never outer width/height geometry, which
 * stays owned by grid areas / freeform rects.
 */

/** Aspect ratio (W/H) at or above which the composition goes inline. */
export const INLINE_ASPECT_THRESHOLD = 1.55;

/**
 * Share of the smaller side used by the icon box in stack mode, before
 * the available-space bound. 0.62 keeps the historical desktop glyph
 * share (a 1×1 cell painted its glyph at 62cqmin).
 */
const STACK_ICON_SHARE = 0.62;
/** Icon box share in inline mode — a landscape strip may use more height. */
const INLINE_ICON_SHARE = 0.8;
/** Icon box share in solo mode (no title strip to reserve space for). */
const SOLO_ICON_SHARE = 0.68;

/**
 * Title font size = LABEL_FONT_SHARE × the smaller side, clamped. 0.145
 * keeps a default 1×1 cell (≈90px) at the historical ~13px desktop
 * label; the caps keep 3×3 restrained and tiny cells readable.
 */
const LABEL_FONT_SHARE = 0.145;
const LABEL_FONT_MIN_PX = 10;
const LABEL_FONT_MAX_PX = 30;
const LABEL_LINE_HEIGHT_FACTOR = 1.25;

/** Content insets/gaps, as shares of the smaller side, with safety caps. */
const PADDING_SHARE = 0.1;
const PADDING_MIN_PX = 5;
const PADDING_MAX_PX = 26;
const GAP_SHARE = 0.055;
const GAP_MIN_PX = 3;
const GAP_MAX_PX = 14;

/** Generated-text glyph: fraction of the icon box a single code point fills. */
const GENERATED_TEXT_SHARE = 0.56;
/** Smallest icon box the resolver will ever produce (degenerate inputs). */
const ICON_BOX_MIN_PX = 12;
/** Smallest title strip width before ellipsis takes over completely. */
const LABEL_MIN_WIDTH_PX = 24;

export interface AppContentLayoutInput {
  /** Rendered outer width in px (grid span box or freeform rect box). */
  readonly width: number;
  /** Rendered outer height in px. */
  readonly height: number;
  /** Whether the user kept the application-name strip (labelVisible). */
  readonly labelVisible: boolean;
  /** The icon source kind — generated text gets optical sizing. */
  readonly iconKind: "generated" | "library" | "image";
  /**
   * Code-point count of the generated text (1–4 supported; longer custom
   * text is still rendered, optically floored). Only read for
   * `iconKind: "generated"`.
   */
  readonly generatedTextLength?: number;
}

export type AppContentLayoutMode = "solo" | "stack" | "inline";

export interface AppContentLayout {
  readonly mode: AppContentLayoutMode;

  readonly padding: number;
  readonly gap: number;

  /** The composed icon box (glyph bounds) inside the content flow. */
  readonly iconBoxSize: number;

  readonly labelFontSize: number;
  readonly labelLineHeight: number;
  readonly labelMaxWidth: number;

  /**
   * Font size of a generated-text glyph (documented extension of the
   * task API): the icon box × the single-code-point share × the optical
   * factor for the code-point count. Undefined for library/image icons.
   */
  readonly generatedTextSize?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundPx(value: number): number {
  return Math.round(value * 2) / 2;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Optical scale of a generated-text glyph by code-point count: 1 char is
 * the largest, each further char steps down, with a floor for longer
 * custom text. Monotonically decreasing — never a size increase.
 */
export function generatedIconOpticalScale(codePoints: number): number {
  if (!Number.isFinite(codePoints) || codePoints <= 1) {
    return 1;
  }
  if (codePoints === 2) {
    return 0.8;
  }
  if (codePoints === 3) {
    return 0.66;
  }
  if (codePoints === 4) {
    return 0.56;
  }
  return 0.48;
}

/**
 * Resolves the adaptive composition for one rendered app box.
 *
 * Guarantees (asserted by app-content-layout.test.ts):
 *  - finite, positive padding/gap/icon box for any non-degenerate box;
 *  - no available-space overflow: in stack mode
 *    2·padding + iconBox + gap + labelLineHeight <= height, and the icon
 *    box never exceeds width − 2·padding or height − 2·padding;
 *  - labelVisible false ⇒ solo mode (no title strip at all);
 *  - W/H >= INLINE_ASPECT_THRESHOLD (with a visible label) ⇒ inline.
 */
export function resolveAppContentLayout(input: AppContentLayoutInput): AppContentLayout {
  const rawWidth = input.width;
  const rawHeight = input.height;
  const width = Number.isFinite(rawWidth) ? Math.max(0, rawWidth) : 0;
  const height = Number.isFinite(rawHeight) ? Math.max(0, rawHeight) : 0;
  const side = Math.min(width, height);

  const padding = roundPx(clamp(side * PADDING_SHARE, PADDING_MIN_PX, PADDING_MAX_PX));
  const gap = roundPx(clamp(side * GAP_SHARE, GAP_MIN_PX, GAP_MAX_PX));

  if (!input.labelVisible) {
    // Solo: the glyph owns the useful content area, no title strip.
    const inner = Math.max(0, Math.min(width - 2 * padding, height - 2 * padding));
    const iconBoxSize = roundPx(clamp(side * SOLO_ICON_SHARE, ICON_BOX_MIN_PX, Math.max(ICON_BOX_MIN_PX, inner)));
    return {
      mode: "solo",
      padding,
      gap,
      iconBoxSize,
      labelFontSize: LABEL_FONT_MIN_PX,
      labelLineHeight: round2(LABEL_FONT_MIN_PX * LABEL_LINE_HEIGHT_FACTOR),
      labelMaxWidth: Math.max(LABEL_MIN_WIDTH_PX, width - 2 * padding),
      ...(input.iconKind === "generated"
        ? { generatedTextSize: generatedTextSizeOf(iconBoxSize, input.generatedTextLength) }
        : {}),
    };
  }

  const labelFontSize = round2(clamp(side * LABEL_FONT_SHARE, LABEL_FONT_MIN_PX, LABEL_FONT_MAX_PX));
  const labelLineHeight = round2(labelFontSize * LABEL_LINE_HEIGHT_FACTOR);

  const inline = width / Math.max(1, height) >= INLINE_ASPECT_THRESHOLD;
  if (inline) {
    const heightBudget = Math.max(0, height - 2 * padding);
    const widthBudget = Math.max(0, width - 2 * padding - gap - LABEL_MIN_WIDTH_PX);
    const iconBoxSize = roundPx(
      clamp(
        Math.min(side * INLINE_ICON_SHARE, heightBudget, widthBudget),
        ICON_BOX_MIN_PX,
        Math.max(ICON_BOX_MIN_PX, Math.min(heightBudget, widthBudget)),
      ),
    );
    return {
      mode: "inline",
      padding,
      gap,
      iconBoxSize,
      labelFontSize,
      labelLineHeight,
      labelMaxWidth: Math.max(
        LABEL_MIN_WIDTH_PX,
        width - 2 * padding - iconBoxSize - gap,
      ),
      ...(input.iconKind === "generated"
        ? { generatedTextSize: generatedTextSizeOf(iconBoxSize, input.generatedTextLength) }
        : {}),
    };
  }

  // Stack: icon, gap, title as ONE vertically centered group — the icon
  // box is bounded by what remains after the title strip so the group
  // never overflows the box (small items never overlap).
  const stackBudget = Math.max(0, height - 2 * padding - gap - labelLineHeight);
  const widthBudget = Math.max(0, width - 2 * padding);
  const iconBoxSize = roundPx(
    clamp(
      Math.min(side * STACK_ICON_SHARE, stackBudget, widthBudget),
      ICON_BOX_MIN_PX,
      Math.max(ICON_BOX_MIN_PX, Math.min(stackBudget, widthBudget)),
    ),
  );
  return {
    mode: "stack",
    padding,
    gap,
    iconBoxSize,
    labelFontSize,
    labelLineHeight,
    labelMaxWidth: Math.max(LABEL_MIN_WIDTH_PX, width - 2 * padding),
    ...(input.iconKind === "generated"
      ? { generatedTextSize: generatedTextSizeOf(iconBoxSize, input.generatedTextLength) }
      : {}),
  };
}

function generatedTextSizeOf(iconBoxSize: number, codePoints: number | undefined): number {
  return round2(iconBoxSize * GENERATED_TEXT_SHARE * generatedIconOpticalScale(codePoints ?? 1));
}

/**
 * The icon source kind the resolver cares about, from an app's persisted
 * icon. Legacy per-app sizing fields (iconScale/labelScale) are
 * deliberately NOT read: they stopped driving desktop presentation in
 * 019-B and must not resurrect through the resolver.
 */
export function appContentIconKind(app: AppShortcut): "generated" | "library" | "image" {
  if (app.icon.kind === "iconify") {
    return "library";
  }
  if (app.icon.kind === "asset") {
    return "image";
  }
  return "generated";
}

/**
 * Resolves the adaptive layout for a rendered app box straight from the
 * app entity: the label switch and the icon kind are the only persisted
 * presentation inputs. Two apps that differ ONLY in deprecated
 * iconScale/labelScale resolve to the SAME layout (task 019-B §20).
 */
export function resolveAppContentLayoutForApp(
  app: AppShortcut,
  width: number,
  height: number
): AppContentLayout {
  const visual = app.visual;
  return resolveAppContentLayout({
    width,
    height,
    labelVisible: visual?.labelVisible ?? true,
    iconKind: appContentIconKind(app),
    ...(app.icon.kind === "generated"
      ? { generatedTextLength: Array.from(app.icon.text.trim()).length }
      : {}),
  });
}

/**
 * The resolver's output as inline CSS variables for the adaptive content
 * (task 019-B §12). Values only — NEVER outer width/height geometry —
 * so presentation vars can never leak into grid tracks or freeform
 * rects. `--vd-app-generated-text-size` is only emitted for
 * generated-text icons.
 */
export function buildAppContentStyleVars(layout: AppContentLayout): Readonly<Record<string, string>> {
  const vars: Record<string, string> = {
    "--vd-app-content-padding": `${layout.padding}px`,
    "--vd-app-content-gap": `${layout.gap}px`,
    "--vd-app-icon-box": `${layout.iconBoxSize}px`,
    "--vd-app-label-size": `${layout.labelFontSize}px`,
    "--vd-app-label-line-height": `${layout.labelLineHeight}px`,
    "--vd-app-label-max-width": `${layout.labelMaxWidth}px`,
  };
  if (layout.generatedTextSize !== undefined) {
    vars["--vd-app-generated-text-size"] = `${layout.generatedTextSize}px`;
  }
  return vars;
}
