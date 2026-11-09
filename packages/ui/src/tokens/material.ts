/**
 * Material-tier token constants (个性化材质档). A tier is a pure TOKEN
 * override selected by `data-vd-material` on the themed root — components
 * never branch on it, they keep consuming the same semantic names:
 *
 *   清爽 clean — blur floored to 0 and surfaces fully opaque (实底);
 *   柔和 soft  — blur ×0.6 and the surface alpha raised to 0.82;
 *   玻璃 glass — the token-table defaults (no override block in CSS).
 *
 * The tiers deliberately mirror the persisted workspace `interfaceStyle`
 * vocabulary (clean/soft/glass) so a later task can emit the attribute
 * from the same preference. Low-end devices / the "flow" performance tier
 * collapse onto the clean values.
 */

/** The tier attribute name on the themed root. */
export const VD_MATERIAL_ATTRIBUTE = "data-vd-material";

/** A material tier. */
export type VdMaterialTier = "clean" | "soft" | "glass";

/** Every tier, in display order. */
export const VD_MATERIALS: readonly VdMaterialTier[] = ["clean", "soft", "glass"];

/** The semantic overrides a tier applies (glass = none, the defaults). */
export interface VdMaterialOverrides {
  /** Multiplier on every blur band (0 floors all bands to solid). */
  readonly blurMultiplier: number;
  /** The surface alpha the tier forces. */
  readonly surfaceAlpha: number;
  /** The raised (menu/dialog) alpha the tier forces, when it changes. */
  readonly raisedAlpha?: number;
}

/** The override table; `glass` carries the token-table defaults. */
export const VD_MATERIAL_OVERRIDES: Readonly<Record<VdMaterialTier, VdMaterialOverrides>> = {
  clean: { blurMultiplier: 0, surfaceAlpha: 1, raisedAlpha: 1 },
  // The spec raises only the surface channel: 柔和 = blur ×0.6、surface 0.82.
  soft: { blurMultiplier: 0.6, surfaceAlpha: 0.82 },
  glass: { blurMultiplier: 1, surfaceAlpha: 0.62 },
};

/** Parses a tier attribute value; unknown values resolve to glass. */
export function vdMaterialFromAttribute(value: string | null | undefined): VdMaterialTier {
  return VD_MATERIALS.includes(value as VdMaterialTier) ? (value as VdMaterialTier) : "glass";
}
