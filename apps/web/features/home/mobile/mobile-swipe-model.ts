/**
 * The mobile section swipe model (pure — no DOM, no React, no GSAP).
 *
 * A phone launcher lets you flip between categories by dragging sideways.
 * The motion has to feel native, so the decisions that make it feel right
 * are all expressed here as plain data:
 *
 *  - DIRECTION LOCK: the gesture only becomes a horizontal swipe once the
 *    pointer has travelled further sideways than vertically. Until then
 *    the browser keeps the vertical scroll, so a flick up/down inside a
 *    long grid never steals the page.
 *  - RUBBER BAND at the ends when looping is OFF (a single category): the
 *    pane follows the finger at a decaying rate instead of a hard wall.
 *  - INFINITE LOOP when looping is ON: the destination wraps, and the
 *    released pane lands on the equivalent neighbour so the loop has no
 *    seam (last → first / first → last).
 *  - SETTLE: a distance OR velocity threshold decides whether the release
 *    commits to the neighbour or springs back; the spring-back is a
 *    critically-damped projection, not a fixed distance.
 */

/** Pixels of travel before the gesture commits to "horizontal". */
export const SWIPE_LOCK_PX = 10;

/** Fraction of the viewport width a drag must cover to commit. */
export const SWIPE_COMMIT_RATIO = 0.22;

/** …or px/ms of finger velocity (450 px/s), so a quick flick commits without a long drag. */
export const SWIPE_FLICK_VELOCITY = 0.45;

/** Rubber-band resistance at an end (Apple-style: travel / rate). */
export const SWIPE_RUBBER_BAND_RATE = 0.55;

/** Max rubber-band offset as a fraction of the viewport (never a wall). */
export const SWIPE_RUBBER_BAND_MAX_RATIO = 0.28;

export interface SwipeAxisSample {
  readonly x: number;
  readonly y: number;
}

export type SwipePhase =
  /** Nothing has committed yet — the page is free to scroll vertically. */
  | "idle"
  /** Gesture locked to the horizontal axis; the pane follows the finger. */
  | "dragging"
  /** The gesture locked VERTICALLY: this pointer never becomes a swipe. */
  | "scrolling";

/**
 * Direction lock. Returns "horizontal" once the horizontal travel exceeds
 * `SWIPE_LOCK_PX` AND dominates the vertical travel, "vertical" on the
 * mirror condition, and null while still ambiguous — the caller keeps
 * waiting (the browser owns the scroll until then).
 */
export function resolveSwipeAxis(dx: number, dy: number): "horizontal" | "vertical" | null {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < SWIPE_LOCK_PX && absY < SWIPE_LOCK_PX) {
    return null;
  }
  return absX > absY ? "horizontal" : "vertical";
}

/**
 * Where the pane sits for a horizontal drag `dx`, in viewport widths.
 *
 * `offset` is a signed fraction of the viewport, expressed in the SAME
 * space as the strip's transform: 0 = the active page is centred, a
 * NEGATIVE value = the content has slid left (the finger went left, the
 * next page arrives), positive = it has slid right (the previous page
 * arrives). Keeping the drag and the transform on one signed value is
 * what makes the content stay glued to the finger.
 *
 * Looping keeps a 1:1 finger follow for the first viewport — the whole
 * neighbour is reachable — and clamps there, because exactly one neighbour
 * is mounted per side. Without looping the offset is damped at both ends
 * and can never exceed `SWIPE_RUBBER_BAND_MAX_RATIO` viewports, so the
 * content is never dragged off-screen.
 */
export function swipeOffset(viewports: number, looping: boolean): number {
  if (looping) {
    // Only ONE neighbour is mounted on each side, so the drag is clamped to
    // exactly one viewport. Letting it run further would slide the finger
    // past the neighbour onto empty strip — a visible gap at the edge of
    // the loop, exactly where the seam is supposed to be invisible.
    return Math.max(-1, Math.min(1, viewports));
  }
  const damped = damp(viewports);
  const limit = SWIPE_RUBBER_BAND_MAX_RATIO;
  return Math.max(-limit, Math.min(limit, damped));
}

/** The classic iOS rubber-band transfer function. */
function damp(distance: number): number {
  const rate = SWIPE_RUBBER_BAND_RATE;
  const sign = Math.sign(distance);
  return sign * (1 - 1 / ((Math.abs(distance) * rate) / 1 + 1));
}

export interface SwipeReleaseDecision {
  /** -1 = previous page, 0 = stay, +1 = next page. */
  readonly step: -1 | 0 | 1;
  /**
   * True when the release must animate back to the current page (spring
   * back); false when it commits to `step`.
   */
  readonly springBack: boolean;
}

/**
 * The release decision for a committed horizontal drag.
 *
 * Both arguments share ONE sign convention — the strip transform's:
 * NEGATIVE = the content slid left (the finger went left, so the NEXT page
 * is arriving), POSITIVE = the content slid right (the PREVIOUS page).
 * `velocity` is the finger velocity in px/ms, same sign convention.
 *
 * A fast flick along the drag commits even on a short drag; a fast flick
 * back toward the start cancels; otherwise the drag has to cover
 * `SWIPE_COMMIT_RATIO` of the viewport.
 *
 * End handling deliberately lives in `adjacentSectionIndex`, not here:
 * this function cannot see WHICH page is active, so it only answers the
 * binary "commit vs spring back". When the neighbour does not exist the
 * index comes back unchanged and the caller turns that into a spring back.
 */
export function resolveSwipeRelease(input: {
  readonly offset: number;
  readonly velocity: number;
  readonly pageCount: number;
}): SwipeReleaseDecision {
  const { offset, velocity, pageCount } = input;
  if (pageCount <= 1) {
    return { step: 0, springBack: true };
  }

  const flicked = Math.abs(velocity) >= SWIPE_FLICK_VELOCITY;
  const dragged = Math.abs(offset) >= SWIPE_COMMIT_RATIO;
  const direction = Math.sign(offset);
  if (direction === 0) {
    return { step: 0, springBack: true };
  }
  if (flicked) {
    // A flick back toward the start is a change of mind (native pagers
    // cancel too); a flick along the drag commits even on a short drag.
    return Math.sign(velocity) === direction
      ? { step: direction < 0 ? 1 : -1, springBack: false }
      : { step: 0, springBack: true };
  }
  if (!dragged) {
    return { step: 0, springBack: true };
  }
  // Content slid left (negative) → move the page index FORWARD.
  return { step: direction < 0 ? 1 : -1, springBack: false };
}

/**
 * The neighbour index in a direction, wrapping when `looping` — the ONE
 * place the infinite loop exists. Returns `from` unchanged when the move
 * is impossible (single page, or a non-looping end).
 */
export function adjacentSectionIndex(
  from: number,
  step: -1 | 1,
  pageCount: number,
  looping: boolean,
): number {
  if (pageCount <= 1) {
    return from;
  }
  if (looping) {
    return (from + step + pageCount) % pageCount;
  }
  const next = from + step;
  return next < 0 || next >= pageCount ? from : next;
}

/** Where one mounted pane sits relative to the viewport. */
export interface SwipePaneSlot {
  readonly pageId: string;
  /** -1 = previous, 0 = active, +1 = next. */
  readonly slot: -1 | 0 | 1;
  /**
   * Two looping sections: the previous AND the next neighbour are the same
   * page, so it is mounted ONCE (never a duplicate React key / duplicate
   * DOM) and the gesture moves it to whichever side the finger reveals.
   */
  readonly bothSides?: true;
}

/**
 * The panes to mount for the strip, in stable DOM order (previous, active,
 * next). The SAME pane element is reused as the gesture advances, so its
 * content is never remounted mid-swipe:
 *
 *  - looping: the neighbours wrap, so the first page's "previous" is the
 *    last one and vice versa — that is what makes the loop seamless;
 *  - non-looping (or a single page): an unresolvable neighbour is simply
 *    absent, and the strip rubbers back at that end.
 */
export function swipePaneSlots(input: {
  readonly pageIds: readonly string[];
  readonly activePageId: string | null;
  readonly looping: boolean;
}): readonly SwipePaneSlot[] {
  const { pageIds, activePageId, looping } = input;
  if (activePageId === null) {
    return [];
  }
  const index = pageIds.indexOf(activePageId);
  if (index < 0) {
    return [];
  }
  const slots: SwipePaneSlot[] = [];
  const previous = adjacentSectionIndex(index, -1, pageIds.length, looping);
  const next = adjacentSectionIndex(index, 1, pageIds.length, looping);
  // A single page resolves both neighbours to itself — mount it once.
  const shared = previous !== index && previous === next;
  if (previous !== index && !shared) {
    slots.push({ pageId: pageIds[previous]!, slot: -1 });
  }
  slots.push({ pageId: pageIds[index]!, slot: 0 });
  if (shared) {
    slots.push({ pageId: pageIds[next]!, slot: 1, bothSides: true });
  } else if (next !== index) {
    slots.push({ pageId: pageIds[next]!, slot: 1 });
  }
  return slots;
}
