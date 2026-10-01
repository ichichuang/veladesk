"use client";

import { useCallback, useEffect, useState } from "react";

import type { DesktopPageId } from "@veladesk/domain";

/**
 * The mobile section transition coordinator (task 026-R2 §7–§11): a
 * MINIMAL two-phase prepared-target machine — deliberately NOT the
 * desktop's warm-±1 cache / pair coordinator / section machine.
 *
 * tap B (logical destination recorded IMMEDIATELY — persistence and tab
 * state never wait for the visual phase):
 *
 *   idle(A) ──request B──▶ preparing(A visible, B hidden-mounted)
 *            ──layout-ready + one frame──▶ entering(B)   [A retires]
 *            ──entrance completes──▶ idle(B)
 *
 * Invariants:
 *  - At most TWO panes ever mount (visible + one pending); the desktop's
 *    warm set does not exist here.
 *  - Rapid switching is LATEST-TARGET-WINS: a preparing page that is
 *    superseded before arming is dropped without ever becoming visible;
 *    a request during an entrance makes the entering page the new visible
 *    base — never a third painter.
 *  - Requesting the current destination is an exact no-op (same object →
 *    no re-render, no tween restart, no extra persistence write).
 *  - A pending page is hidden with visibility/inert/pointer-events — never
 *    display:none, so its layout, styles and image decodes prepare.
 */

export type MobileSectionTransition =
  | { readonly phase: "idle"; readonly pageId: DesktopPageId | null }
  | { readonly phase: "preparing"; readonly visibleId: DesktopPageId | null; readonly targetId: DesktopPageId }
  | { readonly phase: "entering"; readonly targetId: DesktopPageId };

export function idleMobileSection(pageId: DesktopPageId | null): MobileSectionTransition {
  return { phase: "idle", pageId };
}

/** The LOGICAL destination — what persistence and the tabs follow. */
export function logicalDestinationOf(machine: MobileSectionTransition): DesktopPageId | null {
  return machine.phase === "idle" ? machine.pageId : machine.targetId;
}

/** The page whose pane is the visible content layer right now. */
export function visibleMobilePageId(machine: MobileSectionTransition): DesktopPageId | null {
  switch (machine.phase) {
    case "idle":
      return machine.pageId;
    case "preparing":
      return machine.visibleId;
    case "entering":
      return machine.targetId;
  }
}

/** The hidden-mounted incoming page; null outside the preparing phase. */
export function pendingMobilePageId(machine: MobileSectionTransition): DesktopPageId | null {
  return machine.phase === "preparing" ? machine.targetId : null;
}

export function requestMobileSection(
  machine: MobileSectionTransition,
  targetId: DesktopPageId,
): MobileSectionTransition {
  if (targetId === logicalDestinationOf(machine)) {
    return machine; // §11: same command — exact no-op.
  }
  switch (machine.phase) {
    case "idle":
      return { phase: "preparing", visibleId: machine.pageId, targetId };
    case "preparing":
      // Retarget before arming: the old pending page never becomes visible.
      return { phase: "preparing", visibleId: machine.visibleId, targetId };
    case "entering":
      // The entering page becomes the visible base; never a third painter.
      return { phase: "preparing", visibleId: machine.targetId, targetId };
  }
}

/** Layout-ready boundary: the pending page arms and the visible page retires. */
export function armMobileSection(machine: MobileSectionTransition): MobileSectionTransition {
  return machine.phase === "preparing"
    ? { phase: "entering", targetId: machine.targetId }
    : machine;
}

/** Entrance completion: exactly the target remains. A stale call is a no-op. */
export function settleMobileSection(machine: MobileSectionTransition): MobileSectionTransition {
  return machine.phase === "entering" ? idleMobileSection(machine.targetId) : machine;
}

/**
 * The React binding. The machine FOLLOWS the logical active section (the
 * shared owner above the shell switch) through a render-phase adjustment
 * (the derived-state pattern — never a setState-in-effect), and arms the
 * prepared page one animation frame after its hidden mount: the rAF runs
 * after the browser's layout pass for that commit, so the heavy mount work
 * lands on a frame that paints no new content, and the entrance starts
 * from a settled tree. Reduced motion bypasses the preparing phase
 * entirely — an instant logical-and-visual swap with no added delay (§33).
 */
export function useMobileSectionTransition(
  activePageId: DesktopPageId | null,
  options: { readonly reducedMotion: boolean },
): {
  readonly machine: MobileSectionTransition;
  readonly settle: () => void;
} {
  const [machine, setMachine] = useState<MobileSectionTransition>(() =>
    idleMobileSection(activePageId),
  );

  if (activePageId !== null && activePageId !== logicalDestinationOf(machine)) {
    // The logical destination moved. (A same-value request never reaches
    // here — the shared owner already no-ops it — so this only fires on a
    // genuine destination change.)
    setMachine(
      options.reducedMotion
        ? idleMobileSection(activePageId)
        : requestMobileSection(machine, activePageId),
    );
  }

  const preparingTarget = machine.phase === "preparing" ? machine.targetId : null;
  useEffect(() => {
    if (preparingTarget === null) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      setMachine((current) => armMobileSection(current));
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [preparingTarget]);

  const settle = useCallback(() => {
    setMachine((current) => settleMobileSection(current));
  }, []);

  return { machine, settle };
}
