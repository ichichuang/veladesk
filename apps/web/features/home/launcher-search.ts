import type { LauncherEntry } from "./launcher-types";

/**
 * Deterministic launcher search: normalized, case-insensitive,
 * whitespace-tokenized AND matching with a fixed score table.
 *
 * No fuzzy matching, no typo correction, no locale-dependent
 * collation — ranking is a pure arithmetic function of the query and
 * the entry's label/secondary strings, with `baseOrder` as the only
 * tie-break.
 */

/** The UI shows at most this many results; the helper returns the full ordered list. */
export const LAUNCHER_MAX_RESULTS = 24;

// Fixed score table (lower is better). Primary = the entry label;
// secondary = each of the entry's extra searchable strings.
const PRIMARY_EXACT = 0;
const PRIMARY_PREFIX = 10;
const PRIMARY_WORD_PREFIX = 20;
const PRIMARY_SUBSTRING = 30;
const SECONDARY_EXACT = 40;
const SECONDARY_PREFIX = 50;
const SECONDARY_WORD_PREFIX = 60;
const SECONDARY_SUBSTRING = 70;

/**
 * Normalizes text for matching: trim, lowercase, collapse every
 * whitespace run into a single space. Deliberately not
 * locale-dependent.
 */
export function normalizeLauncherText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Splits a query into AND tokens; empty query → no tokens. */
function tokenizeQuery(query: string): readonly string[] {
  const normalized = normalizeLauncherText(query);
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split(" ");
}

/**
 * Best score of one token against one normalized string, or null when
 * the token does not occur. Tiers are the (exact, prefix, wordPrefix,
 * substringBase) constants of the field's class.
 */
function scoreTokenAgainstText(
  token: string,
  text: string,
  exact: number,
  prefix: number,
  wordPrefix: number,
  substringBase: number,
): number | null {
  if (text === token) {
    return exact;
  }
  if (text.startsWith(token)) {
    return prefix;
  }
  const words = text.split(" ");
  for (const word of words) {
    if (word.startsWith(token)) {
      return wordPrefix;
    }
  }
  const index = text.indexOf(token);
  if (index >= 0) {
    return substringBase + index;
  }
  return null;
}

/** Best score of one token across the whole entry, or null (no match → entry excluded). */
function scoreTokenAgainstEntry(
  token: string,
  entry: LauncherEntry,
): number | null {
  let best = scoreTokenAgainstText(
    token,
    normalizeLauncherText(entry.label),
    PRIMARY_EXACT,
    PRIMARY_PREFIX,
    PRIMARY_WORD_PREFIX,
    PRIMARY_SUBSTRING,
  );
  for (const raw of entry.secondary) {
    const score = scoreTokenAgainstText(
      token,
      normalizeLauncherText(raw),
      SECONDARY_EXACT,
      SECONDARY_PREFIX,
      SECONDARY_WORD_PREFIX,
      SECONDARY_SUBSTRING,
    );
    if (score !== null && (best === null || score < best)) {
      best = score;
    }
  }
  return best;
}

/**
 * Searches and ranks entries for a query.
 *
 * Empty (or whitespace-only) query → the input list unchanged, in its
 * empty-query discoverability order (no text relevance is computed).
 * Non-empty query → every token must match somewhere in the label or
 * secondary strings (AND); entries are ordered by the sum of the
 * per-token best scores, then by baseOrder. Returns the full ordered
 * result list — the UI applies the visible-result limit.
 */
export function searchLauncherEntries(
  entries: readonly LauncherEntry[],
  query: string,
): readonly LauncherEntry[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return entries;
  }
  const scored: { entry: LauncherEntry; score: number }[] = [];
  for (const entry of entries) {
    let total = 0;
    let matchedAllTokens = true;
    for (const token of tokens) {
      const score = scoreTokenAgainstEntry(token, entry);
      if (score === null) {
        matchedAllTokens = false;
        break;
      }
      total += score;
    }
    if (matchedAllTokens) {
      scored.push({ entry, score: total });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.entry.baseOrder - b.entry.baseOrder);
  return scored.map((candidate) => candidate.entry);
}
