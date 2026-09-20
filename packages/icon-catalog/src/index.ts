/**
 * Public API of @veladesk/icon-catalog.
 *
 * Server-side pure data only — no React, no DOM, no Next, no database.
 * Explicit named exports only, mirroring the other VelaDesk packages.
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
  ICON_SEARCH_MAX_LIMIT,
  iconId,
  loadCollectionIndex,
  searchIconCatalog,
} from "./search";

export { renderIconSvg } from "./svg";

export type {
  IconCollectionId,
  IconSearchOutcome,
  IconSearchQueryIssue,
  IconSearchRawQuery,
  IconSearchResult,
  IconSet,
} from "./types";
