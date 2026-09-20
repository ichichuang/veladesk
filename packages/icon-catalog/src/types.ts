/**
 * Contracts of the bundled icon catalog.
 *
 * The catalog is server-side pure data: it reads the nine IconifyJSON
 * collections shipped in `node_modules` and never talks to the network.
 * Icon identity matches the domain's `AppIcon { kind: "iconify" }` exactly:
 * the string form `<prefix>:<name>`.
 */

/** A bundled icon collection. Prefix equals the Iconify prefix. */
export type IconCollectionId =
  | "simple-icons"
  | "lucide"
  | "tabler"
  | "ph"
  | "fluent-color"
  | "devicon"
  | "vscode-icons"
  | "catppuccin"
  | "noto";

/**
 * How a collection's glyphs carry color. Monochrome bodies draw with
 * `currentColor` and are rendered through a CSS mask (the app's foreground
 * color applies); multicolor bodies ship their own pigments and must be
 * rendered as an image so those colors survive.
 */
export type IconPalette = "monochrome" | "multicolor";

/** The browsing bucket a collection belongs to. */
export type IconCategory = "brand" | "general" | "development" | "emoji";

/** The picker's top-level scopes: three facets plus per-category views. */
export type IconSearchScope =
  | "recommended"
  | "all"
  | "color"
  | "brand"
  | "general"
  | "development"
  | "emoji";

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

/**
 * One searchable icon result. `id` is the persisted `AppIcon.icon` value;
 * `category`/`palette` come from the collection metadata so a client never
 * has to guess how to render the glyph.
 */
export interface IconSearchResult {
  readonly id: string;
  readonly collection: IconCollectionId;
  readonly name: string;
  readonly label: string;
  readonly category: IconCategory;
  readonly palette: IconPalette;
}

/** Raw query parameters of the search endpoint, as received over HTTP. */
export interface IconSearchRawQuery {
  readonly q?: unknown;
  readonly scope?: unknown;
  readonly collection?: unknown;
  readonly offset?: unknown;
  readonly limit?: unknown;
}

/** Why a search request was refused before any icon lookup. */
export type IconSearchQueryIssue =
  | "invalid-query"
  | "invalid-scope"
  | "invalid-offset"
  | "invalid-limit"
  | "unknown-collection";

export type IconSearchOutcome =
  | {
      readonly ok: true;
      /** The requested page of the fully ordered result list. */
      readonly icons: readonly IconSearchResult[];
      /** The complete filtered match count (independent of the page). */
      readonly total: number;
      /** The offset of the next page, or null on the last page. */
      readonly nextOffset: number | null;
    }
  | {
      readonly ok: false;
      readonly issue: IconSearchQueryIssue;
    };
