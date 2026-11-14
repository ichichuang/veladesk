/**
 * Engineering-mode entry gesture (t181): the hidden 7-rapid-click unlock.
 *
 * Pure, DOM-observable logic — the provider mounts the listener, this
 * module decides what counts. Entry targets are the BRAND/TITLE areas
 * (marked `data-vd-eng-entry`) and the EMPTY DESKTOP BACKGROUND — never
 * an app tile, never an interactive control (a tap that could open an
 * app must never contribute to the unlock train).
 */

/** Rapid-click window: each click must land this close to the previous one. */
export const ENGINEERING_ENTRY_WINDOW_MS = 400;

/** Clicks/taps needed to open the unlock dialog. */
export const ENGINEERING_ENTRY_CLICKS = 7;

/**
 * Interactive/overlay selectors whose clicks never count: buttons, links,
 * fields, ARIA widgets, the dock, the pill, tiles, chrome and anything
 * inside an overlay portal (dialogs, menus, sheets, the launcher).
 */
const EXCLUDED_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='menuitem']",
  "[contenteditable='true']",
  "[data-vd-portal-root]",
  "[data-vd-native-context-menu='true']",
  ".vela-item",
  ".vela-dock",
  ".vela-pill",
  ".vela-launcher",
  ".vela-marquee",
  ".vela-arrange-bar",
  ".vela-mobile-tile",
  ".vela-mobile-dock",
  ".vela-mobile-category-tabs",
  ".vela-mobile-search",
  ".vela-mobile-sheet",
].join(", ");

/** Desktop + mobile empty-background containers (scroll surfaces + workbench). */
const BACKGROUND_SELECTOR = [
  ".vela-workbench",
  ".vela-section-viewport",
  ".vela-section-scroller",
  ".vela-grid-frame",
  ".vela-grid-stage",
  ".vela-mobile-shell__content",
].join(", ");

/**
 * Whether one click's target qualifies as an Engineering-mode entry click.
 * The target must be (or live inside) a `data-vd-eng-entry` brand/title
 * area, or be non-interactive background inside a desktop content surface.
 */
export function isEngineeringEntryTarget(target: Element): boolean {
  if (target.closest("[data-vd-eng-entry]") !== null) {
    return true;
  }
  if (target.closest(EXCLUDED_SELECTOR) !== null) {
    return false;
  }
  return target.closest(BACKGROUND_SELECTOR) !== null;
}

/** The unlock train's state (kept between clicks by the listener). */
export interface EngineeringClickTrain {
  count: number;
  lastClickMs: number;
}

/**
 * Feeds one click into the train; returns the next state (and whether the
 * unlock threshold was just reached — the caller opens the dialog and the
 * train resets). A non-qualifying click RESETS the train: the sequence is
 * seven deliberate consecutive taps, not a sum scattered across a
 * browsing session.
 */
export function feedEngineeringClickTrain(
  state: EngineeringClickTrain,
  qualifies: boolean,
  nowMs: number,
): { readonly state: EngineeringClickTrain; readonly unlocked: boolean } {
  if (!qualifies) {
    return { state: { count: 0, lastClickMs: 0 }, unlocked: false };
  }
  const withinWindow =
    state.count === 0 || nowMs - state.lastClickMs <= ENGINEERING_ENTRY_WINDOW_MS;
  const count = withinWindow ? state.count + 1 : 1;
  if (count >= ENGINEERING_ENTRY_CLICKS) {
    return { state: { count: 0, lastClickMs: 0 }, unlocked: true };
  }
  return { state: { count, lastClickMs: nowMs }, unlocked: false };
}
