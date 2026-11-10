import type { DragDropManager } from "@dnd-kit/react";
import { animate } from "motion/react";

import { GRID_FLIP_TRANSITION } from "../canvas/grid-flip-slot";
import { vdPrefersReducedMotion } from "@components/vd/reduced-motion";

/**
 * The drop settle (Helm r3) — installed on the manager's Feedback plugin
 * through the official `dropAnimation` FUNCTION hook of @dnd-kit/dom 0.5.
 *
 * What it replaces: the plugin's DEFAULT 250ms ease, which animates the
 * still-fixed drag element BACK TOWARD ITS PRE-DRAG CELL at release — the
 * "tile flies home first, then jumps to the drop target" artifact. What a
 * plain `dropAnimation: null` would leave: the fixed element is cleaned up
 * synchronously, BEFORE React commits the drop's new geometry, so a paint
 * between the two shows the tile snapped back at its OLD cell for one
 * frame — the same bounce, minus the glide.
 *
 * The function form runs at exactly the right moment — after the manager's
 * renderer promise resolves (React has COMMITTED the optimistic handoff
 * geometry) while the element is STILL the fixed drag layer resting at its
 * release position. It captures the release box, lets the plugin's cleanup
 * continuation un-fix the element into its committed cell, then — one
 * microtask later, before the browser can paint the un-fixed tile — FLIPs
 * any remaining gap with the shared flip spring.
 *
 * The gap is usually ZERO: the drag preview already parks the tile's body
 * on its resolved (snapped/continuous) position, which is exactly where
 * the commit lands it — a normal drop transfers ownership with no visible
 * motion at all. The glide carries the cases where release ≠ target:
 * CANCELED and no-op drops (back onto the unchanged cell), and
 * edge-clamped drags (the rubber-band from the raw pointer position to
 * the clamped target). Reduced motion never animates: the tile simply
 * rests where it committed.
 */
export function installDndDropSettle(manager: DragDropManager): void {
  for (const plugin of manager.plugins) {
    // The Feedback plugin is the only default plugin with an `overlay`
    // reactive accessor on its prototype. Its `dropAnimation` field is
    // DECLARED but never initialized in @dnd-kit/dom 0.5, so a plain
    // `"dropAnimation" in plugin` guard never matches — the property must
    // be ASSIGNED (creating the own property the drop effect reads).
    const proto = Object.getPrototypeOf(plugin) ?? Object.prototype;
    if (Object.getOwnPropertyDescriptor(proto, "overlay") !== undefined) {
      (plugin as { dropAnimation?: unknown }).dropAnimation = releaseSettleDropAnimation;
    }
  }
}

/** The dnd-kit dropAnimation contract subset the settle consumes. */
interface DropAnimationInput {
  /** The drag source element — still the fixed drag layer at call time. */
  readonly element: Element;
}

/**
 * The drag source's release VISUAL box, recorded at dragend BEFORE any
 * teardown: the button rides dnd-kit's RAW pointer delta while the snap
 * correction (`--vd-canvas-drag-preview`) lands on the inner
 * `.vela-item__body`, so the BODY is the position the user was actually
 * looking at — and by the time the plugin's drop animation runs, the
 * correction var may already be cleared by the post-commit layout effect.
 * One slot: a new drag overwrites the previous drop's snapshot.
 */
let releaseSnapshot: { readonly element: Element; readonly x: number; readonly y: number } | null =
  null;

/** Records the drag source's visual release box (see {@link releaseSnapshot}). */
export function recordDragReleaseBox(element: Element): void {
  const visual = element.querySelector(":scope > .vela-item__body") ?? element;
  const rect = visual.getBoundingClientRect();
  releaseSnapshot = { element, x: rect.x, y: rect.y };
}

/**
 * The VISUAL box of a dragging tile (snapshot fallback): the button rides
 * dnd-kit's RAW pointer delta; the snap-corrected `.vela-item__body` is
 * what the user sees and what the settle must start from.
 */
function visualBoxOf(element: Element): DOMRect {
  const body = element.querySelector(":scope > .vela-item__body");
  return (body ?? element).getBoundingClientRect();
}

function releaseSettleDropAnimation(input: DropAnimationInput): Promise<void> {
  const element = input.element;
  if (!(element instanceof HTMLElement) || vdPrefersReducedMotion()) {
    return Promise.resolve();
  }
  const snapshot = releaseSnapshot;
  releaseSnapshot = null;
  const release =
    snapshot !== null && snapshot.element === element
      ? { x: snapshot.x, y: snapshot.y }
      : visualBoxOf(element);
  const done = Promise.resolve();
  // Two thens on `done`: the plugin's own cleanup continuation is queued
  // between them (it registers its .then after this function returns), so
  // the FLIP measures the element only once it is back in flow — in the
  // same microtask drain, before the browser can paint the un-fixed tile.
  void done
    .then(() => undefined)
    .then(() => {
      const settled = element.getBoundingClientRect();
      const deltaX = release.x - settled.x;
      const deltaY = release.y - settled.y;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        return;
      }
      element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      // Explicit keyframes: the spring must run from the JUST-MEASURED
      // release offset, never from Motion's re-parse of the element's
      // current transform (which races this very write).
      void Promise.resolve(
        animate(element, { x: [deltaX, 0], y: [deltaY, 0] }, GRID_FLIP_TRANSITION),
      ).then(() => {
        element.style.transform = "";
      });
    });
  return done;
}
