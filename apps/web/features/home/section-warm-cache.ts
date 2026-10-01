import type { DesktopPageId } from "@veladesk/domain";

/**
 * The warm-section set (task 020-A2): the sections that stay MOUNTED
 * (hidden but layout-ready) around the active one, so a section switch
 * finds its destination already measured, icon-loaded and adaptive-layout
 * resolved instead of building the whole page tree inside the commit that
 * starts the visible transition.
 *
 * Pure resolver — no DOM, no clocks, no caching of its own. The shell owns
 * the mounted-set state and rotates it ONLY after a transition settles
 * (never inside the animation), per the task's rotation contract.
 */

/**
 * The warm window around `activePageId`: previous, active and next, in
 * `pageOrder` order, deduplicated, never wider than ±1.
 *
 *  - [A], active A          → [A]
 *  - [A,B], active A        → [A,B]
 *  - [A,B,C], active B      → [A,B,C]
 *  - [A,B,C,D], active B    → [A,B,C]
 *  - active C               → [B,C,D]
 *  - unknown active id      → [first page] (deterministic safe fallback;
 *    the shell never feeds one — the active id is derived before render)
 */
export function resolveWarmSectionIds(input: {
  readonly pageOrder: readonly DesktopPageId[];
  readonly activePageId: DesktopPageId | null;
}): DesktopPageId[] {
  const { pageOrder, activePageId } = input;
  if (pageOrder.length === 0) {
    return [];
  }
  const index = activePageId === null ? -1 : pageOrder.indexOf(activePageId);
  if (index < 0) {
    return [pageOrder[0]!];
  }
  const start = Math.max(0, index - 1);
  const end = Math.min(pageOrder.length - 1, index + 1);
  return pageOrder.slice(start, end + 1);
}
