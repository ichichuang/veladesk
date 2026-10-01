import { describe, expect, it } from "vitest";

import {
  armMobileSection,
  idleMobileSection,
  logicalDestinationOf,
  pendingMobilePageId,
  requestMobileSection,
  settleMobileSection,
  visibleMobilePageId,
} from "./mobile-section-transition";

/**
 * Task 026-R2 §7–§11/§27/§29/§30 — the minimal mobile prepared-target
 * coordinator: at most TWO panes ever exist, the logical destination is
 * recorded immediately, the incoming page mounts hidden first and only
 * arms at a layout-ready boundary, and rapid switching is
 * latest-target-wins with the stale page never becoming visible.
 */

describe("requestMobileSection", () => {
  it("idle A → preparing(B): A stays visible, B mounts hidden (§27 phase 1)", () => {
    const next = requestMobileSection(idleMobileSection("a"), "b");
    expect(next).toEqual({ phase: "preparing", visibleId: "a", targetId: "b" });
    expect(visibleMobilePageId(next)).toBe("a");
    expect(pendingMobilePageId(next)).toBe("b");
    expect(logicalDestinationOf(next)).toBe("b");
  });

  it("preparing(B) + C retargets: C is the pending page, B never becomes visible (§29)", () => {
    const preparingB = requestMobileSection(idleMobileSection("a"), "b");
    const preparingC = requestMobileSection(preparingB, "c");
    expect(preparingC).toEqual({ phase: "preparing", visibleId: "a", targetId: "c" });
    expect(pendingMobilePageId(preparingC)).toBe("c");
    expect(logicalDestinationOf(preparingC)).toBe("c");
  });

  it("entering(B) + C: B becomes the visible base, C prepares — never a third painter (§10)", () => {
    const enteringB = armMobileSection(requestMobileSection(idleMobileSection("a"), "b"));
    const next = requestMobileSection(enteringB, "c");
    expect(next).toEqual({ phase: "preparing", visibleId: "b", targetId: "c" });
    expect(visibleMobilePageId(next)).toBe("b");
  });

  it("requesting the CURRENT destination is an exact no-op — same reference (§11)", () => {
    const idle = idleMobileSection("a");
    expect(requestMobileSection(idle, "a")).toBe(idle);
    const preparing = requestMobileSection(idle, "b");
    expect(requestMobileSection(preparing, "b")).toBe(preparing);
    const entering = armMobileSection(preparing);
    expect(requestMobileSection(entering, "b")).toBe(entering);
  });
});

describe("arm / settle lifecycle (§27)", () => {
  it("arm promotes the pending page; the old page is retired by the caller", () => {
    const preparing = requestMobileSection(idleMobileSection("a"), "b");
    const entering = armMobileSection(preparing);
    expect(entering).toEqual({ phase: "entering", targetId: "b" });
    expect(visibleMobilePageId(entering)).toBe("b");
    expect(pendingMobilePageId(entering)).toBeNull();
  });

  it("settle returns to idle with ONLY the target mounted", () => {
    const entering = armMobileSection(requestMobileSection(idleMobileSection("a"), "b"));
    expect(settleMobileSection(entering)).toEqual({ phase: "idle", pageId: "b" });
  });

  it("arm/settle are no-ops outside their phase — a STALE settle can never corrupt the machine (§29)", () => {
    const idle = idleMobileSection("a");
    expect(armMobileSection(idle)).toBe(idle);
    expect(settleMobileSection(idle)).toBe(idle);
    const preparing = requestMobileSection(idle, "b");
    expect(settleMobileSection(preparing)).toBe(preparing);
  });

  it("a stale settle for a superseded target is ignored (B's completion must not settle the C machine)", () => {
    // a→preparing(b)→retarget c→arm c: a late settle from b's tween finds
    // a machine that is entering(c) and must not touch it.
    const enteringC = armMobileSection(
      requestMobileSection(requestMobileSection(idleMobileSection("a"), "b"), "c"),
    );
    expect(settleMobileSection(enteringC)).toEqual({ phase: "idle", pageId: "c" });
    // settle() on the entering machine settles THE MACHINE's target only;
    // there is no per-page settle channel that could revive b.
    expect(logicalDestinationOf(settleMobileSection(enteringC))).toBe("c");
  });
});

describe("visible/pending derivation across a full rapid sequence", () => {
  it("A → B → (arm) → C never exposes more than two panes and ends on C", () => {
    let machine = idleMobileSection("a");
    machine = requestMobileSection(machine, "b"); // preparing(b)
    expect([visibleMobilePageId(machine), pendingMobilePageId(machine)]).toEqual(["a", "b"]);
    machine = requestMobileSection(machine, "c"); // preparing(c) — b dropped before ever showing
    expect([visibleMobilePageId(machine), pendingMobilePageId(machine)]).toEqual(["a", "c"]);
    machine = armMobileSection(machine); // entering(c)
    expect(visibleMobilePageId(machine)).toBe("c");
    expect(pendingMobilePageId(machine)).toBeNull();
    machine = settleMobileSection(machine); // idle(c)
    expect(visibleMobilePageId(machine)).toBe("c");
    expect(pendingMobilePageId(machine)).toBeNull();
  });
});
