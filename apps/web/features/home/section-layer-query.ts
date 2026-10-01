import type { DesktopPageId } from "@veladesk/domain";

/**
 * Page-scoped DOM lookups inside the section viewport (021-R1).
 *
 * Every mounted section layer renders real content with the same
 * `data-item-id` attributes a drag, a marquee or a scroll-save might look
 * for. A document-wide (or even viewport-wide bare-attribute) lookup can
 * therefore be WON by a warm hidden layer or a mid-flight exit — a hidden
 * cached page must never win a selector lookup, so every shell query is
 * scoped to the one page id it means. Pure: the selectors are unit-tested.
 */

/** The layer wrapper element for one page id. */
export function sectionLayerSelector(pageId: DesktopPageId | null): string | null {
  if (pageId === null) {
    return null;
  }
  return `[data-page-id="${CSS.escape(pageId)}"]`;
}

/** A descendant of one page's layer (`selector` without the leading combinator). */
export function scopedToLayer(pageId: DesktopPageId | null, descendant: string): string | null {
  const layer = sectionLayerSelector(pageId);
  return layer === null ? null : `${layer} ${descendant}`;
}
