"use client";

import type { RefObject } from "react";
import { useLayoutEffect } from "react";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_DAWN, VD_MOTION_EASES } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";

/**
 * The Dawn opening (P1, motion-spec-p1 §2) — the signature moment, GSAP.
 *
 * Budget: first frame to fully settled ≤ 300ms (VD_MOTION_DAWN.total is
 * the hard ceiling). The shell paints completely and stays interactive
 * throughout — the timeline only drives OVERLAY nodes (the horizon band,
 * the brightness veil) plus a per-tile opacity/y reveal on the tiles'
 * INNER bodies (never the positioned item roots that dnd-kit and FLIP
 * transform) that never blocks pointers. Sequence:
 *
 *   0–180ms  the horizon band rises (scaleY 0→1, y 8→0) while the
 *            full-frame brightness veil fades 0.6→0;
 *   60–280ms the tile layer reveals (opacity 0→1, y 6→0) staggered by
 *            distance from the horizon (12ms per step, ≤ 80ms total);
 *   280–300ms the bright burst fades out and the timeline ends.
 *
 * The tiles are found in the SHELL ROOT that hosts the scene backdrop (the
 * desktop root or the mobile root) — not inside the scene layer, which
 * holds only the wallpaper, the horizon and the ambient drift.
 *
 * Gating: Dawn is an official P1 moment and is ON BY DEFAULT — it is NOT
 * behind `motion.experiments.helmMotion` (that switch gates only the
 * Orbits/Wake prototypes). It plays only over a PRESET scene (the caller
 * passes `enabled = false` for a custom image wallpaper — a photo is its
 * own scene and renders no horizon), and at most once per tab session — a
 * same-session reopen (which covers the spec's 5s quiet window) or a
 * bfcache restore renders statically. Reduced motion never plays it: the
 * scene renders in its final state immediately (the spec's "或直接静态"
 * downgrade).
 *
 * Session bookkeeping (StrictMode-safe): a mount first CLAIMS the opening
 * (an in-flight placeholder — a second shell mounted at the same time is
 * refused while the claim is held). The opening counts as PLAYED only when
 * the timeline completes (naturally, or because input jumped it to
 * `progress(1)`), or when reduced motion settles it statically. A cleanup
 * that kills an unfinished timeline (StrictMode's simulated unmount, a
 * shell swap mid-play) RELEASES the claim without marking it played, so
 * the next mount plays it for real.
 *
 * Interruptible: any pointer (down or over)/keyboard/wheel/touch input
 * during the timeline jumps it to `progress(1)` — the settled state — and
 * ⌘K never waits; a hover lift or press then starts on a clean node.
 * Both the settle and the cleanup paths clear every GSAP property the
 * timeline wrote (`clearProps`), so a killed intro can never leave a tile
 * hidden or hold a transform that a drag or FLIP would fight.
 */

/** Module-scoped session memory — survives bfcache restores with the tab. */
let dawnOpeningPlayed = false;
/** The in-flight claim (one mount at a time may be playing the opening). */
let dawnOpeningClaim: symbol | null = null;

/**
 * Claims the opening for one mount: returns a claim token, or null when it
 * must render statically (a bfcache restore, already played this session,
 * or another mount is playing it right now). Exported for tests.
 */
export function claimDawnOpening(navigationType: string): symbol | null {
  if (navigationType === "back_forward") {
    // bfcache restore: static per spec §2.
    return null;
  }
  if (dawnOpeningPlayed || dawnOpeningClaim !== null) {
    return null;
  }
  dawnOpeningClaim = Symbol("dawn-opening");
  return dawnOpeningClaim;
}

/** The claimed opening reached its end state: it has PLAYED this session. */
export function completeDawnOpening(claim: symbol): void {
  if (dawnOpeningClaim === claim) {
    dawnOpeningClaim = null;
    dawnOpeningPlayed = true;
  }
}

/**
 * The claimed opening was killed before its end: release the placeholder
 * WITHOUT marking it played. A no-op after completion (the claim is gone)
 * or for a stale token — release and the played flag never fight.
 */
export function releaseDawnOpening(claim: symbol): void {
  if (dawnOpeningClaim === claim) {
    dawnOpeningClaim = null;
  }
}

/** The tile bodies an opening timeline is driving right now. */
const dawnRevealTargets = new WeakSet<Element>();

/**
 * Whether the Dawn opening currently owns this element's opacity/transform
 * (its tile reveal is in flight). Other first-paint entrances skip such
 * tiles so two tweens never fight over the same inline styles.
 */
export function isDawnRevealTarget(element: Element): boolean {
  return dawnRevealTargets.has(element);
}

/**
 * Whether an opening timeline is playing RIGHT NOW (a claim is held). False
 * under reduced motion (settled at once), over a custom wallpaper (never
 * claimed) and once the tab has played it. Ancestor layout effects of the
 * shell (the workspace stage entrance) can read it in the same commit: a
 * child's layout effect — the Dawn claim — always runs first.
 */
export function isDawnOpeningPlaying(): boolean {
  return dawnOpeningClaim !== null;
}

/** Whether the opening has played this tab session (tests and callers). */
export function hasDawnOpeningPlayed(): boolean {
  return dawnOpeningPlayed;
}

/** Resets the session memory (tests only). */
export function resetDawnOpeningSessionForTests(): void {
  dawnOpeningPlayed = false;
  dawnOpeningClaim = null;
}

/**
 * Marks the opening as already played this session (tests only): suites
 * that audit OTHER GSAP timelines (section navigation, restore) mount the
 * shell without the default-on Dawn timeline joining the global timeline.
 */
export function markDawnOpeningPlayedForTests(): void {
  dawnOpeningPlayed = true;
  dawnOpeningClaim = null;
}

/** The navigation type of this document, or "navigate" when unknown. */
function currentNavigationType(): string {
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry instanceof PerformanceNavigationTiming ? entry.type : "navigate";
  } catch {
    return "navigate";
  }
}

interface IntroTargets {
  readonly scope: RefObject<HTMLElement | null>;
  readonly band: RefObject<HTMLElement | null>;
  readonly veil: RefObject<HTMLElement | null>;
}

/** The tile bodies the reveal drives: desktop item bodies, mobile tiles. */
const INTRO_TILE_SELECTOR = ".vela-item__body, .vela-mobile-tile__button";

/**
 * The shell root hosting the scene layer — where the tiles live. The scene
 * backdrop renders as a direct child of the desktop / mobile root.
 */
function introTileRoot(scene: HTMLElement): HTMLElement {
  return (
    scene.closest<HTMLElement>(".vela-desktop, [data-vd-mobile-shell]") ??
    scene.parentElement ??
    scene
  );
}

/** A tile's grid cell from its slot's inline `grid-row`/`grid-column`. */
function gridCellOf(tile: HTMLElement): { readonly row: number; readonly column: number } | null {
  const slot = tile.closest<HTMLElement>(".vela-item-slot");
  if (slot === null) {
    return null;
  }
  const row = Number.parseInt(slot.style.getPropertyValue("grid-row") || slot.style.gridRowStart, 10);
  const column = Number.parseInt(
    slot.style.getPropertyValue("grid-column") || slot.style.gridColumnStart,
    10,
  );
  return Number.isFinite(row) && Number.isFinite(column) ? { row, column } : null;
}

/**
 * Orders the reveal from the horizon (bottom of the frame first): by the
 * measured top (descending), ties by left (ascending). When the boxes are
 * not usable — every tile has a zero box, or every top is identical (the
 * first frame before the grid measured) — it falls back to the tiles'
 * GRID CELLS (row descending, column ascending; tiles without a cell keep
 * reverse DOM order after them). Stable for equal keys. Exported for tests.
 */
export function orderIntroTiles(tiles: readonly HTMLElement[]): readonly HTMLElement[] {
  const boxes = tiles.map((element, index) => ({
    element,
    index,
    rect: element.getBoundingClientRect(),
  }));
  const allZero = boxes.every(({ rect }) => rect.width <= 0 || rect.height <= 0);
  const allSameTop = boxes.length > 1 && boxes.every(({ rect }) => rect.top === boxes[0]!.rect.top);
  if (!allZero && !allSameTop) {
    return [...boxes]
      .sort((a, b) => b.rect.top - a.rect.top || a.rect.left - b.rect.left || a.index - b.index)
      .map(({ element }) => element);
  }
  const cells = boxes.map((box) => ({ ...box, cell: gridCellOf(box.element) }));
  return cells
    .sort((a, b) => {
      if (a.cell !== null && b.cell !== null) {
        return b.cell.row - a.cell.row || a.cell.column - b.cell.column || a.index - b.index;
      }
      if (a.cell !== null) return -1;
      if (b.cell !== null) return 1;
      // No layout data at all (e.g. the mobile derived grid): reverse DOM
      // order — the reading order's last row is nearest the horizon.
      return b.index - a.index;
    })
    .map(({ element }) => element);
}

/**
 * Collects the rendered tile BODIES inside the shell root, ordered from
 * the horizon ({@link orderIntroTiles}). Warm/inert/hidden layers (mobile
 * neighbour panes, the departing section) and unrendered (`display:
 * none`) nodes never join the reveal. Exported for tests.
 */
export function collectIntroTiles(scene: HTMLElement): readonly HTMLElement[] {
  const root = introTileRoot(scene);
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(INTRO_TILE_SELECTOR));
  const rendered = candidates.filter(
    (element) =>
      element.closest("[data-warm-hidden='true'], [inert], [aria-hidden='true']") === null &&
      element.getClientRects().length > 0,
  );
  return orderIntroTiles(rendered);
}

export interface UseDawnIntroInput extends IntroTargets {
  /**
   * The PRESET-SCENE gate: true over a preset scene, false over a custom
   * image wallpaper (a photo is its own scene). It is NOT the helmMotion
   * experiment switch — Dawn is on by default. False renders the static
   * scene; reduced motion is checked separately inside the hook.
   */
  readonly enabled: boolean;
}

export function useDawnIntro(input: UseDawnIntroInput): void {
  const { enabled, scope, band, veil } = input;
  const reducedMotion = useVdReducedMotion();

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    const scopeElement = scope.current;
    const bandElement = band.current;
    const veilElement = veil.current;
    if (scopeElement === null || bandElement === null || veilElement === null) {
      return;
    }
    const claim = claimDawnOpening(currentNavigationType());
    if (claim === null) {
      return;
    }
    if (reducedMotion) {
      // Reduced motion: the static final state IS the opening, settled.
      completeDawnOpening(claim);
      return;
    }

    const tiles = collectIntroTiles(scopeElement);
    const burstElement = bandElement.querySelector<HTMLElement>(".vela-dawn-horizon__burst");
    for (const tile of tiles) {
      dawnRevealTargets.add(tile);
    }
    const clearIntroProps = () => {
      for (const tile of tiles) {
        dawnRevealTargets.delete(tile);
      }
      gsap.set([bandElement, veilElement, ...tiles], { clearProps: "opacity,transform" });
      if (burstElement !== null) {
        gsap.set(burstElement, { clearProps: "opacity" });
      }
    };
    // Interruptibility (spec §2): any real input settles the timeline at
    // once. `pointerover` counts (a hover must find the tile settled before
    // the hover lift starts) and so does `pointerdown` (the mobile tile's
    // press). The listeners sit in the WINDOW CAPTURE phase, so they run
    // before React's root-delegated handlers for the SAME event: the
    // opening jumps to progress(1) and clears its props FIRST, then the
    // hover/press motion starts on a clean node. They detach the moment the
    // opening settles, so a later hover is never touched by Dawn.
    const interruptEvents: readonly (keyof WindowEventMap)[] = [
      "pointerdown",
      "pointerover",
      "keydown",
      "wheel",
      "touchstart",
    ];
    let listening = false;
    const detachInterrupts = () => {
      if (!listening) {
        return;
      }
      listening = false;
      for (const event of interruptEvents) {
        window.removeEventListener(event, settle, { capture: true } as EventListenerOptions);
      }
    };
    const timeline = gsap.timeline({
      // settle: the timeline dies with its inline styles cleared — the CSS
      // rest state (band in place, veil/burst at opacity 0, tiles visible)
      // IS the end state, so a late kill can never leave a ghost veil. An
      // input jump to progress(1) lands here too: it counts as played.
      onComplete: () => {
        detachInterrupts();
        clearIntroProps();
        completeDawnOpening(claim);
      },
    });
    function settle() {
      timeline.progress(1);
    }

    // 0–180ms: the band rises from the waterline; the veil recedes.
    timeline.fromTo(
      bandElement,
      { scaleY: 0, y: 8 },
      { scaleY: 1, y: 0, duration: VD_MOTION_DAWN.horizon, ease: VD_MOTION_EASES.standard },
      0,
    );
    timeline.fromTo(
      veilElement,
      { opacity: 0.6 },
      { opacity: 0, duration: VD_MOTION_DAWN.horizon, ease: VD_MOTION_EASES.standard },
      0,
    );

    // 60–280ms: tile reveal, staggered from the horizon. Every tween is
    // END-ALIGNED at revealStart + reveal so the whole layer settles inside
    // the total budget no matter how deep the field is (per-tile duration
    // shrinks by the stagger step; the spread stays ≤ staggerCap).
    // `immediateRender` hides each tile from the very first frame, so a
    // staggered tile never flashes visible before its slot.
    if (tiles.length > 0) {
      const maxDelay = VD_MOTION_DAWN.staggerCap - VD_MOTION_DAWN.stagger;
      for (const [index, tile] of tiles.entries()) {
        const delay = Math.min(index * VD_MOTION_DAWN.stagger, maxDelay);
        timeline.fromTo(
          tile,
          { opacity: 0, y: 6 },
          {
            opacity: 1,
            y: 0,
            duration: VD_MOTION_DAWN.reveal - delay,
            ease: VD_MOTION_EASES.standard,
            immediateRender: true,
          },
          VD_MOTION_DAWN.revealStart + delay,
        );
      }
    }

    // The burst lights with the band and dies in the closing tail
    // (settle → total), easing out with the exit curve.
    if (burstElement !== null) {
      const burstFadeStart = VD_MOTION_DAWN.revealStart + VD_MOTION_DAWN.reveal;
      timeline.set(burstElement, { opacity: 1 }, 0);
      timeline.to(
        burstElement,
        {
          opacity: 0,
          duration: VD_MOTION_DAWN.total - burstFadeStart,
          ease: VD_MOTION_EASES.exit,
        },
        burstFadeStart,
      );
    }

    timeline.play();

    listening = true;
    for (const event of interruptEvents) {
      window.addEventListener(event, settle, { capture: true, passive: true });
    }
    return () => {
      detachInterrupts();
      timeline.kill();
      clearIntroProps();
      // Killed before its end (StrictMode, a mid-play unmount): NOT played.
      // After a completion the claim is already gone and this is a no-op.
      releaseDawnOpening(claim);
    };
    // The intro is a mount moment: it must never restart on re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-scoped by design; ref contents and the guards are stable within a mount
  }, [enabled, reducedMotion]);
}
