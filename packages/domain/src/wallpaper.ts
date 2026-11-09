import type { DesktopPage, WorkspaceWallpaperPreset } from "./types";

/**
 * Wallpaper model (task 023-C.1): one workspace default background plus an
 * OPTIONAL per-section override, stored as real workspace content (the
 * durable asset/snapshot path — never local view state).
 *
 * A config is a discriminated union: a built-in preset, or a staged content
 * asset with fit semantics (`cover` = centered fill without distortion;
 * `contain` = centered, no repetition, neutral canvas in uncovered areas).
 * No Blobs, base64, object URLs, filesystem paths or remote URLs are ever
 * stored — only stable ids.
 *
 * Backward compatibility: snapshots persisted before this field existed
 * stay valid forever. The legacy `wallpaperPreset` appearance field stays
 * readable; an explicit new config has precedence, and with no new config
 * the legacy value resolves through `resolveEffectiveWallpaper`.
 */

/** How a custom image fits the desktop. */
export type WallpaperFit = "cover" | "contain";

/** One persisted wallpaper configuration. */
export type WallpaperConfig =
  | { readonly kind: "preset"; readonly presetId: WorkspaceWallpaperPreset }
  | {
      readonly kind: "asset";
      readonly assetId: string;
      readonly fit: WallpaperFit;
      /** Center only in v1 — the field stays so old snapshots decode. */
      readonly position: "center";
    };

/**
 * The application default (P1): the Dawn Chart scene — the adopted visual
 * direction A's main scene (visual-directions-p1.md §A) and the last stop
 * of every wallpaper fallback chain.
 */
export const DEFAULT_WALLPAPER: WallpaperConfig = { kind: "preset", presetId: "dawn" };

const WALLPAPER_PRESETS: readonly string[] = ["aurora", "midnight", "dawn", "mist"];
const WALLPAPER_FITS: readonly string[] = ["cover", "contain"];

/**
 * Structural validity: recognized kinds, preset ids, non-empty asset ids,
 * recognized fitting and position values. Used by the snapshot decoder and
 * the editing operations — the same rule everywhere.
 */
export function isWallpaperConfig(value: unknown): value is WallpaperConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const config = value as { kind?: unknown; presetId?: unknown; assetId?: unknown; fit?: unknown; position?: unknown };
  if (config.kind === "preset") {
    return WALLPAPER_PRESETS.includes(config.presetId as string);
  }
  if (config.kind === "asset") {
    return (
      typeof config.assetId === "string" &&
      config.assetId.length > 0 &&
      WALLPAPER_FITS.includes(config.fit as string) &&
      config.position === "center"
    );
  }
  return false;
}

/** Where an effective wallpaper came from — the UI explains inheritance. */
export type WallpaperProvenance = "section" | "workspace" | "default";

export interface EffectiveWallpaper {
  readonly config: WallpaperConfig;
  readonly provenance: WallpaperProvenance;
}

/** How the workspace layer is being previewed in a Settings session. */
export interface WorkspaceWallpaperDraft {
  /**
   * The drafted workspace wallpaper; null means the user explicitly
   * REMOVED the workspace image (back to the last valid preset). Omit the
   * draft entirely when the workspace layer is not being edited.
   */
  readonly config: WallpaperConfig | null;
}

/**
 * The ONE canonical effective-wallpaper resolver (023-C.1), used by the
 * desktop, the Settings selection state and genuine thumbnails. Ordinary
 * precedence: page override → workspace wallpaper → legacy workspace
 * preset → application default.
 *
 * Draft semantics: a workspace draft substitutes ONLY the workspace layer
 * (it must never override a saved page-specific wallpaper); a page draft
 * substitutes only that page's layer, and `pageWallpaperExplicitlyInherits`
 * distinguishes "no draft" from an explicit Follow-workspace draft so
 * clearing an override previews inheritance before Save. Pure — no DOM, no
 * clocks, no storage.
 */
export function resolveEffectiveWallpaper(input: {
  /** The page whose override applies (its optional `wallpaper`). */
  readonly page: Pick<DesktopPage, "wallpaper"> | undefined;
  /** The page-layer DRAFT, when that page is being edited. */
  readonly pageWallpaperDraft: WallpaperConfig | null | undefined;
  /** True when a page draft explicitly chose Follow workspace. */
  readonly pageWallpaperExplicitlyInherits: boolean;
  /** Saved explicit workspace wallpaper (preferences.appearance.wallpaper). */
  readonly workspaceWallpaper: WallpaperConfig | undefined;
  /** The workspace-layer DRAFT, when the workspace default is being edited. */
  readonly workspaceDraft: WorkspaceWallpaperDraft | undefined;
  /** Legacy workspace preset (always present on decoded snapshots). */
  readonly legacyWorkspacePreset: WorkspaceWallpaperPreset;
}): EffectiveWallpaper {
  const { page, pageWallpaperDraft, pageWallpaperExplicitlyInherits, workspaceWallpaper, workspaceDraft, legacyWorkspacePreset } =
    input;

  // Page layer: an explicit-inherits draft previews inheritance; otherwise
  // the draft (when present, even null = removed image → inherit), else
  // the saved override.
  if (!pageWallpaperExplicitlyInherits) {
    const drafted = pageWallpaperDraft !== undefined ? pageWallpaperDraft : page?.wallpaper;
    if (drafted !== null && drafted !== undefined) {
      return { config: drafted, provenance: "section" };
    }
  }

  // Workspace layer: the draft substitutes only this layer.
  if (workspaceDraft !== undefined) {
    if (workspaceDraft.config !== null) {
      return { config: workspaceDraft.config, provenance: "workspace" };
    }
  } else if (workspaceWallpaper !== undefined) {
    return { config: workspaceWallpaper, provenance: "workspace" };
  }

  // Legacy preset, then the application default.
  if (WALLPAPER_PRESETS.includes(legacyWorkspacePreset)) {
    return { config: { kind: "preset", presetId: legacyWorkspacePreset }, provenance: "workspace" };
  }
  return { config: DEFAULT_WALLPAPER, provenance: "default" };
}

/** The per-mode override map of a page (`wallpaperByMode`). */
export type ModeWallpaperMap = NonNullable<DesktopPage["wallpaperByMode"]>;

/**
 * Structural validity of a `wallpaperByMode` map: a record whose present
 * values are valid wallpaper configs. Used by the snapshot decoder and
 * the editing operations — the same rule everywhere.
 */
export function isModeWallpaperMap(value: unknown): value is ModeWallpaperMap {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const map = value as { light?: unknown; dark?: unknown };
  return (
    (map.light === undefined || isWallpaperConfig(map.light)) &&
    (map.dark === undefined || isWallpaperConfig(map.dark))
  );
}

/** The input of {@link resolveModeAwareWallpaper} beyond the base chain. */
export interface ModeAwareWallpaperInput {
  /**
   * The EFFECTIVE color mode ("dark"/"light", already resolved from
   * `system`) the desktop renders in right now.
   */
  readonly effectiveMode: "dark" | "light";
  /** The page whose mode overrides apply (its optional `wallpaperByMode`). */
  readonly page: Pick<DesktopPage, "wallpaper" | "wallpaperByMode"> | undefined;
  /**
   * The per-mode DRAFT of the visible page's edited mode layer (the
   * Settings background editor): `null` = explicit removal — previews the
   * mode falling back to the page's general layer. Omit entirely when no
   * mode layer is being edited.
   */
  readonly modeWallpaperDraft:
    | { readonly mode: "dark" | "light"; readonly config: WallpaperConfig | null }
    | undefined;
}

/**
 * The mode-aware wallpaper resolver (P1): the EFFECTIVE color mode's
 * page-specific override first — drafted, then persisted — then the whole
 * ordinary chain (page general → workspace → legacy preset → default
 * Dawn Chart scene) unchanged. A mode draft that targets the OTHER mode
 * never substitutes this render. Pure — no DOM, no clocks, no storage.
 */
export function resolveModeAwareWallpaper(
  input: ModeAwareWallpaperInput,
  base: Parameters<typeof resolveEffectiveWallpaper>[0],
): EffectiveWallpaper {
  const { effectiveMode, page, modeWallpaperDraft } = input;

  const draftTargetsThisMode = modeWallpaperDraft !== undefined && modeWallpaperDraft.mode === effectiveMode;
  if (draftTargetsThisMode && modeWallpaperDraft.config !== null) {
    return { config: modeWallpaperDraft.config, provenance: "section" };
  }
  const persisted = page?.wallpaperByMode?.[effectiveMode];
  if (draftTargetsThisMode !== true && persisted !== undefined) {
    return { config: persisted, provenance: "section" };
  }

  return resolveEffectiveWallpaper(base);
}
