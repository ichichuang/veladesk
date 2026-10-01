/**
 * The DesktopItem rendered-box measurement contract (tasks 019-B/020-A2):
 * the single sizing authority for the adaptive app content.
 *
 * Pure module — no DOM — so the dedupe rule is unit-testable and shared
 * by every box observer in the item tree.
 */

/** A rendered element box in CSS pixels. */
export interface ElementBox {
  readonly width: number;
  readonly height: number;
}

/**
 * Whether a freshly observed box is a MEANINGFUL change from the current
 * one (020-A2 §19): identical or sub-half-pixel reports never update
 * state, so a ResizeObserver callback cannot re-render every DesktopItem.
 * A null current (no observation yet) is always a change — the first real
 * observation is what resolves the adaptive content layout. The caller
 * filters degenerate (≤0) boxes before this runs. Pure.
 */
export function elementBoxChanged(
  current: ElementBox | null,
  next: ElementBox
): boolean {
  if (current === null) {
    return true;
  }
  return (
    Math.abs(current.width - next.width) >= 0.5 ||
    Math.abs(current.height - next.height) >= 0.5
  );
}
