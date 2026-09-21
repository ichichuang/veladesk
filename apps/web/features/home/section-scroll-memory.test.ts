import { describe, expect, it } from "vitest";

import { SectionScrollMemory, restoredScrollTop } from "./section-scroll-memory";

describe("restoredScrollTop", () => {
  it("restores a saved position clamped into the current range", () => {
    expect(restoredScrollTop(undefined, 500)).toBe(0);
    expect(restoredScrollTop(320, 500)).toBe(320);
    // The content shrank while away: clamp instead of overshooting.
    expect(restoredScrollTop(900, 500)).toBe(500);
    expect(restoredScrollTop(-20, 500)).toBe(0);
    expect(restoredScrollTop(Number.NaN, 500)).toBe(0);
    expect(restoredScrollTop(100, 0)).toBe(0);
  });
});

describe("SectionScrollMemory", () => {
  it("saves and recalls per-section positions independently", () => {
    const memory = new SectionScrollMemory();
    memory.save("page-1", 120);
    memory.save("page-2", 480);

    expect(memory.recall("page-1")).toBe(120);
    expect(memory.recall("page-2")).toBe(480);
    expect(memory.recall("page-3")).toBeUndefined();
  });

  it("never stores non-finite values and forgets on demand", () => {
    const memory = new SectionScrollMemory();
    memory.save("page-1", Number.POSITIVE_INFINITY);
    expect(memory.recall("page-1")).toBeUndefined();

    memory.save("page-1", 88);
    memory.forget("page-1");
    expect(memory.recall("page-1")).toBeUndefined();
  });
});
