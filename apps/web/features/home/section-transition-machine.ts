import type { DesktopPageId } from "@veladesk/domain";

import { resolveWarmSectionIds } from "./section-warm-cache";

/**
 * The section-navigation state model (task 020-A2 §11/§15): a small,
 * explicit machine separating MOUNTED section content from the VISIBLE
 * transition state, so a switch between two already-warm sections starts
 * its animation without building a single new component (§29 — the
 * central regression contract).
 *
 * Pure state math — no DOM, no timers, no queues. The latest target always
 * wins: a new request replaces the in-flight one instead of lining up
 * behind it. The shell applies exactly ONE post-commit lifecycle step
 * (arming a prepared cold target after its hidden commit has painted,
 * §16) and rotates the mounted warm set ONLY when the machine settles
 * back to idle — never during a visible transition (§13/§14).
 */

export type SectionNavDirection = "next" | "prev";

/**
 * Visual phase of one mounted section layer.
 *
 *  - `warm`     — mounted, hidden (visibility:hidden), layout-ready;
 *  - `entering` — the visible transition partner, animating to rest;
 *  - `active`   — the interactive, resting section;
 *  - `exit`     — visible, animating out; turns `warm` (or unmounts) when
 *                 the machine settles.
 */
export type SectionLayerPhase = "warm" | "entering" | "active" | "exit";

/** Direction of the whole-page transition (022: travel is measured live). */
export interface SectionNavIntent {
  readonly direction: SectionNavDirection;
}

/**
 * A cold destination (outside the warm set) is mounted HIDDEN first — one
 * real layout frame in which its ResizeObservers and adaptive layout
 * settle (§16) — and armed into the visible transition afterwards.
 * (022: a third destination during motion parks as `pendingId` on the
 * running transition instead of preparing, so a preparation is only ever
 * requested from idle or from another preparation — it never carries a
 * superseded exit.) The caller assigns the monotonically increasing
 * `generation` so completion reports from a superseded gesture can never
 * settle the newer one.
 */
export interface SectionPrepareState {
  readonly kind: "prepared";
  readonly generation: number;
  readonly toId: DesktopPageId;
  readonly visibleActiveId: DesktopPageId;
  readonly intent: SectionNavIntent;
}

/**
 * The visible transition: `toId` animates in while the ONE page in
 * `exitingIds` animates out (021-R1: interruptions collapse older exits —
 * during motion exactly two pages may paint: the incoming participant and
 * its immediate outgoing partner). `enterFromOffset` marks a FRESH entry —
 * the layer was hidden (warm or newly mounted), so its enter animation
 * must supply the entry offset as an explicit first keyframe. A RE-ENTRY
 * (a mid-flight exit retargeted back to active) animates from its current
 * visual position instead — keyframes would snap it.
 *
 * `pendingId` is the bounded latest-third-target policy (022): a request
 * for a page OUTSIDE the visible pair during motion is parked here — the
 * pair keeps running to its coherent boundary, only the LATEST pending
 * destination is kept, and the shell starts it immediately at settle. A
 * reversal inside the visible pair takes precedence: it clears any older
 * pending target.
 */
export interface SectionTransitionState {
  readonly kind: "transition";
  readonly generation: number;
  readonly toId: DesktopPageId;
  readonly exitingIds: readonly DesktopPageId[];
  readonly enterFromOffset: boolean;
  readonly intent: SectionNavIntent;
  readonly pendingId: DesktopPageId | null;
}

export type SectionNavMachine =
  | { readonly kind: "idle" }
  | SectionPrepareState
  | SectionTransitionState;

export const IDLE_SECTION_NAV: SectionNavMachine = { kind: "idle" };

/** The section the user can currently SEE as active. */
export function visibleActiveIdOf(
  machine: SectionNavMachine,
  fallback: DesktopPageId | null
): DesktopPageId | null {
  if (machine.kind === "transition") {
    return machine.toId;
  }
  if (machine.kind === "prepared") {
    return machine.visibleActiveId;
  }
  return fallback;
}

/**
 * The section that owns the INTERACTIVE surface this frame (measurement
 * refs, gestures, selection). While a cold target is prepared (mounted
 * but hidden), the still-visible section stays interactive.
 */
export function interactiveActiveIdOf(
  machine: SectionNavMachine,
  activePageId: DesktopPageId | null
): DesktopPageId | null {
  return machine.kind === "prepared" ? machine.visibleActiveId : activePageId;
}

/** The visual phase of one mounted layer, derived — never stored per layer. */
export function deriveLayerPhase(
  machine: SectionNavMachine,
  pageId: DesktopPageId,
  activePageId: DesktopPageId | null
): SectionLayerPhase {
  if (machine.kind === "transition") {
    if (pageId === machine.toId) {
      return "entering";
    }
    if (machine.exitingIds.includes(pageId)) {
      return "exit";
    }
  } else if (machine.kind === "prepared") {
    if (pageId === machine.toId) {
      // The cold target is mounted hidden — never visible until armed.
      return "warm";
    }
  }
  return pageId === interactiveActiveIdOf(machine, activePageId) ? "active" : "warm";
}

export interface SectionRequestInput {
  readonly machine: SectionNavMachine;
  readonly mountedIds: readonly DesktopPageId[];
  readonly pageOrder: readonly DesktopPageId[];
  /** The logical active section before this request (the machine's fallback). */
  readonly currentActiveId: DesktopPageId | null;
  readonly targetId: DesktopPageId;
  readonly intent: SectionNavIntent;
  /**
   * The caller's monotonically increasing request counter (021-R1). Every
   * accepted request carries it; completion reports must match it to count.
   */
  readonly generation: number;
}

export interface SectionRequestOutcome {
  readonly machine: SectionNavMachine;
  readonly mountedIds: readonly DesktopPageId[];
}

/**
 * One section-switch request. Returns null for a no-op (the target is the
 * currently visible section, or unknown — repeated requests for the same
 * effective target are idempotent). A warm target starts the transition
 * with the mounted set UNCHANGED (§29); a cold target first mounts hidden
 * (`prepared`) — the visible transition comes one layout frame later (§16,
 * scheduled by the shell AFTER the mount frame).
 *
 * 021-R1 exit collapse: a superseded transition's older exit flags die
 * here. During motion exactly one outgoing page may paint (the immediate
 * predecessor); a hidden cached page must never join a new transition
 * merely because it still carried an old exit flag.
 */
export function requestSection(input: SectionRequestInput): SectionRequestOutcome | null {
  const { machine, mountedIds, pageOrder, currentActiveId, targetId, intent, generation } = input;
  const visibleActive = visibleActiveIdOf(machine, currentActiveId);
  if (!pageOrder.includes(targetId)) {
    return null;
  }

  if (machine.kind === "transition") {
    if (targetId === machine.toId) {
      // Back to the page already being entered: drop any stale pending
      // target; the running pair is exactly right already.
      if (machine.pendingId === null) {
        return null;
      }
      return { machine: { ...machine, pendingId: null }, mountedIds };
    }
    if (!machine.exitingIds.includes(targetId)) {
      // THIRD DESTINATION during motion: keep the visible pair running to
      // its coherent boundary; park the request as the latest pending
      // target (a newer pending replaces an older one). The running
      // generation is intentionally NOT superseded — its completion must
      // still settle the pair so the pending request can start.
      if (machine.pendingId === targetId) {
        return null;
      }
      return { machine: { ...machine, pendingId: targetId }, mountedIds };
    }
    // REVERSAL inside the visible pair (target is the outgoing page): the
    // pair retargets from current visual progress and any older pending
    // destination dies with it — a reversal always wins. Falls through to
    // the warm-switch path below.
  } else if (targetId === visibleActive) {
    return null;
  }

  if (mountedIds.includes(targetId)) {
    // Warm switch: ONLY the immediate outgoing page animates out — older
    // exit flags collapse (their layers settle to hidden), and —
    // THE MOUNTED SET NEVER CHANGES.
    const exitingIds: DesktopPageId[] = [];
    if (visibleActive !== null && visibleActive !== targetId) {
      exitingIds.push(visibleActive);
    }
    const enterFromOffset =
      machine.kind !== "transition" ||
      (machine.toId !== targetId && !machine.exitingIds.includes(targetId));
    return {
      machine: {
        kind: "transition",
        generation,
        toId: targetId,
        exitingIds,
        enterFromOffset,
        intent,
        pendingId: null,
      },
      mountedIds,
    };
  }

  // Cold destination: mount it hidden first; the visible section stays.
  return {
    machine: {
      kind: "prepared",
      generation,
      toId: targetId,
      visibleActiveId: visibleActive ?? targetId,
      intent,
    },
    mountedIds: [...mountedIds, targetId],
  };
}

/**
 * The prepared cold target's hidden layout frame has elapsed (its observers
 * and adaptive layout had their preparation frame — the shell schedules the
 * arm for the frame after the mount commit) — start the visible transition.
 * The exit set is the immediate outgoing page only (021-R1 collapse).
 */
export function startPreparedTransition(machine: SectionNavMachine): SectionNavMachine {
  if (machine.kind !== "prepared") {
    return machine;
  }
  const exitingIds: DesktopPageId[] = [machine.visibleActiveId];
  return {
    kind: "transition",
    generation: machine.generation,
    toId: machine.toId,
    exitingIds,
    enterFromOffset: true,
    intent: machine.intent,
    pendingId: null,
  };
}

/**
 * The pair finished its visible animation (022: ONE coordinator completion
 * per transition). Only completions of the CURRENT generation drive the
 * machine. A report from a superseded generation (an old animation's late
 * callback) or an unknown layer is ignored — it can never settle or cancel
 * the newer request. Empty exit set → idle; the shell then rotates the
 * warm set (§13) and consumes any parked pending destination.
 */
export function reportLayerSettled(
  machine: SectionNavMachine,
  pageId: DesktopPageId,
  generation: number,
) {
  if (
    machine.kind !== "transition" ||
    machine.generation !== generation ||
    !machine.exitingIds.includes(pageId)
  ) {
    return machine;
  }
  const exitingIds = machine.exitingIds.filter((id) => id !== pageId);
  if (exitingIds.length === 0) {
    return IDLE_SECTION_NAV;
  }
  return { ...machine, exitingIds };
}

/**
 * The pages that may PAINT under a machine state (021-R1 visibility
 * invariants, derived — never independent booleans):
 *
 *  - idle:        exactly the settled destination;
 *  - transition:  exactly the incoming participant and its (single)
 *                 outgoing partner;
 *  - prepared:    the still-visible section only (022: the hidden target
 *                 measures; no exit can be parked on a preparation).
 *
 * Every page NOT in this set is warm-hidden (nonpainted, inert). The
 * invariant tests assert the set's size, not per-layer booleans.
 */
export function paintableSectionIds(
  machine: SectionNavMachine,
  activePageId: DesktopPageId | null
): readonly DesktopPageId[] {
  const interactive = interactiveActiveIdOf(machine, activePageId);
  if (machine.kind === "transition") {
    return [...new Set([machine.toId, ...machine.exitingIds])];
  }
  if (machine.kind === "prepared") {
    return interactive === null ? [] : [interactive];
  }
  return interactive === null ? [] : [interactive];
}

/**
 * Structural reconciliation: a page deleted mid-flight can never complete
 * its animation, so its exit report would never come. Drop vanished pages
 * from the machine; a transition or preparation whose target vanished
 * collapses to idle. Generations survive pruning (the request itself is
 * still the live one).
 */
export function pruneMissingSections(
  machine: SectionNavMachine,
  pageOrder: readonly DesktopPageId[]
): SectionNavMachine {
  if (machine.kind === "idle") {
    return machine;
  }
  const exists = (id: DesktopPageId) => pageOrder.includes(id);
  if (machine.kind === "prepared") {
    if (!exists(machine.toId) || !exists(machine.visibleActiveId)) {
      return IDLE_SECTION_NAV;
    }
    return machine;
  }
  if (!exists(machine.toId)) {
    return IDLE_SECTION_NAV;
  }
  let changed = false;
  let pendingId = machine.pendingId;
  if (pendingId !== null && !exists(pendingId)) {
    pendingId = null;
    changed = true;
  }
  const exitingIds = machine.exitingIds.filter(exists);
  if (exitingIds.length === machine.exitingIds.length && !changed) {
    return machine;
  }
  return exitingIds.length === 0
    ? IDLE_SECTION_NAV
    : { ...machine, exitingIds, pendingId };
}

/**
 * The warm-set rotation for one settled transition (§13): applied by the
 * shell ONLY when the machine reaches idle — it may mount the new neighbor
 * and evict the far one, never during a visible transition.
 */
export function settledWarmSet(
  pageOrder: readonly DesktopPageId[],
  activePageId: DesktopPageId | null
): DesktopPageId[] {
  return resolveWarmSectionIds({ pageOrder, activePageId });
}
