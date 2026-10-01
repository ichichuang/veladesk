import { beforeEach, describe, expect, it } from "vitest";

import {
  IDLE_SECTION_NAV,
  deriveLayerPhase,
  interactiveActiveIdOf,
  paintableSectionIds,
  pruneMissingSections,
  reportLayerSettled,
  requestSection,
  startPreparedTransition,
  visibleActiveIdOf,
} from "./section-transition-machine";
import type {
  SectionNavMachine,
  SectionRequestInput,
  SectionRequestOutcome,
} from "./section-transition-machine";

const PAGES = ["a", "b", "c", "d", "e", "f"] as const;
const INTENT = { direction: "next" as const };
const PREV_INTENT = { direction: "prev" as const };

function warmIds(order: readonly string[], active: string): string[] {
  const index = order.indexOf(active);
  return order.slice(Math.max(0, index - 1), Math.min(order.length, index + 2));
}

function idleWith(order: readonly string[], active: string): {
  machine: SectionNavMachine;
  mountedIds: string[];
} {
  return { machine: IDLE_SECTION_NAV, mountedIds: warmIds(order, active) };
}

/**
 * Mirrors the shell's request path: the NEXT accepted request carries
 * machine.generation + 1. A parked third target does NOT bump the
 * counter (the shell follows the machine's generation, never the request
 * counter), so the counter below is advanced from the machine itself.
 */
function makeRequester() {
  let generation = 0;
  return (input: Omit<SectionRequestInput, "generation">) => {
    const next = generation + 1;
    const outcome = requestSection({ ...input, generation: next });
    if (outcome !== null) {
      generation =
        outcome.machine.kind === "transition" || outcome.machine.kind === "prepared"
          ? outcome.machine.generation
          : next;
    }
    return outcome;
  };
}

describe("requestSection — warm adjacent switch (020-A2 §29)", () => {
  let requester: ReturnType<typeof makeRequester>;
  beforeEach(() => {
    requester = makeRequester();
  });
  it("starts the transition WITHOUT changing the mounted set", () => {
    // THE central regression contract: no component tree may be created as
    // part of a warm B→C switch.
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const outcome = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    expect(outcome).not.toBeNull();
    expect(outcome!.machine).toEqual({
      kind: "transition",
      generation: 1,
      toId: "c",
      exitingIds: ["b"],
      enterFromOffset: true,
      intent: INTENT,
      pendingId: null,
    });
    expect(outcome!.mountedIds).toBe(mountedIds);
  });

  it("marks a fresh warm entry as entering from the offset", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const outcome = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    expect(outcome.machine.kind === "transition" && outcome.machine.enterFromOffset).toBe(
      true
    );
  });

  it("a reversed re-entry animates from the CURRENT visual position", () => {
    // B→C mid-flight, then the user reverses to B: C becomes the outgoing
    // page, B re-enters — and because B was mid-exit, the transition must
    // tween from wherever it is (enterFromOffset false), never snap it to
    // the offset.
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const second = requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "b",
      intent: PREV_INTENT,
    })!;
    expect(second.machine).toEqual({
      kind: "transition",
      generation: 2,
      toId: "b",
      exitingIds: ["c"],
      enterFromOffset: false,
      intent: PREV_INTENT,
      pendingId: null,
    });
    expect(second.mountedIds).toBe(mountedIds);
  });

  it("parks a third destination as the latest pending target (022 bounded latest-target)", () => {
    // B→C is in flight; A lies outside the visible pair. A third page
    // never joins mid-motion (two painters, never three): the request is
    // PARKED as the latest pending destination while the pair runs to its
    // coherent boundary. The running generation is intentionally NOT
    // superseded — its completion must still settle the pair so the
    // pending request can start.
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const second = requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "a",
      intent: PREV_INTENT,
    })!;
    expect(
      second.machine.kind === "transition" && second.machine.pendingId
    ).toBe("a");
    expect(
      second.machine.kind === "transition" && second.machine.generation
    ).toBe(first.machine.kind === "transition" ? first.machine.generation : -1);
    // Exactly the visible pair still paints: C (entering) + B (exiting) —
    // never A yet.
    expect([...paintableSectionIds(second.machine, "c")]).toEqual(["c", "b"]);
  });

  it("a newer pending destination replaces an older one, and requesting the entered page drops the pending target", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const parkedA = requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "a",
      intent: PREV_INTENT,
    })!;
    const parkedE = requester({
      machine: parkedA.machine,
      mountedIds: parkedA.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "e",
      intent: INTENT,
    })!;
    // Only the LATEST pending destination is kept (bounded, not a queue).
    expect(parkedE.machine.kind === "transition" && parkedE.machine.pendingId).toBe("e");
    // Returning to the page already being entered drops the pending target
    // while the pair keeps its running generation.
    const backToC = requester({
      machine: parkedE.machine,
      mountedIds: parkedE.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "c",
      intent: INTENT,
    })!;
    expect(
      backToC.machine.kind === "transition" && backToC.machine.pendingId
    ).toBeNull();
    expect(
      backToC.machine.kind === "transition" && backToC.machine.generation
    ).toBe(parkedE.machine.kind === "transition" ? parkedE.machine.generation : -1);
  });

  it("a reversal inside the visible pair wins over an older pending destination (022)", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const runningGeneration =
      first.machine.kind === "transition" ? first.machine.generation : -1;
    requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "a",
      intent: PREV_INTENT,
    });
    // Now reverse to the OUTGOING page (B): the pair retargets from its
    // current visual progress and the parked pending target dies with it.
    // The shell assigns the machine's generation + 1 (parking never bumped
    // it), so the reversal carries the next generation.
    const reversal = requestSection({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "b",
      intent: PREV_INTENT,
      generation: runningGeneration + 1,
    })!;
    expect(reversal.machine).toEqual({
      kind: "transition",
      generation: runningGeneration + 1,
      toId: "b",
      exitingIds: ["c"],
      enterFromOffset: false,
      intent: PREV_INTENT,
      pendingId: null,
    });
  });

  it("is a no-op for the currently visible section or an unknown target (idempotent)", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    for (const targetId of ["b", "zz"] as const) {
      expect(
        requester({
          machine,
          mountedIds,
          pageOrder: PAGES,
          currentActiveId: "b",
          targetId,
          intent: INTENT,
        })
      ).toBeNull();
    }
    // Repeated requests for the same effective target DURING its own
    // transition are equally idempotent (visibleActiveIdOf = toId).
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    expect(
      requester({
        machine: first.machine,
        mountedIds: first.mountedIds,
        pageOrder: PAGES,
        currentActiveId: "c",
        targetId: "c",
        intent: INTENT,
      })
    ).toBeNull();
  });
});

describe("requestSection — cold direct jump (020-A2 §16)", () => {
  let requester: ReturnType<typeof makeRequester>;
  beforeEach(() => {
    requester = makeRequester();
  });
  it("mounts the target hidden and PREPARES instead of animating", () => {
    // [A..F], active B (warm [A,B,C]): F is not mounted.
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const outcome = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "f",
      intent: INTENT,
    })!;
    expect(outcome.machine).toEqual({
      kind: "prepared",
      generation: 1,
      toId: "f",
      visibleActiveId: "b",
      intent: INTENT,
    });
    expect([...outcome.mountedIds]).toEqual(["a", "b", "c", "f"]);
    // Preparation paints exactly the still-visible section; the hidden
    // target only measures.
    expect([...paintableSectionIds(outcome.machine, "f")]).toEqual(["b"]);
  });

  it("arms the prepared target into the visible transition", () => {
    const prepared = requester({
      machine: IDLE_SECTION_NAV,
      mountedIds: warmIds(PAGES, "b"),
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "f",
      intent: INTENT,
    })!;
    expect(startPreparedTransition(prepared.machine)).toEqual({
      kind: "transition",
      generation: prepared.machine.kind === "prepared" ? prepared.machine.generation : -1,
      toId: "f",
      exitingIds: ["b"],
      enterFromOffset: true,
      intent: INTENT,
      pendingId: null,
    });
  });

  it("keeps the still-visible section interactive during preparation", () => {
    const prepared = requester({
      machine: IDLE_SECTION_NAV,
      mountedIds: warmIds(PAGES, "b"),
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "f",
      intent: INTENT,
    })!;
    expect(interactiveActiveIdOf(prepared.machine, "f")).toBe("b");
    expect(deriveLayerPhase(prepared.machine, "f", "f")).toBe("warm");
    expect(deriveLayerPhase(prepared.machine, "b", "f")).toBe("active");
  });

  it("replaces a pending preparation when a newer target wins", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "f",
      intent: INTENT,
    })!;
    const second = requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "f",
      targetId: "e",
      intent: PREV_INTENT,
    })!;
    expect(second.machine).toMatchObject({ kind: "prepared", toId: "e" });
    // E is not warm either, so it mounts hidden too; F — the replaced
    // preparation's target — stays mounted until the next rotation prunes
    // it (a hidden leftover, never a visible artifact).
    expect([...second.mountedIds]).toEqual(["a", "b", "c", "f", "e"]);
  });
});

describe("rapid B→C→D with a cold D (020-A2 §15 + 022 pending policy)", () => {
  let requester: ReturnType<typeof makeRequester>;
  beforeEach(() => {
    requester = makeRequester();
  });
  function parkColdDuringMotion() {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    return { first, parked: requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "d",
      intent: INTENT,
    })! };
  }

  it("parks D while the B→C pair keeps running (no third painter, no queue)", () => {
    const { first, parked } = parkColdDuringMotion();
    expect(parked.machine).toEqual({
      kind: "transition",
      generation: 1,
      toId: "c",
      exitingIds: ["b"],
      enterFromOffset: true,
      intent: INTENT,
      pendingId: "d",
    });
    // The mounted set is unchanged by a parked request: D mounts only when
    // the pending request actually starts at the settled boundary.
    expect(parked.mountedIds).toBe(first.mountedIds);
    expect(deriveLayerPhase(parked.machine, "c", "c")).toBe("entering");
    expect(deriveLayerPhase(parked.machine, "b", "c")).toBe("exit");
    expect(deriveLayerPhase(parked.machine, "d", "c")).toBe("warm");
    // At most two painters during motion: C + B.
    expect([...paintableSectionIds(parked.machine, "c")]).toEqual(["c", "b"]);
  });

  it("at settle the parked request starts: D mounts hidden, then arms with the immediate outgoing page", () => {
    const { parked } = parkColdDuringMotion();
    // The pair settles → idle; the shell consumes the pending target.
    const settled = reportLayerSettled(parked.machine, "b", 1);
    expect(settled).toBe(IDLE_SECTION_NAV);

    const cold = requester({
      machine: settled,
      // The warm set around C (D is NOT mounted — the parked request never
      // mounted it).
      mountedIds: ["b", "c"],
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "d",
      intent: INTENT,
    })!;
    expect(cold.machine).toMatchObject({
      kind: "prepared",
      toId: "d",
      visibleActiveId: "c",
    });
    expect([...cold.mountedIds]).toEqual(["b", "c", "d"]);

    const armed = startPreparedTransition(cold.machine);
    expect(armed).toEqual({
      kind: "transition",
      generation: 2,
      toId: "d",
      exitingIds: ["c"],
      enterFromOffset: true,
      intent: INTENT,
      pendingId: null,
    });
    // At most two painters in the armed motion: D (entering) + C (outgoing).
    expect(armed.kind === "transition" && [...armed.exitingIds]).toEqual(["c"]);
    expect(reportLayerSettled(armed, "c", 2)).toBe(IDLE_SECTION_NAV);
  });

  it("never settles from the entering layer's own completion", () => {
    const { parked } = parkColdDuringMotion();
    expect(parked.machine.kind === "transition" && reportLayerSettled(parked.machine, "c", 1)).toBe(
      parked.machine,
    );
  });

  it("ignores a completion report from a SUPERSEDED generation (021-R1)", () => {
    // B→C runs (generation 1); the pair then REVERSES (generation 2). C's
    // old exit report from generation 1 must not settle or rotate the
    // newer request.
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const runningGeneration =
      first.machine.kind === "transition" ? first.machine.generation : -1;
    const reversal = requestSection({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "b",
      intent: PREV_INTENT,
      generation: runningGeneration + 1,
    })!;
    const stale = reportLayerSettled(reversal.machine, "c", runningGeneration);
    expect(stale).toBe(reversal.machine);
  });
});

describe("settle + rotation (020-A2 §13/§14)", () => {
  let requester: ReturnType<typeof makeRequester>;
  beforeEach(() => {
    requester = makeRequester();
  });
  it("idles when the LAST exit completes", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    expect(reportLayerSettled(first.machine, "c", 1)).toBe(first.machine);
    expect(reportLayerSettled(first.machine, "b", 1)).toBe(IDLE_SECTION_NAV);
  });

  it("ignores completion reports for unknown layers", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    expect(reportLayerSettled(first.machine, "zz", 1)).toBe(first.machine);
  });

  it("exactly one page paints at idle, and it is the settled destination (021-R1)", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const settled = reportLayerSettled(first.machine, "b", 1);
    expect(settled).toBe(IDLE_SECTION_NAV);
    expect([...paintableSectionIds(settled, "c")]).toEqual(["c"]);
  });
});

describe("pruneMissingSections — structural reconciliation", () => {
  let requester: ReturnType<typeof makeRequester>;
  beforeEach(() => {
    requester = makeRequester();
  });
  function zigzag() {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    return requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "a",
      intent: PREV_INTENT,
    })!;
  }

  it("deleting the outgoing page settles the machine (it can never report)", () => {
    const zz = zigzag();
    // C (the single outgoing page) is deleted: no exit report can ever
    // arrive, so the machine collapses straight to idle instead of
    // stalling mid-transition.
    const pruned = pruneMissingSections(zz.machine, ["a", "b", "d", "e", "f"]);
    expect(pruned).toBe(IDLE_SECTION_NAV);
  });

  it("keeps the transition when an unrelated page is deleted", () => {
    const zz = zigzag();
    const pruned = pruneMissingSections(zz.machine, ["a", "b", "c", "e", "f"]);
    expect(pruned).toBe(zz.machine);
  });

  it("drops a vanished pending target and keeps the running transition", () => {
    const zz = zigzag(); // transition C←B with pendingId "a"
    // The PENDING page is deleted: the pending target drops (it must never
    // start later), while the running pair survives untouched.
    const pruned = pruneMissingSections(zz.machine, ["b", "c", "d", "e", "f"]);
    expect(pruned.kind === "transition" && pruned.pendingId).toBeNull();
    expect(pruned.kind === "transition" && pruned.toId).toBe("c");
    expect(pruned.kind === "transition" && [...pruned.exitingIds]).toEqual(["b"]);
  });

  it("collapses to idle when the transition target is deleted", () => {
    const zz = zigzag();
    expect(pruneMissingSections(zz.machine, ["a", "b", "d", "e", "f"])).toBe(
      IDLE_SECTION_NAV
    );
  });

  it("collapses a preparation whose target or visible section vanished", () => {
    const prepared = requester({
      machine: IDLE_SECTION_NAV,
      mountedIds: warmIds(PAGES, "b"),
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "f",
      intent: INTENT,
    })!;
    expect(pruneMissingSections(prepared.machine, ["a", "b", "c"])).toBe(IDLE_SECTION_NAV);
  });

  it("idles when the exiting page of a parked-pending transition is deleted (it can never report)", () => {
    // B→C parks D; then B is deleted. B's exit report can never arrive, so
    // the machine collapses to idle instead of stalling.
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const parked = requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "d",
      intent: INTENT,
    })!;
    const pruned = pruneMissingSections(parked.machine, ["a", "c", "d", "e", "f"]);
    expect(pruned).toBe(IDLE_SECTION_NAV);
  });
});

describe("deriveLayerPhase — the layer model (020-A2 §11)", () => {
  let requester: ReturnType<typeof makeRequester>;
  let warm: SectionRequestOutcome;
  beforeEach(() => {
    requester = makeRequester();
    const { machine, mountedIds } = idleWith(PAGES, "b");
    warm = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
  });

  it("shows the entering layer and its exit partner during a transition", () => {
    expect(deriveLayerPhase(warm.machine, "c", "c")).toBe("entering");
    expect(deriveLayerPhase(warm.machine, "b", "c")).toBe("exit");
    expect(deriveLayerPhase(warm.machine, "a", "c")).toBe("warm");
    expect(deriveLayerPhase(warm.machine, "d", "c")).toBe("warm");
  });

  it("rests the interactive section when idle", () => {
    expect(deriveLayerPhase(IDLE_SECTION_NAV, "c", "c")).toBe("active");
    expect(deriveLayerPhase(IDLE_SECTION_NAV, "d", "c")).toBe("warm");
  });

  it("exposes the visible active through the machine, not the raw flag", () => {
    expect(visibleActiveIdOf(warm.machine, "b")).toBe("c");
    expect(visibleActiveIdOf(IDLE_SECTION_NAV, "b")).toBe("b");
    // During a preparation the VISIBLE section stays the interactive one.
    const prepared = requester({
      machine: IDLE_SECTION_NAV,
      mountedIds: warmIds(PAGES, "b"),
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "f",
      intent: INTENT,
    })!;
    expect(visibleActiveIdOf(prepared.machine, "f")).toBe("b");
    expect(interactiveActiveIdOf(prepared.machine, "f")).toBe("b");
  });
});

describe("paintableSectionIds — the 021-R1 visibility invariants", () => {
  let requester: ReturnType<typeof makeRequester>;
  beforeEach(() => {
    requester = makeRequester();
  });
  it("idle paints exactly the settled destination", () => {
    expect([...paintableSectionIds(IDLE_SECTION_NAV, "b")]).toEqual(["b"]);
  });

  it("a transition paints exactly the incoming and the single outgoing page", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const ids = paintableSectionIds(first.machine, "c");
    expect([...ids]).toEqual(["c", "b"]);
    expect(ids.length).toBe(2);
  });

  it("a preparation paints the stable section plus at most one fading exit", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const toC = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    // Interrupt toward the cold E while B→C's exit is in flight.
    const second = requester({
      machine: toC.machine,
      mountedIds: toC.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "e",
      intent: INTENT,
    })!;
    const ids = paintableSectionIds(second.machine, "e");
    expect(ids.length).toBeLessThanOrEqual(2);
    expect(new Set(ids)).toEqual(new Set(["c", "b"]));
  });
});
