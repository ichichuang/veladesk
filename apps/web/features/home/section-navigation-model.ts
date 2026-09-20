import type { DesktopPageId } from "@veladesk/domain";

/**
 * Pure section-order arithmetic for the scroll-snap workspace (task 015).
 *
 * The real scroll position is the source of truth for the active section;
 * these helpers only answer "which section is adjacent" and "which section
 * should be revealed after a deletion" so the shell never re-derives
 * neighbors inline. Ordering always follows the `workspace.pages` array —
 * never DOM order.
 */

/** The id of the section before `pageId`, or null at the first section. */
export function previousSectionId(
  pageIds: readonly DesktopPageId[],
  pageId: DesktopPageId
): DesktopPageId | null {
  const index = pageIds.indexOf(pageId);
  if (index <= 0) {
    return null;
  }
  return pageIds[index - 1] ?? null;
}

/** The id of the section after `pageId`, or null at the last section. */
export function nextSectionId(
  pageIds: readonly DesktopPageId[],
  pageId: DesktopPageId
): DesktopPageId | null {
  const index = pageIds.indexOf(pageId);
  if (index < 0 || index >= pageIds.length - 1) {
    return null;
  }
  return pageIds[index + 1] ?? null;
}

/**
 * The surviving section to reveal after deleting `deletedId`.
 *
 * The next section (at the deleted position) wins so the viewport keeps
 * looking at what follows; at the end of the list the previous section
 * does. Deleting the last surviving section (never legal through the
 * domain) resolves to null.
 */
export function resolveSectionAfterDelete(
  pageIds: readonly DesktopPageId[],
  deletedId: DesktopPageId
): DesktopPageId | null {
  const index = pageIds.indexOf(deletedId);
  if (index < 0) {
    return null;
  }
  return pageIds[index + 1] ?? pageIds[index - 1] ?? null;
}

/** Vertical section navigation direction for a keyboard event key. */
export type SectionNavDirection = "prev" | "next";

/**
 * Which direction a key requests, or null when the key is not a section
 * navigation key. ArrowUp/PageUp go back, ArrowDown/PageDown go forward —
 * the routing is pure so the no-wrap adjacency tests and the shell share
 * one source of truth.
 */
export function sectionNavDirection(key: string): SectionNavDirection | null {
  switch (key) {
    case "ArrowUp":
    case "PageUp":
      return "prev";
    case "ArrowDown":
    case "PageDown":
      return "next";
    default:
      return null;
  }
}
