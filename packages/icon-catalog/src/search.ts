import { findIconCollection, loadIconSet } from "./collections";
import { ICON_COLLECTIONS } from "./meta";
import type { IconCollectionInfo } from "./meta";
import type {
  IconCollectionId,
  IconSearchOutcome,
  IconSearchRawQuery,
  IconSearchResult,
  IconSearchScope,
  IconSet,
} from "./types";

/**
 * Deterministic catalog search and paginated browsing over the nine
 * bundled collections.
 *
 * The whole index lives in memory: every collection is parsed once per
 * process (lazy singleton in `collections.ts`), normalized into a flat
 * name list, and reused for every request — no per-request JSON parsing.
 * A collection is only ever touched when a scope/collection filter reaches
 * it, so a narrow query never pays for the megabyte-scale sets.
 *
 * Ranking is deliberately deterministic V1, no fuzzy matching:
 *   1. score — exact, then prefix, then word-prefix, then substring
 *   2. collection order (brands first)
 *   3. icon name ascending
 *
 * Pagination always slices AFTER the full result list is ordered, and
 * `total` is the complete filtered match count — a client can walk the
 * entire catalog by following `nextOffset` until it turns null.
 */

export const ICON_QUERY_MAX_LENGTH = 100;
export const ICON_SEARCH_DEFAULT_LIMIT = 96;
export const ICON_SEARCH_MAX_LIMIT = 120;
export const ICON_SEARCH_DEFAULT_SCOPE: IconSearchScope = "recommended";

const ICON_SEARCH_SCOPES: readonly IconSearchScope[] = [
  "recommended",
  "all",
  "color",
  "brand",
  "general",
  "development",
  "emoji",
];

/**
 * The curated front page: a hand-picked mix of monochrome outlines and
 * full-color glyphs across all nine collections, shown when the picker
 * opens (scope=recommended, empty query). Everything is a REAL icon name —
 * an entry that stops resolving is skipped, never rendered as a blank.
 */
const RECOMMENDED_ICONS: readonly { collection: IconCollectionId; name: string }[] = [
  { collection: "simple-icons", name: "github" },
  { collection: "simple-icons", name: "youtube" },
  { collection: "simple-icons", name: "spotify" },
  { collection: "simple-icons", name: "figma" },
  { collection: "simple-icons", name: "googlechrome" },
  { collection: "simple-icons", name: "discord" },
  { collection: "simple-icons", name: "notion" },
  { collection: "lucide", name: "house" },
  { collection: "lucide", name: "search" },
  { collection: "lucide", name: "settings" },
  { collection: "lucide", name: "folder" },
  { collection: "lucide", name: "star" },
  { collection: "lucide", name: "calendar" },
  { collection: "lucide", name: "mail" },
  { collection: "lucide", name: "terminal" },
  { collection: "lucide", name: "cloud" },
  { collection: "tabler", name: "server" },
  { collection: "tabler", name: "database" },
  { collection: "tabler", name: "cloud" },
  { collection: "tabler", name: "home" },
  { collection: "ph", name: "robot" },
  { collection: "ph", name: "envelope" },
  { collection: "ph", name: "camera" },
  { collection: "ph", name: "gear" },
  { collection: "fluent-color", name: "mail-24" },
  { collection: "fluent-color", name: "calendar-24" },
  { collection: "fluent-color", name: "cloud-24" },
  { collection: "fluent-color", name: "settings-24" },
  { collection: "fluent-color", name: "home-24" },
  { collection: "fluent-color", name: "alert-24" },
  { collection: "fluent-color", name: "star-24" },
  { collection: "devicon", name: "docker" },
  { collection: "devicon", name: "react" },
  { collection: "devicon", name: "typescript" },
  { collection: "devicon", name: "vscode" },
  { collection: "devicon", name: "python" },
  { collection: "vscode-icons", name: "file-type-reactjs" },
  { collection: "vscode-icons", name: "file-type-vscode" },
  { collection: "vscode-icons", name: "file-type-typescript" },
  { collection: "vscode-icons", name: "file-type-docker" },
  { collection: "vscode-icons", name: "file-type-python" },
  { collection: "catppuccin", name: "typescript" },
  { collection: "catppuccin", name: "docker" },
  { collection: "catppuccin", name: "folder" },
  { collection: "noto", name: "robot" },
  { collection: "noto", name: "rocket" },
  { collection: "noto", name: "musical-note" },
  { collection: "noto", name: "video-game" },
  { collection: "noto", name: "artist-palette" },
  { collection: "noto", name: "desktop-computer" },
  { collection: "noto", name: "globe-with-meridians" },
];

/** The persisted `AppIcon.icon` string for a catalog icon. */
export function iconId(collection: IconCollectionId, name: string): string {
  return `${collection}:${name}`;
}

interface IconIndexEntry {
  readonly name: string;
  readonly label: string;
  readonly nameLower: string;
  readonly words: readonly string[];
}

interface IconCollectionIndex {
  readonly entries: readonly IconIndexEntry[];
  /** Name-ascending entries without hidden icons, for empty-query browse. */
  readonly browse: readonly IconIndexEntry[];
}

/**
 * Visible names → display label, per collection. Both the browse index and
 * the curated resolver start here, so alias-title precedence is decided in
 * exactly one place.
 */
function collectLabels(set: IconSet): Map<string, string> {
  const labels = new Map<string, string>();
  const icons = set.icons ?? {};
  for (const [name, icon] of Object.entries(icons)) {
    if (icon.hidden === true) {
      continue;
    }
    labels.set(name, icon.title ?? name);
  }
  const aliases = set.aliases ?? {};
  for (const [name, alias] of Object.entries(aliases)) {
    if (alias.hidden === true) {
      continue;
    }
    // Alias titles win (they carry the display name); parent titles were
    // already added under the parent's own name.
    labels.set(name, alias.title ?? icons[alias.parent]?.title ?? name);
  }
  return labels;
}

const LABEL_CACHE = new Map<IconCollectionId, Promise<Map<string, string>>>();

/** The visible name→label map for a collection, built at most once per process. */
export function loadCollectionLabels(
  collection: IconCollectionId
): Promise<Map<string, string>> {
  let cached = LABEL_CACHE.get(collection);
  if (cached === undefined) {
    cached = loadIconSet(collection).then(collectLabels);
    LABEL_CACHE.set(collection, cached);
  }
  return cached;
}

const INDEX_CACHE = new Map<IconCollectionId, Promise<IconCollectionIndex>>();

function splitWords(nameLower: string): string[] {
  return nameLower.split(/[^a-z0-9]+/).filter((word) => word.length > 0);
}

function makeEntry(name: string, label: string): IconIndexEntry {
  const nameLower = name.toLowerCase();
  return { name, label, nameLower, words: splitWords(nameLower) };
}

function byNameAsc(a: IconIndexEntry, b: IconIndexEntry): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

async function buildIndex(collection: IconCollectionId): Promise<IconCollectionIndex> {
  const labels = await loadCollectionLabels(collection);
  const entries = [...labels].map(([name, label]) => makeEntry(name, label));
  return { entries, browse: [...entries].sort(byNameAsc) };
}

/** The normalized index for a collection, built at most once per process. */
export function loadCollectionIndex(
  collection: IconCollectionId
): Promise<IconCollectionIndex> {
  let cached = INDEX_CACHE.get(collection);
  if (cached === undefined) {
    cached = buildIndex(collection);
    INDEX_CACHE.set(collection, cached);
  }
  return cached;
}

/** Match scores, ascending quality. */
const SCORE_EXACT = 0;
const SCORE_PREFIX = 1;
const SCORE_WORD_PREFIX = 2;
const SCORE_SUBSTRING = 3;

function bestScore(entry: IconIndexEntry, needles: readonly string[]): number | undefined {
  let best: number | undefined;
  for (const needle of needles) {
    let score: number;
    if (entry.nameLower === needle) {
      score = SCORE_EXACT;
    } else if (entry.nameLower.startsWith(needle)) {
      score = SCORE_PREFIX;
    } else if (entry.words.some((word) => word.startsWith(needle))) {
      score = SCORE_WORD_PREFIX;
    } else if (entry.nameLower.includes(needle)) {
      score = SCORE_SUBSTRING;
    } else {
      continue;
    }
    if (best === undefined || score < best) {
      best = score;
    }
  }
  return best;
}

function toResult(collection: IconCollectionId, entry: IconIndexEntry): IconSearchResult {
  const info = findIconCollection(collection)!;
  return {
    id: iconId(collection, entry.name),
    collection,
    name: entry.name,
    label: entry.label,
    category: info.category,
    palette: info.palette,
  };
}

function decodeLimit(value: unknown): number | undefined | "invalid" {
  if (value === undefined) {
    return undefined;
  }
  return decodeCanonicalInteger(value, 1, ICON_SEARCH_MAX_LIMIT);
}

function decodeOffset(value: unknown): number | undefined | "invalid" {
  if (value === undefined) {
    return undefined;
  }
  return decodeCanonicalInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

/**
 * Accepts a number or a canonical decimal string; anything else (floats,
 * "060", negatives, non-finite values) is `"invalid"`. Enforced here so
 * both the HTTP layer and direct callers share one gate.
 */
function decodeCanonicalInteger(
  value: unknown,
  min: number,
  max: number
): number | undefined | "invalid" {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : "invalid";
  }
  if (typeof value === "string") {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      return "invalid";
    }
    const parsed = Number(value);
    return parsed >= min && parsed <= max ? parsed : "invalid";
  }
  return "invalid";
}

function decodeScope(value: unknown): IconSearchScope | "invalid" {
  if (value === undefined) {
    return ICON_SEARCH_DEFAULT_SCOPE;
  }
  if (typeof value !== "string" || !ICON_SEARCH_SCOPES.includes(value as IconSearchScope)) {
    return "invalid";
  }
  return value as IconSearchScope;
}

function normalizeQuery(raw: string): string[] {
  const lowered = raw.trim().toLowerCase();
  if (lowered.length === 0) {
    return [];
  }
  // Collapse inner whitespace; also offer a dashed variant so "brand
  // github" finds "brand-github" without any fuzzy matching.
  const collapsed = lowered.replace(/\s+/g, " ");
  const dashed = collapsed.replace(/\s+/g, "-");
  return collapsed === dashed ? [collapsed] : [collapsed, dashed];
}

/** Whether a collection belongs to a scope's facet. */
function collectionMatchesScope(info: IconCollectionInfo, scope: IconSearchScope): boolean {
  switch (scope) {
    case "recommended":
    case "all":
      return true;
    case "color":
      return info.palette === "multicolor";
    case "brand":
    case "general":
    case "development":
    case "emoji":
      return info.category === scope;
  }
}

/** One page of an already-ordered result list, plus the paging metadata. */
function page(
  entries: readonly IconSearchResult[],
  offset: number,
  limit: number
): IconSearchOutcome {
  return {
    ok: true,
    icons: entries.slice(offset, offset + limit),
    total: entries.length,
    nextOffset: offset + limit < entries.length ? offset + limit : null,
  };
}

/** Every visible icon of the given collections, catalog order then A→Z. */
async function browseAll(
  collections: readonly IconCollectionInfo[]
): Promise<IconSearchResult[]> {
  const results: IconSearchResult[] = [];
  for (const info of collections) {
    const index = await loadCollectionIndex(info.id);
    for (const entry of index.browse) {
      results.push(toResult(info.id, entry));
    }
  }
  return results;
}

/** The curated front page, in curated order, restricted to `collections`. */
async function loadRecommended(
  collections: readonly IconCollectionInfo[]
): Promise<IconSearchResult[]> {
  const allowed = new Set(collections.map((info) => info.id));
  const results: IconSearchResult[] = [];
  const labelsByCollection = new Map<IconCollectionId, Map<string, string>>();
  for (const curated of RECOMMENDED_ICONS) {
    if (!allowed.has(curated.collection)) {
      continue;
    }
    let labels = labelsByCollection.get(curated.collection);
    if (labels === undefined) {
      labels = await loadCollectionLabels(curated.collection);
      labelsByCollection.set(curated.collection, labels);
    }
    const label = labels.get(curated.name);
    if (label === undefined) {
      continue;
    }
    results.push(toResult(curated.collection, makeEntry(curated.name, label)));
  }
  return results;
}

interface ScoredMatch {
  readonly entry: IconIndexEntry;
  readonly collection: IconCollectionId;
  readonly order: number;
  readonly score: number;
}

/** Search score as the primary key, then collection order, then name ASC. */
function compareMatches(a: ScoredMatch, b: ScoredMatch): number {
  if (a.score !== b.score) {
    return a.score - b.score;
  }
  if (a.order !== b.order) {
    return a.order - b.order;
  }
  return a.entry.name < b.entry.name ? -1 : a.entry.name > b.entry.name ? 1 : 0;
}

async function searchAll(
  collections: readonly IconCollectionInfo[],
  needles: readonly string[]
): Promise<IconSearchResult[]> {
  const matches: ScoredMatch[] = [];
  for (const info of collections) {
    const index = await loadCollectionIndex(info.id);
    for (const entry of index.entries) {
      const score = bestScore(entry, needles);
      if (score !== undefined) {
        matches.push({ entry, collection: info.id, order: info.order, score });
      }
    }
  }
  matches.sort(compareMatches);
  return matches.map((match) => toResult(match.collection, match.entry));
}

/**
 * Searches (or browses) the bundled catalog, one ordered page at a time.
 *
 * Decodes the raw query first — a refused shape is reported as an
 * `IconSearchQueryIssue` and never falls through to a partial result:
 * `q` must be a string of at most 100 code points (missing or empty means
 * browse), `scope` must be one of the seven known scopes (default
 * "recommended"), `offset` a non-negative canonical integer (default 0),
 * `limit` 1–120 (default 96) and `collection` — when present — a bundled id.
 *
 * An empty query in the `recommended` scope serves the curated front page;
 * every other empty-query scope browses the full catalog (or the requested
 * collection) in name order — never a starter list standing in for it.
 */
export async function searchIconCatalog(
  raw: IconSearchRawQuery
): Promise<IconSearchOutcome> {
  const { q, scope: rawScope, collection, offset: rawOffset, limit: rawLimit } = raw;

  let needles: string[] = [];
  if (q !== undefined) {
    if (typeof q !== "string" || Array.from(q).length > ICON_QUERY_MAX_LENGTH) {
      return { ok: false, issue: "invalid-query" };
    }
    needles = normalizeQuery(q);
  }

  const scope = decodeScope(rawScope);
  if (scope === "invalid") {
    return { ok: false, issue: "invalid-scope" };
  }

  const offset = decodeOffset(rawOffset);
  if (offset === "invalid") {
    return { ok: false, issue: "invalid-offset" };
  }
  const effectiveOffset = offset ?? 0;

  const limit = decodeLimit(rawLimit);
  if (limit === "invalid") {
    return { ok: false, issue: "invalid-limit" };
  }
  const effectiveLimit = limit ?? ICON_SEARCH_DEFAULT_LIMIT;

  if (
    collection !== undefined &&
    !(typeof collection === "string" && findIconCollection(collection) !== undefined)
  ) {
    return { ok: false, issue: "unknown-collection" };
  }
  const filter = collection as IconCollectionId | undefined;

  // Facet filter (scope) AND id filter (collection) — never a union.
  const collections = ICON_COLLECTIONS.filter(
    (info) =>
      collectionMatchesScope(info, scope) && (filter === undefined || info.id === filter)
  );

  if (scope === "recommended" && needles.length === 0) {
    return page(await loadRecommended(collections), effectiveOffset, effectiveLimit);
  }
  if (needles.length === 0) {
    return page(await browseAll(collections), effectiveOffset, effectiveLimit);
  }
  return page(await searchAll(collections, needles), effectiveOffset, effectiveLimit);
}
