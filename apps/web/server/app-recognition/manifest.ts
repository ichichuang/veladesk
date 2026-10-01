/**
 * Web app manifest parsing (task 020-A §14).
 *
 * Parses a bounded, already-fetched manifest body: `short_name`/`name`
 * (short_name wins) and a RANKED raster icon list (bigger declared sizes
 * first; SVG and monochrome-purpose icons are skipped — remote SVG is not
 * ingested by VelaDesk's asset pipeline). Relative icon URLs resolve
 * against the manifest's own URL.
 */

import { clampName } from "./title-clean";

export interface ManifestIconCandidate {
  readonly url: string;
  /** Largest declared edge in pixels, when parseable. */
  readonly declaredSize?: number;
}

export interface ManifestData {
  readonly shortName?: string;
  readonly name?: string;
  readonly icons: readonly ManifestIconCandidate[];
}

const MAX_MANIFEST_ICONS = 8;

/**
 * Parses manifest JSON; undefined when malformed, non-object, or when it
 * carries nothing usable. Never throws.
 */
export function parseWebManifest(jsonText: string, manifestUrl: string): ManifestData | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;

  const shortName = cleanManifestName(record.short_name);
  const name = cleanManifestName(record.name);
  const icons = collectManifestIcons(record.icons, manifestUrl);

  if (shortName === undefined && name === undefined && icons.length === 0) {
    return undefined;
  }
  return {
    ...(shortName !== undefined ? { shortName } : {}),
    ...(name !== undefined ? { name } : {}),
    icons,
  };
}

function cleanManifestName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? clampName(cleaned) : undefined;
}

function collectManifestIcons(value: unknown, manifestUrl: string): readonly ManifestIconCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const candidates: ManifestIconCandidate[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const icon = entry as Record<string, unknown>;
    if (typeof icon.src !== "string" || icon.src.trim().length === 0) {
      continue;
    }
    // Remote SVG is skipped unless sanitization is proven — it is not (§11).
    const declaredType = typeof icon.type === "string" ? icon.type.trim().toLowerCase() : "";
    if (declaredType.includes("svg") || icon.src.trim().toLowerCase().endsWith(".svg")) {
      continue;
    }
    const purpose = typeof icon.purpose === "string" ? icon.purpose.trim().toLowerCase() : "";
    if (purpose.split(/\s+/).includes("monochrome")) {
      continue;
    }
    let resolved: string;
    try {
      resolved = new URL(icon.src, manifestUrl).toString();
    } catch {
      continue;
    }
    const declaredSize = declaredSizeFrom(icon.sizes);
    candidates.push({
      url: resolved,
      ...(declaredSize !== undefined ? { declaredSize } : {}),
    });
    if (candidates.length >= MAX_MANIFEST_ICONS) {
      break;
    }
  }
  // Larger declared sizes first; stable for ties.
  return rankManifestIcons(candidates);
}

/** "512x512 192x192" → 512; "any"/unparseable → undefined. */
export function declaredSizeFrom(sizes: unknown): number | undefined {
  if (typeof sizes !== "string") {
    return undefined;
  }
  let best: number | undefined;
  for (const part of sizes.trim().toLowerCase().split(/\s+/)) {
    const match = /^(\d+)x(\d+)$/.exec(part);
    if (match === null) {
      continue;
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width <= 0 || height <= 0 || !Number.isSafeInteger(width * height)) {
      continue;
    }
    const edge = Math.max(width, height);
    if (best === undefined || edge > best) {
      best = edge;
    }
  }
  return best;
}

/** Ranks icon candidates: declared size descending, then input order. */
export function rankManifestIcons(
  icons: readonly ManifestIconCandidate[]
): readonly ManifestIconCandidate[] {
  return icons
    .map((icon, index) => ({ icon, index }))
    .sort((a, b) => {
      const sizeA = a.icon.declaredSize ?? 0;
      const sizeB = b.icon.declaredSize ?? 0;
      return sizeA !== sizeB ? sizeB - sizeA : a.index - b.index;
    })
    .map((entry) => entry.icon);
}

/** Acceptable manifest Content-Type bases. */
export function isManifestContentType(contentType: string): boolean {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "application/manifest+json" || base === "application/json";
}
