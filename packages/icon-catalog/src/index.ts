/**
 * Public API of @veladesk/icon-catalog.
 *
 * Server-side pure data only — no React, no DOM, no Next, no database.
 * Explicit named exports only, mirroring the other VelaDesk packages.
 *
 * A browser client must import the metadata subpath
 * (`@veladesk/icon-catalog/meta`) instead of this entry point: this module
 * pulls in `@iconify/utils` and the collection loaders, none of which
 * belong in a client bundle.
 */

export {
  ICON_COLLECTIONS,
  findIconCollection,
  isIconCollectionId,
  loadIconSet,
} from "./collections";
export type { IconCollectionInfo } from "./collections";

export {
  ICON_QUERY_MAX_LENGTH,
  ICON_SEARCH_DEFAULT_LIMIT,
  ICON_SEARCH_DEFAULT_SCOPE,
  ICON_SEARCH_MAX_LIMIT,
  iconId,
  loadCollectionIndex,
  loadCollectionLabels,
  searchIconCatalog,
} from "./search";

export { renderIconSvg } from "./svg";

export type {
  IconCategory,
  IconCollectionId,
  IconPalette,
  IconSearchOutcome,
  IconSearchQueryIssue,
  IconSearchRawQuery,
  IconSearchResult,
  IconSearchScope,
  IconSet,
} from "./types";
