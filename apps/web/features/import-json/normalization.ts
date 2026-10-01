/**
 * Pure normalization helpers for VelaDesk Import JSON v1 (task 024 §16,
 * §20): one canonical name key for section/app comparison and one URL
 * duplicate key — plus the Add-App-equivalent URL acceptance rule.
 */

import { normalizeAppRecognitionUrl } from "../app-recognition/normalize-url";
import { IMPORT_MAX_URL_LENGTH } from "./contract";

/**
 * Comparison key for names: Unicode NFKC, trimmed, internal whitespace runs
 * collapsed to one space, lowercased. The DISPLAY spelling is preserved
 * separately by {@link normalizeImportDisplayName}.
 */
export function normalizeImportNameKey(name: string): string {
  return collapseWhitespace(name.normalize("NFKC")).toLowerCase();
}

/**
 * Display value: the user's original spelling (no lowercasing, no NFKC
 * rewrite of what the user sees) with only outer whitespace and internal
 * runs normalized.
 */
export function normalizeImportDisplayName(name: string): string {
  return collapseWhitespace(name);
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Duplicate-detection key for a stored app URL: WHATWG normalization for
 * parseable URLs (scheme/hostname casing, default ports, empty path →
 * root slash), fragments ignored, query preserved verbatim (never
 * reordered). For custom-protocol strings the URL parser rejects, falls
 * back to trimming + fragment removal + scheme lowercase.
 */
export function canonicalImportUrlKey(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    const withoutFragment = trimmed.replace(/#[\s\S]*$/, "");
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*:)([\s\S]*)$/.exec(withoutFragment);
    if (scheme !== null && scheme[1] !== undefined && scheme[2] !== undefined) {
      return `${scheme[1].toLowerCase()}${scheme[2]}`;
    }
    return withoutFragment;
  }
  // Non-special schemes (obsidian://…) keep their opaque-ish host; special
  // schemes get hostname lowercased and default ports dropped by `URL`.
  const port = parsed.port === "" ? "" : `:${parsed.port}`;
  return `${parsed.protocol.toLowerCase()}//${parsed.hostname.toLowerCase()}${port}${parsed.pathname}${parsed.search}`;
}

/**
 * The Add-App URL acceptance rule (task 024 §19–§20): identical to ordinary
 * app creation — blank or oversized input is invalid, everything else is
 * accepted; recognizable input is stored in its normalized https/http form
 * while custom protocols stay (trimmed) verbatim. The recognition gate's
 * public-host restriction is deliberately NOT reused as a validator —
 * intranet tools import fine.
 */
export function resolveImportAppUrl(
  input: string
): { readonly ok: true; readonly stored: string; readonly urlKey: string } | { readonly ok: false } {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > IMPORT_MAX_URL_LENGTH) {
    return { ok: false };
  }
  const normalized = normalizeAppRecognitionUrl(trimmed);
  const stored = normalized.ok ? normalized.normalizedUrl : trimmed;
  return { ok: true, stored, urlKey: canonicalImportUrlKey(stored) };
}
