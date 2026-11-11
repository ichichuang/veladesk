"use client";

import type { DesktopPageId } from "@veladesk/domain";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";
import type { SectionNavDirection } from "./section-transition-machine";

/**
 * The section page-pair animation coordinator (task 022, GSAP).
 *
 * ONE GSAP timeline owns the visible page pair for the whole category
 * transition: the outgoing and incoming page layers are tweens at timeline
 * position 0, so they share one playhead — they start together, are always
 * at complementary viewport positions, and settle together. Independent
 * layer callbacks CANNOT finalize navigation while the other page still
 * moves: there is exactly one completion, for the pair.
 *
 * The choreography (t61) is a REAL HORIZONTAL page slide over the measured
 * section viewport width W (never content width): on a fresh next-page
 * command the outgoing layer travels x 0 → −W while the incoming travels
 * x +W → 0 (signs reverse for previous) — the grid slides in FROM the
 * direction the user travelled, matching the pill's highlight and the
 * arrow keys. Page-wrapper opacity stays at 1 throughout — the viewport
 * clips each page's own viewport-sized content, so the two visible
 * regions meet at a moving boundary instead of one page showing through
 * the other.
 *
 * Interruption policy (bounded latest-target, machine-driven):
 *  - A REVERSAL inside the visible pair (the machine flips toId/exitingIds
 *    with enterFromOffset=false) kills the old timeline and retargets both
 *    layers FROM THEIR CURRENT x — gsap.kill() keeps the interrupted pose,
 *    and the new tweens read it as their origin. The entry pose is never
 *    reset, and the entry offset is only ever applied on a FRESH entry
 *    (enterFromOffset=true, via fromTo with immediateRender — the entry
 *    pose is committed inside the layout phase, before the next paint).
 *  - A third destination never reaches this coordinator mid-motion: the
 *    machine parks it as `pendingId` while the visible pair runs to its
 *    coherent boundary; the shell starts the pending request right at
 *    settle (no added delay).
 *  - Identical commands (an unrelated React rerender carrying the same
 *    generation) are skipped — the live playhead survives.
 *  - Every completion is generation-guarded; dispose/instant-settle paths
 *    invalidate the running timeline so a stale completion can never
 *    settle a newer navigation.
 *
 * The frame path is narrow by construction: the timeline's onUpdate does
 * nothing but write transforms (GSAP's job), and completion does nothing
 * but report to the shell — no layout reads, React dispatches, workspace
 * projection, persistence or drag registration ride the animation.
 */

export interface SectionPairCommand {
  /** The navigation generation this command belongs to. */
  readonly generation: number;
  readonly incomingId: DesktopPageId;
  readonly outgoingId: DesktopPageId;
  readonly direction: SectionNavDirection;
  /**
   * Fresh entry: the incoming layer was hidden — start it from the full
   * entry offset. False means a reversal: continue from current poses.
   */
  readonly enterFromOffset: boolean;
  /** The MEASURED section viewport width in px (at command time). */
  readonly viewportWidth: number;
}

/** Reports the pair's settle to the shell (current generation only). */
export type SectionPairSettledListener = (
  outgoingId: DesktopPageId,
  generation: number,
) => void;

export interface SectionPairCoordinator {
  /** Layers register their wrapper elements on mount (null on detach). */
  readonly registerLayer: (pageId: DesktopPageId, element: HTMLElement | null) => void;
  /** The registered element for a page, when the layer is mounted. */
  readonly layerElement: (pageId: DesktopPageId) => HTMLElement | null;
  /** Applies one command; identical generations while running are no-ops. */
  readonly apply: (command: SectionPairCommand, onSettled: SectionPairSettledListener) => void;
  /**
   * Kills the running timeline WITHOUT writing any style: for the shell's
   * instant paths (instant swap, reduced motion, pruning), which retire the
   * animation NOW but must leave every layer pose untouched until the idle
   * commit has flipped the exited page's phase to warm-hidden — resting a
   * still-visible layer here would paint it at the viewport origin.
   */
  readonly halt: () => void;
  /** Instant settle of every registered layer (idle/reduced/teardown). */
  readonly settleAll: () => void;
  /** True while a pair timeline owns the viewport (observability/tests). */
  readonly isTransitioning: () => boolean;
  /**
   * The live pair timeline, when one is running — the tests' deterministic
   * playhead seam (advance it, never real time). Null at rest.
   */
  readonly currentTimeline: () => gsap.core.Timeline | null;
  readonly dispose: () => void;
}

function restLayer(element: HTMLElement): void {
  // Same GSAP owner writes the resting pose (its transform cache stays
  // consistent for the next transition's origins).
  gsap.set(element, { x: 0, opacity: 1 });
}

export function createSectionPairCoordinator(): SectionPairCoordinator {
  const layers = new Map<DesktopPageId, HTMLElement>();
  let timeline: gsap.core.Timeline | null = null;
  let runningGeneration = 0;
  let disposed = false;

  function killRunning(): void {
    if (timeline !== null) {
      timeline.kill();
      timeline = null;
    }
  }

  return {
    registerLayer(pageId, element) {
      if (disposed) {
        return;
      }
      if (element === null) {
        layers.delete(pageId);
        return;
      }
      layers.set(pageId, element);
    },

    layerElement(pageId) {
      return layers.get(pageId) ?? null;
    },

    apply(command, onSettled) {
      if (disposed) {
        return;
      }
      // SAME-COMMAND SKIP: an unrelated shell rerender re-applies the same
      // generation while the pair timeline is live — the playhead survives.
      if (timeline !== null && command.generation === runningGeneration) {        return;
      }

      const incoming = layers.get(command.incomingId);
      const outgoing = layers.get(command.outgoingId);
      if (incoming === undefined || outgoing === undefined) {
        // The pair is not (fully) mounted: nothing to animate; the shell's
        // render already shows the right phases for this generation.
        return;
      }

      killRunning();
      // Layers that are no longer participants must not keep a mid-flight
      // pose (the old superseded exit snaps to rest hidden — the same
      // collapse policy the navigation machine has always applied).
      for (const [pageId, element] of layers) {
        if (pageId !== command.incomingId && pageId !== command.outgoingId) {
          restLayer(element);
        }
      }

      runningGeneration = command.generation;
      // t61: the desktop pair slide is horizontal on its own 300ms token
      // (the mobile swipe keeps the legacy sectionPage pace).
      const duration = vdMotionDuration("sectionPageDesktop");
      const ease = VD_MOTION_EASE;
      const entryX = command.direction === "next" ? command.viewportWidth : -command.viewportWidth;
      const exitX = command.direction === "next" ? -command.viewportWidth : command.viewportWidth;

      const pair = gsap.timeline({
        onComplete: () => {
          timeline = null;          // Final poses are the tweens' end values; the shell settles the
          // machine (and rests the layers) from here.
          onSettled(command.outgoingId, command.generation);
        },
      });
      if (command.enterFromOffset) {
        // Fresh entry: explicit first keyframe, rendered synchronously at
        // construction (inside the caller's layout phase — pre-paint).
        pair.fromTo(incoming, { x: entryX }, { x: 0, duration, ease }, 0);
      } else {
        pair.to(incoming, { x: 0, duration, ease }, 0);
      }
      pair.to(outgoing, { x: exitX, duration, ease }, 0);
      timeline = pair;
    },

    halt() {
      killRunning();
    },

    settleAll() {
      killRunning();
      for (const element of layers.values()) {
        restLayer(element);
      }
    },

    isTransitioning() {
      return timeline !== null;
    },

    currentTimeline() {
      return timeline;
    },

    dispose() {
      disposed = true;
      killRunning();
      layers.clear();
    },
  };
}
