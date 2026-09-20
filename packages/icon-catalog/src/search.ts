import { findIconCollection, loadIconSet, resolveIcon } from "./collections";
import { ICON_COLLECTIONS } from "./collections";
import type {
  IconCollectionId,
  IconSearchOutcome,
  IconSearchRawQuery,
  IconSearchResult,
  IconSet,
} from "./types";

/**
 * Deterministic catalog search over the four bundled collections.
 *
 * The whole index lives in memory: every collection is parsed once per
 * process (lazy singleton in `collections.ts`), normalized into a flat
 * name list, and reused for every request — no per-request JSON parsing.
 *
 * Ranking is deliberately deterministic V1, no fuzzy matching:
 *   1. score — exact, then prefix, then word-prefix, then substring
 *   2. collection order (brands first)
 *   3. icon name ascending
 */

export const ICON_QUERY_MAX_LENGTH = 100;
export const ICON_SEARCH_DEFAULT_LIMIT = 60;
export const ICON_SEARCH_MAX_LIMIT = 100;

/** Well-known starter icons shown for an empty query without a collection. */
const STARTER_ICONS: readonly { collection: IconCollectionId; name: string }[] = [
  { collection: "simple-icons", name: "github" },
  { collection: "simple-icons", name: "youtube" },
  { collection: "simple-icons", name: "spotify" },
  { collection: "simple-icons", name: "figma" },
  { collection: "lucide", name: "house" },
  { collection: "lucide", name: "search" },
  { collection: "lucide", name: "settings" },
  { collection: "lucide", name: "folder" },
  { collection: "lucide", name: "star" },
  { collection: "tabler", name: "server" },
  { collection: "tabler", name: "home" },
  { collection: "tabler", name: "database" },
  { collection: "tabler", name: "cloud" },
  { collection: "ph", name: "robot" },
  { collection: "ph", name: "envelope" },
  { collection: "ph", name: "camera" },
  { collection: "ph", name: "gear" },
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

const INDEX_CACHE = new Map<IconCollectionId, Promise<IconCollectionIndex>>();

function splitWords(nameLower: string): string[] {
  return nameLower.split(/[^a-z0-9]+/).filter((word) => word.length > 0);
}

async function buildIndex(set: IconSet): Promise<IconCollectionIndex> {
  const byName = new Map<string, IconIndexEntry>();
  function addEntry(name: string, label: string): void {
    if (byName.has(name)) {
      return;
    }
    const nameLower = name.toLowerCase();
    byName.set(name, {
      name,
      label,
      nameLower,
      words: splitWords(nameLower),
    });
  }

  const icons = set.icons ?? {};
  for (const [name, icon] of Object.entries(icons)) {
    if (icon.hidden === true) {
      continue;
    }
    addEntry(name, icon.title ?? name);
  }
  const aliases = set.aliases ?? {};
  for (const [name, alias] of Object.entries(aliases)) {
    if (alias.hidden === true) {
      continue;
    }
    // Alias titles win (they carry the display name); parent titles were
    // already added under the parent's own name.
    addEntry(name, alias.title ?? icons[alias.parent]?.title ?? name);
  }

  const entries = [...byName.values()];
  const browse = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { entries, browse };
}

/** The normalized index for a collection, built at most once per process. */
export function loadCollectionIndex(
  collection: IconCollectionId
): Promise<IconCollectionIndex> {
  let cached = INDEX_CACHE.get(collection);
  if (cached === undefined) {
    cached = loadIconSet(collection).then(buildIndex);
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

function toResult(collection: IconCollectionId, entry: IconIndexEntry): IconSearchResult {
  return {
    id: iconId(collection, entry.name),
    collection,
    name: entry.name,
    label: entry.label,
  };
}

function decodeLimit(value: unknown): number | undefined | "invalid" {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 && value <= ICON_SEARCH_MAX_LIMIT
      ? value
      : "invalid";
  }
  if (typeof value === "string") {
    // Only canonical decimal digits — "060", "1.5" and "abc" are invalid.
    if (!/^[1-9][0-9]*$/.test(value)) {
      return "invalid";
    }
    const parsed = Number(value);
    return parsed >= 1 && parsed <= ICON_SEARCH_MAX_LIMIT ? parsed : "invalid";
  }
  return "invalid";
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

/**
 * Searches (or browses) the bundled catalog.
 *
 * Decodes the raw endpoint query first — a refused shape is reported as an
 * `IconSearchQueryIssue` and never falls through to a partial result:
 * `q` must be a string of at most 100 code points (missing or empty means
 * browse), `limit` must be 1–100 (default 60), `collection` — when present
 * — must be a bundled id. An empty query browses the collection in name
 * order, or the curated starter icons when no collection is given.
 */
export async function searchIconCatalog(
  raw: IconSearchRawQuery
): Promise<IconSearchOutcome> {
  const { q, collection, limit: rawLimit } = raw;

  let query: string[] = [];
  if (q !== undefined) {
    if (typeof q !== "string" || Array.from(q).length > ICON_QUERY_MAX_LENGTH) {
      return { ok: false, issue: "invalid-query" };
    }
    query = normalizeQuery(q);
  }

  const limit = decodeLimit(rawLimit);
  if (limit === "invalid") {
    return { ok: false, issue: "invalid-limit" };
  }
  const effectiveLimit = limit ?? ICON_SEARCH_DEFAULT_LIMIT;

  let collections: readonly IconCollectionId[];
  if (collection === undefined) {
    collections = ICON_COLLECTIONS.map((info) => info.id);
  } else if (typeof collection === "string" && findIconCollection(collection) !== undefined) {
    collections = [collection as IconCollectionId];
  } else {
    return { ok: false, issue: "unknown-collection" };
  }

  if (query.length === 0) {
    // Browse mode: the collection's name-ascending head, or the curated
    // starter set when no collection was chosen.
    if (collections.length === 1) {
      const index = await loadCollectionIndex(collections[0]!);
      return {
        ok: true,
        icons: index.browse.slice(0, effectiveLimit).map((entry) => toResult(collections[0]!, entry)),
      };
    }
    const starters: IconSearchResult[] = [];
    for (const starter of STARTER_ICONS) {
      if (starters.length >= effectiveLimit) {
        break;
      }
      const icon = await resolveIcon(starter.collection, starter.name);
      if (icon !== undefined) {
        starters.push({
          id: iconId(starter.collection, starter.name),
          collection: starter.collection,
          name: starter.name,
          label: starter.name,
        });
      }
    }
    return { ok: true, icons: starters };
  }

  const matches: ScoredMatch[] = [];
  for (const id of collections) {
    const info = findIconCollection(id)!;
    const index = await loadCollectionIndex(id);
    for (const entry of index.entries) {
      const score = bestScore(entry, query);
      if (score !== undefined) {
        matches.push({ entry, collection: id, order: info.order, score });
      }
    }
  }
  matches.sort(compareMatches);
  return {
    ok: true,
    icons: matches.slice(0, effectiveLimit).map((match) => toResult(match.collection, match.entry)),
  };
}
