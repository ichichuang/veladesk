/**
 * Contracts of the bundled icon catalog.
 *
 * The catalog is server-side pure data: it reads the four IconifyJSON
 * collections shipped in `node_modules` and never talks to the network.
 * Icon identity matches the domain's `AppIcon { kind: "iconify" }` exactly:
 * the string form `<prefix>:<name>`.
 */

/** A bundled icon collection. Prefix equals the Iconify prefix. */
export type IconCollectionId = "simple-icons" | "lucide" | "tabler" | "ph";

/**
 * The structural slice of an IconifyJSON icon this catalog reads. Bodies
 * are trusted bundled data (pinned `@iconify-json/*` packages), never user
 * input, and are only ever rendered through `@iconify/utils` — never
 * assembled into markup by string concatenation.
 */
export interface IconSetEntry {
  readonly body: string;
  readonly title?: string;
  readonly hidden?: boolean;
}

/** Alias entries resolve to a parent icon by name (no body of their own). */
export interface IconSetAlias {
  readonly parent: string;
  readonly title?: string;
  readonly hidden?: boolean;
}

/**
 * Structural shape of a bundled `@iconify-json` collection file (the
 * `icons.json` module each package exports). Only the members the catalog
 * consumes are declared — the full IconifyJSON contract stays internal to
 * the `@iconify` packages.
 */
export interface IconSet {
  readonly prefix?: string;
  readonly icons: Readonly<Record<string, IconSetEntry>>;
  readonly aliases?: Readonly<Record<string, IconSetAlias>>;
}

/** One searchable icon result. `id` is the persisted `AppIcon.icon` value. */
export interface IconSearchResult {
  readonly id: string;
  readonly collection: IconCollectionId;
  readonly name: string;
  readonly label: string;
}

/** Raw query parameters of the search endpoint, as received over HTTP. */
export interface IconSearchRawQuery {
  readonly q?: unknown;
  readonly collection?: unknown;
  readonly limit?: unknown;
}

/** Why a search request was refused before any icon lookup. */
export type IconSearchQueryIssue =
  | "invalid-query"
  | "invalid-limit"
  | "unknown-collection";

export type IconSearchOutcome =
  | {
      readonly ok: true;
      readonly icons: readonly IconSearchResult[];
    }
  | {
      readonly ok: false;
      readonly issue: IconSearchQueryIssue;
    };
