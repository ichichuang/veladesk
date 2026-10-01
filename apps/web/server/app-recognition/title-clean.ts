/**
 * Conservative title cleaning (task 020-A §16).
 *
 * Marketing titles ("GitHub · Change is constant. GitHub keeps you
 * ahead.") become application names ("GitHub") only when a segment can be
 * picked with confidence: a hostname-derived brand token must match a
 * segment, or the title must be a simple two-part separator layout with a
 * clean first segment. Hyphens INSIDE a segment are always preserved
 * ("Coca-Cola" survives); a spaced hyphen only splits when the hostname
 * token explicitly matches one side. When nothing is confident the full
 * (whitespace-collapsed, punctuation-trimmed) title is returned — never a
 * blind truncation.
 */

/** Matches the Add-App name input's maxlength. */
export const RECOGNIZED_NAME_MAX_LENGTH = 80;

const SPACED_SEPARATOR_PATTERN = /\s+[|·•—–]\s+/u;
const SPACED_HYPHEN_PATTERN = /\s+-\s+/;
const TRIM_PUNCTUATION = " \t\n\r—–|-·•|:,.;!?\"'“”‘’()[]{}«»";

/**
 * Cleans a page title into a candidate application name.
 * `hostname` (optional, already normalized) drives segment matching.
 */
export function cleanRecognizedTitle(title: string, hostname?: string): string {
  const collapsed = title.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return "";
  }

  const token = hostnameBrandToken(hostname);
  const segments = collapsed.split(SPACED_SEPARATOR_PATTERN).filter((s) => s.length > 0);
  if (segments.length > 1) {
    const matched = token === undefined ? undefined : segmentMatchingToken(segments, token);
    if (matched !== undefined) {
      return finalizeSegment(matched);
    }
    const first = segments[0] ?? "";
    if (segments.length === 2 && looksLikeBrandLabel(first)) {
      return finalizeSegment(first);
    }
  }

  // Spaced hyphens only split when the hostname token vouches for a side.
  const hyphenSegments = collapsed.split(SPACED_HYPHEN_PATTERN).filter((s) => s.length > 0);
  if (hyphenSegments.length > 1 && token !== undefined) {
    const matched = segmentMatchingToken(hyphenSegments, token);
    if (matched !== undefined) {
      return finalizeSegment(matched);
    }
  }

  return finalizeSegment(collapsed);
}

/**
 * Registrable domains under these two-label public suffixes keep their
 * third-from-last label as the brand token ("docs.example.co.uk" →
 * "example"). Curated small list — only the common ccTLD patterns.
 */
const TWO_LABEL_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "co.jp", "or.jp", "ne.jp",
  "co.nz", "co.za",
  "com.au", "net.au", "org.au",
  "com.br", "com.cn", "com.mx", "com.tr", "com.ar",
  "co.in", "com.sg", "com.hk", "com.tw",
]);

/**
 * The registrable-domain brand token of a hostname: "github.com" →
 * "github", "docs.google.com" → "google", "youtu.be" → "youtu".
 */
export function hostnameBrandToken(hostname: string | undefined): string | undefined {
  if (hostname === undefined) {
    return undefined;
  }
  let host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }
  const labels = host.split(".").filter((label) => label.length > 0);
  if (labels.length < 2) {
    return undefined;
  }
  const secondLevel = labels[labels.length - 2]!;
  const topLevel = labels[labels.length - 1]!;
  if (labels.length >= 3 && TWO_LABEL_PUBLIC_SUFFIXES.has(`${secondLevel}.${topLevel}`)) {
    return labels[labels.length - 3];
  }
  return secondLevel;
}

function segmentMatchingToken(segments: readonly string[], token: string): string | undefined {
  const normalizedToken = token.replace(/[^a-z0-9]/g, "");
  if (normalizedToken.length < 3) {
    return undefined;
  }
  for (const segment of segments) {
    const normalized = segment.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      normalized === normalizedToken ||
      (normalized.length >= normalizedToken.length &&
        normalized.startsWith(normalizedToken))
    ) {
      return segment;
    }
  }
  return undefined;
}

/** A conservative "first segment is the brand" check: short, no sentences. */
function looksLikeBrandLabel(segment: string): boolean {
  if (segment.length === 0 || segment.length > 30) {
    return false;
  }
  return !/[.!?:;]/.test(segment);
}

function finalizeSegment(segment: string): string {
  return cleanRecognizedName(segment);
}

/** Collapses whitespace, trims surrounding punctuation and clamps to the name budget. */
export function cleanRecognizedName(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return clampName(trimPunctuation(collapsed).trim());
}

function trimPunctuation(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && TRIM_PUNCTUATION.includes(value[start] ?? "")) {
    start += 1;
  }
  while (end > start && TRIM_PUNCTUATION.includes(value[end - 1] ?? "")) {
    end -= 1;
  }
  return value.slice(start, end);
}

/** Clamps to the app-name budget, cutting at the last full character. */
export function clampName(name: string): string {
  return Array.from(name).slice(0, RECOGNIZED_NAME_MAX_LENGTH).join("");
}

/** Derives the fallback name from a hostname ("docs.example.co.uk" → "Example"). */
export function hostnameDisplayName(hostname: string): string {
  const token = hostnameBrandToken(hostname) ?? hostname;
  const words = token
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return clampName(words.length > 0 ? words.join(" ") : token);
}
