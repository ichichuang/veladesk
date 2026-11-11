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
 * The snapshot of the pair the coordinator was animating when a request
 * superseded it into a preparation (t81). The pair's own timeline keeps
 * running untouched while the cold target mounts hidden — its pages are
 * still visibly mid-flight, so their phases must stay `exit`/visible and
 * the armed transition must adopt them as its exit train. `generation` is
 * the pair's own: restoring the pair (a cancelled preparation) must keep
 * it, so its in-flight completion still settles it.
 */
export interface SupersededPair {
  readonly toId: DesktopPageId;
  readonly exitingIds: readonly DesktopPageId[];
  readonly intent: SectionNavIntent;
  readonly generation: number;
}

/**
 * A cold destination (outside the warm set) is mounted HIDDEN first — one
 * real layout frame in which its ResizeObservers and adaptive layout
 * settle (§16) — and armed into the visible transition afterwards.
 *
 * t81: a request for a cold destination DURING motion prepares it right
 * away instead of parking it — rapid paging (the pill's wheel, one detent
 * = one step) must engage each step at the input rhythm, never wait out
 * the running pair. The superseded pair rides along as `inherited` so the
 * armed transition continues its exit train (and a cancelled preparation
 * restores the still-running pair exactly). The caller assigns the
 * monotonically increasing `generation` so completion reports from a
 * superseded gesture can never settle the newer one.
 */
export interface SectionPrepareState {
  readonly kind: "prepared";
  readonly generation: number;
  readonly toId: DesktopPageId;
  readonly visibleActiveId: DesktopPageId;
  readonly intent: SectionNavIntent;
  /** The pair still animating when this preparation began (t81), or null. */
  readonly inherited: SupersededPair | null;
}

/**
 * The visible transition: `toId` animates in while the pages in
 * `exitingIds` animate out on one shared timeline. `enterFromOffset`
 * marks a FRESH entry — the layer was hidden (warm or newly mounted), so
 * its enter animation must supply the entry offset as an explicit first
 * keyframe. A RE-ENTRY (a mid-flight exit retargeted back to active)
 * animates from its current visual position instead — keyframes would
 * snap it.
 *
 * 021-R1 interruptions collapse older exits — during motion the incoming
 * participant and its outgoing partner(s) paint. t81 widens the exit set
 * to a TRAIN: a superseded transition's still-gliding pages join the new
 * timeline (same direction only — a flip collapses them, they would
 * otherwise sweep back across the incoming page), bounded by the mounted
 * warm set.
 */
export interface SectionTransitionState {
  readonly kind: "transition";
  readonly generation: number;
  readonly toId: DesktopPageId;
  readonly exitingIds: readonly DesktopPageId[];
  readonly enterFromOffset: boolean;
  readonly intent: SectionNavIntent;
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
    // The superseded pair's exits are STILL visibly mid-flight (t81): they
    // keep painting (and their poses) until the armed transition adopts
    // them — hiding them here would pop pages off the screen for the
    // preparation frame.
    if (machine.inherited !== null && machine.inherited.exitingIds.includes(pageId)) {
      return "exit";
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
 * The LATEST target always engages immediately (t81): during motion a warm
 * third destination interrupts the running pair (its still-gliding pages
 * join the exit train), and a cold one prepares right away, inheriting the
 * running pair so the armed transition continues its exits. A reversal
 * inside the visible pair still wins over everything.
 *
 * 021-R1 exit collapse otherwise: a superseded pair's older exit flags die
 * here — a hidden cached page must never join a new transition merely
 * because it still carried an old exit flag. (The t81 train is the
 * deliberate exception: those pages are still visibly mid-flight. It stays
 * bounded — reversal and direction-flip requests collapse it, and it can
 * never exceed the mounted warm set.)
 */
export function requestSection(input: SectionRequestInput): SectionRequestOutcome | null {
  const { machine, mountedIds, pageOrder, currentActiveId, targetId, intent, generation } = input;
  const visibleActive = visibleActiveIdOf(machine, currentActiveId);
  if (!pageOrder.includes(targetId)) {
    return null;
  }

  // The pair the coordinator is animating RIGHT NOW (t81): a transition is
  // its own pair; a preparation inherited the pair it superseded.
  const pair: SupersededPair | null =
    machine.kind === "transition"
      ? {
          toId: machine.toId,
          exitingIds: machine.exitingIds,
          intent: machine.intent,
          generation: machine.generation,
        }
      : machine.kind === "prepared" && machine.inherited !== null
        ? machine.inherited
        : null;

  if (pair !== null) {
    if (targetId === pair.toId) {
      // Back to the page already being entered: the running pair is
      // exactly right already. For a preparation this CANCELS it — the
      // machine returns to the still-running pair (its own generation, so
      // its in-flight completion still settles it) and the hidden target
      // stays mounted as plain warm cache until the next rotation.
      if (machine.kind === "prepared") {
        return {
          machine: {
            kind: "transition",
            generation: pair.generation,
            toId: pair.toId,
            exitingIds: pair.exitingIds,
            enterFromOffset: false,
            intent: pair.intent,
          },
          mountedIds,
        };
      }
      return null;
    }
    if (!pair.exitingIds.includes(targetId)) {
      if (mountedIds.includes(targetId)) {
        // WARM third destination (t81): INTERRUPT now. Rapid paging (the
        // pill's wheel, one detent = one step) must engage each step the
        // moment it is requested — waiting out the running pair would land
        // steps ~300ms apart and swallow the intermediate destinations. The
        // entering page joins the EXIT TRAIN: same-direction exits keep
        // gliding out on the new shared timeline (a conveyor), while a
        // direction flip collapses the older exits (the reversal policy —
        // they would otherwise sweep back across the incoming page).
        const train: DesktopPageId[] =
          intent.direction === pair.intent.direction
            ? [pair.toId, ...pair.exitingIds]
            : [pair.toId];
        return {
          machine: {
            kind: "transition",
            generation,
            toId: targetId,
            exitingIds: train,
            enterFromOffset: true,
            intent,
          },
          mountedIds,
        };
      }
      // COLD third destination (t81): PREPARE now — mount it hidden while
      // the running pair keeps gliding, inheriting the pair so the armed
      // transition continues its exits from their live poses. (022's
      // parking policy is gone: it traded ~300ms of latency per chained
      // step for at most one saved mount, and the settle-time adoption
      // skipped every intermediate destination.)
      return {
        machine: {
          kind: "prepared",
          generation,
          toId: targetId,
          visibleActiveId: visibleActive ?? pair.toId,
          intent,
          inherited: pair,
        },
        mountedIds: [...mountedIds, targetId],
      };
    }
    // REVERSAL inside the visible pair (target is the outgoing page): the
    // pair retargets from current visual progress — a reversal always
    // wins. Falls through to the warm-switch path below.
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
      pair === null || (pair.toId !== targetId && !pair.exitingIds.includes(targetId));
    return {
      machine: {
        kind: "transition",
        generation,
        toId: targetId,
        exitingIds,
        enterFromOffset,
        intent,
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
      inherited: null,
    },
    mountedIds: [...mountedIds, targetId],
  };
}

/**
 * The prepared cold target's hidden layout frame has elapsed (its observers
 * and adaptive layout had their preparation frame — the shell schedules the
 * arm for the frame after the mount commit) — start the visible transition.
 * The exit set is the immediate outgoing page plus, when this preparation
 * superseded a same-direction pair, its still-gliding exits (the t81 train;
 * a direction flip collapses them).
 */
export function startPreparedTransition(machine: SectionNavMachine): SectionNavMachine {
  if (machine.kind !== "prepared") {
    return machine;
  }
  const inherited = machine.inherited;
  const train: DesktopPageId[] =
    inherited !== null && inherited.intent.direction === machine.intent.direction
      ? [machine.visibleActiveId, ...inherited.exitingIds]
      : [machine.visibleActiveId];
  return {
    kind: "transition",
    generation: machine.generation,
    toId: machine.toId,
    exitingIds: [...new Set(train)],
    enterFromOffset: true,
    intent: machine.intent,
  };
}

/**
 * The pair finished its visible animation (022: ONE shared playhead per
 * transition — t81 trains report every exit through the same completion).
 * Only completions of the CURRENT generation drive the machine. A report
 * from a superseded generation (an old animation's late callback) or an
 * unknown layer is ignored — it can never settle or cancel the newer
 * request. Empty exit set → idle; the shell then rotates the warm set (§13).
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
 *  - transition:  the incoming participant and its outgoing partner(s) —
 *                 after a t81 interruption, a TRAIN of exits (each
 *                 still-gliding page from the superseded transitions),
 *                 bounded by the mounted warm set;
 *  - prepared:    the still-visible section plus, when the preparation
 *                 superseded a running pair (t81), that pair's exits —
 *                 they are visibly mid-flight until the armed transition
 *                 adopts them. The hidden target itself never paints.
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
    const inheritedExits = machine.inherited?.exitingIds ?? [];
    return [...new Set([...(interactive === null ? [] : [interactive]), ...inheritedExits])];
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
    const inherited =
      machine.inherited === null
        ? null
        : {
            ...machine.inherited,
            exitingIds: machine.inherited.exitingIds.filter(exists),
          };
    if (
      machine.inherited !== null &&
      inherited !== null &&
      inherited.exitingIds.length === machine.inherited.exitingIds.length
    ) {
      return machine;
    }
    return { ...machine, inherited };
  }
  if (!exists(machine.toId)) {
    return IDLE_SECTION_NAV;
  }
  const exitingIds = machine.exitingIds.filter(exists);
  if (exitingIds.length === machine.exitingIds.length) {
    return machine;
  }
  return exitingIds.length === 0 ? IDLE_SECTION_NAV : { ...machine, exitingIds };
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
