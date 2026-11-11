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
 * machine.generation + 1 — the counter always follows the machine's own
 * generation, never the raw request count (a CANCELLED preparation t81
 * restores the still-running pair's generation, so the counter can even
 * step back).
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
    });
    expect(second.mountedIds).toBe(mountedIds);
  });

  it("a WARM third destination interrupts: the entering page joins the exit train (t81)", () => {
    // B→C is in flight; A is warm-mounted but outside the visible pair.
    // Rapid paging (the pill's wheel, one detent = one step) must engage
    // each step the moment it is requested: the pair retargets NOW — C
    // (still entering) and B (still exiting) continue OUT on the new
    // shared timeline as an exit train, and A enters from the offset.
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
      mountedIds: first.mountedIds, // warm(b) = [a, b, c] — A is mounted
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "a",
      intent: INTENT, // same direction: the older exits join the train
    })!;
    expect(second.machine).toEqual({
      kind: "transition",
      generation: 2,
      toId: "a",
      exitingIds: ["c", "b"],
      enterFromOffset: true,
      intent: INTENT,
    });
    expect(second.mountedIds).toBe(first.mountedIds);
    // The train's pages all paint until the new pair settles (bounded by
    // the mounted warm set — three here).
    expect([...paintableSectionIds(second.machine, "c")]).toEqual(["a", "c", "b"]);
  });

  it("a direction-flipping warm third destination collapses the older exits (t81)", () => {
    // Same shape, but the request reverses the travel direction: the
    // older exits would sweep back ACROSS the incoming page, so the
    // reversal collapse applies — only the entering page becomes the
    // outgoing one.
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
    expect(second.machine).toEqual({
      kind: "transition",
      generation: 2,
      toId: "a",
      exitingIds: ["c"],
      enterFromOffset: true,
      intent: PREV_INTENT,
    });
  });

  it("prepares a COLD third destination immediately, inheriting the running pair (t81)", () => {
    // B→C is in flight; E is outside the visible pair AND cold. Rapid
    // paging must engage at the input rhythm, so the target mounts HIDDEN
    // right away (one preparation frame) while the pair keeps gliding —
    // the armed transition then continues the pair's exits from their
    // live poses. The running pair is snapshotted as `inherited`.
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
      mountedIds: first.mountedIds, // warm(b) = [a, b, c] — E is cold
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "e",
      intent: INTENT,
    })!;
    expect(second.machine).toEqual({
      kind: "prepared",
      generation: 2,
      toId: "e",
      visibleActiveId: "c",
      intent: INTENT,
      inherited: { toId: "c", exitingIds: ["b"], intent: INTENT, generation: 1 },
    });
    expect([...second.mountedIds]).toEqual(["a", "b", "c", "e"]);
    // The pair keeps painting exactly as before (C visible/active, B still
    // exiting mid-flight); the hidden target only measures.
    expect(deriveLayerPhase(second.machine, "c", "c")).toBe("active");
    expect(deriveLayerPhase(second.machine, "b", "c")).toBe("exit");
    expect(deriveLayerPhase(second.machine, "e", "c")).toBe("warm");
    expect([...paintableSectionIds(second.machine, "c")]).toEqual(["c", "b"]);
  });

  it("a newer cold destination supersedes the preparation, and requesting the entered page CANCELS it back to the running pair (t81)", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const prepareD = requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "d", // cold → prepares, inheriting the running pair
      intent: INTENT,
    })!;
    const prepareE = requester({
      machine: prepareD.machine,
      mountedIds: prepareD.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "e", // colder → supersedes the preparation, SAME inherited pair
      intent: INTENT,
    })!;
    expect(prepareE.machine).toEqual({
      kind: "prepared",
      generation: 3,
      toId: "e",
      visibleActiveId: "c",
      intent: INTENT,
      inherited: { toId: "c", exitingIds: ["b"], intent: INTENT, generation: 1 },
    });
    // D (the replaced preparation's target) stays mounted as plain warm
    // cache until the next rotation prunes it.
    expect([...prepareE.mountedIds]).toEqual(["a", "b", "c", "d", "e"]);
    // Returning to the page already being entered CANCELS the preparation:
    // the machine restores the still-running pair exactly — same target,
    // same exits, and the PAIR'S OWN generation so its in-flight
    // completion still settles it.
    const backToC = requester({
      machine: prepareE.machine,
      mountedIds: prepareE.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "c",
      intent: INTENT,
    })!;
    // enterFromOffset is the only difference from `first`: false — the
    // restored pair must never re-apply an entry offset (and the
    // coordinator skips the same-generation command, so the live playhead
    // survives untouched).
    expect(backToC.machine).toEqual({ ...(first.machine as object), enterFromOffset: false });
    expect(backToC.mountedIds).toBe(prepareE.mountedIds);
  });

  it("a reversal inside the visible pair retargets from current progress (022)", () => {
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
    // current visual progress. The shell assigns the machine's generation
    // + 1, so the reversal carries the next generation.
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
      inherited: null,
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

describe("rapid B→C→D with a cold D (020-A2 §15 + t81 prepare-in-place)", () => {
  let requester: ReturnType<typeof makeRequester>;
  beforeEach(() => {
    requester = makeRequester();
  });
  function prepareColdDuringMotion() {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    return { first, prepared: requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "d",
      intent: INTENT,
    })! };
  }

  it("prepares D while the B→C pair keeps running (the pair paints on)", () => {
    const { prepared } = prepareColdDuringMotion();
    expect(prepared.machine).toEqual({
      kind: "prepared",
      generation: 2,
      toId: "d",
      visibleActiveId: "c",
      intent: INTENT,
      inherited: { toId: "c", exitingIds: ["b"], intent: INTENT, generation: 1 },
    });
    // The mounted set grows by the hidden target; the visible pair's pages
    // keep their phases (C entering is now the VISIBLE page, B still exit).
    expect([...prepared.mountedIds]).toEqual(["a", "b", "c", "d"]);
    expect(deriveLayerPhase(prepared.machine, "c", "c")).toBe("active");
    expect(deriveLayerPhase(prepared.machine, "b", "c")).toBe("exit");
    expect(deriveLayerPhase(prepared.machine, "d", "c")).toBe("warm");
    // Exactly the visible pair paints: C + B.
    expect([...paintableSectionIds(prepared.machine, "c")]).toEqual(["c", "b"]);
  });

  it("the armed transition adopts the inherited pair as its exit train", () => {
    const { prepared } = prepareColdDuringMotion();
    const armed = startPreparedTransition(prepared.machine);
    expect(armed).toEqual({
      kind: "transition",
      generation: 2,
      toId: "d",
      exitingIds: ["c", "b"],
      enterFromOffset: true,
      intent: INTENT,
    });
    // The train settles one exit per report; the LAST one idles.
    const afterB = reportLayerSettled(armed, "b", 2);
    expect(afterB).toEqual({ ...(armed as object), exitingIds: ["c"] });
    expect(reportLayerSettled(afterB, "c", 2)).toBe(IDLE_SECTION_NAV);
  });

  it("a direction-flipping preparation collapses the inherited exits at arm", () => {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const prepared = requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "e",
      intent: PREV_INTENT, // opposite travel direction
    })!;
    const armed = startPreparedTransition(prepared.machine);
    expect(armed).toEqual({
      kind: "transition",
      generation: 2,
      toId: "e",
      exitingIds: ["c"],
      enterFromOffset: true,
      intent: PREV_INTENT,
    });
  });

  it("never settles from the running pair once a preparation owns the machine (its completion is inert)", () => {
    const { first, prepared } = prepareColdDuringMotion();
    // The old pair's completion reports against the PREPARED machine: not a
    // transition → a no-op, the machine stays prepared for its arm frame.
    expect(reportLayerSettled(prepared.machine, "b", first.machine.kind === "transition" ? first.machine.generation : 1)).toBe(
      prepared.machine,
    );
    // And a stale-generation report against the ARMED machine is ignored.
    const armed = startPreparedTransition(prepared.machine);
    expect(reportLayerSettled(armed, "c", 1)).toBe(armed);
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
  function runningTransition() {
    const { machine, mountedIds } = idleWith(PAGES, "b");
    return requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
  }
  function prepareColdDuringMotion() {
    const first = runningTransition();
    return requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "e", // cold third destination → prepares (warm ones interrupt)
      intent: INTENT,
    })!;
  }

  it("deleting the outgoing page settles the machine (it can never report)", () => {
    const first = runningTransition();
    // B (the single outgoing page) is deleted: no exit report can ever
    // arrive, so the machine collapses straight to idle instead of
    // stalling mid-transition.
    const pruned = pruneMissingSections(first.machine, ["a", "c", "d", "e", "f"]);
    expect(pruned).toBe(IDLE_SECTION_NAV);
  });

  it("keeps the transition when an unrelated page is deleted", () => {
    const first = runningTransition();
    const pruned = pruneMissingSections(first.machine, ["b", "c", "d", "e", "f"]);
    expect(pruned).toBe(first.machine);
  });

  it("drops vanished pages from a preparation's inherited train (t81)", () => {
    const prepared = prepareColdDuringMotion(); // prepared{e}, inherited B→C pair
    // B (an inherited exit) is deleted: its exit report can never arrive,
    // so it leaves the inherited train — the preparation itself survives
    // and arms with the visible page.
    const pruned = pruneMissingSections(prepared.machine, ["a", "c", "d", "e", "f"]);
    expect(pruned).toEqual({
      ...(prepared.machine as object),
      inherited: { toId: "c", exitingIds: [], intent: INTENT, generation: 1 },
    });
    const armed = startPreparedTransition(pruned);
    expect(armed.kind === "transition" && [...armed.exitingIds]).toEqual(["c"]);
  });

  it("collapses to idle when the transition target is deleted", () => {
    const first = runningTransition();
    expect(pruneMissingSections(first.machine, ["a", "b", "d", "e", "f"])).toBe(
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

  it("idles a preparation whose VISIBLE page is deleted (the armed pair could never form)", () => {
    // B→C prepares D; then C (the visible page) is deleted. The armed
    // transition would have no exit anchor, so the machine collapses to
    // idle instead of stalling.
    const { machine, mountedIds } = idleWith(PAGES, "b");
    const first = requester({
      machine,
      mountedIds,
      pageOrder: PAGES,
      currentActiveId: "b",
      targetId: "c",
      intent: INTENT,
    })!;
    const prepared = requester({
      machine: first.machine,
      mountedIds: first.mountedIds,
      pageOrder: PAGES,
      currentActiveId: "c",
      targetId: "d",
      intent: INTENT,
    })!;
    const pruned = pruneMissingSections(prepared.machine, ["a", "b", "d", "e", "f"]);
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
