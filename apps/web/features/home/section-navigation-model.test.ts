import { describe, expect, it } from "vitest";

import {
  nextSectionId,
  previousSectionId,
  resolveSectionAfterDelete,
  sectionNavDirection,
} from "./section-navigation-model";

const PAGES = ["home", "dev", "ai", "tools"] as const;

describe("previousSectionId", () => {
  it("returns null at the first section (no wrap)", () => {
    expect(previousSectionId(PAGES, "home")).toBeNull();
  });

  it("returns the adjacent previous section in the middle", () => {
    expect(previousSectionId(PAGES, "ai")).toBe("dev");
  });

  it("returns the second-to-last section at the end", () => {
    expect(previousSectionId(PAGES, "tools")).toBe("ai");
  });

  it("returns null for an unknown section", () => {
    expect(previousSectionId(PAGES, "nope")).toBeNull();
  });
});

describe("nextSectionId", () => {
  it("returns the adjacent next section in the middle", () => {
    expect(nextSectionId(PAGES, "home")).toBe("dev");
  });

  it("returns null at the last section (no wrap)", () => {
    expect(nextSectionId(PAGES, "tools")).toBeNull();
  });

  it("returns null for an unknown section", () => {
    expect(nextSectionId(PAGES, "nope")).toBeNull();
  });
});

describe("resolveSectionAfterDelete", () => {
  it("reveals the NEXT section when a middle section is deleted", () => {
    expect(resolveSectionAfterDelete(PAGES, "dev")).toBe("ai");
  });

  it("reveals the PREVIOUS section when the last section is deleted", () => {
    expect(resolveSectionAfterDelete(PAGES, "tools")).toBe("ai");
  });

  it("reveals the next section when the FIRST section is deleted", () => {
    expect(resolveSectionAfterDelete(PAGES, "home")).toBe("dev");
  });

  it("resolves to null for an unknown or last-surviving section", () => {
    expect(resolveSectionAfterDelete(PAGES, "nope")).toBeNull();
    expect(resolveSectionAfterDelete(["only"], "only")).toBeNull();
  });
});

describe("sectionNavDirection", () => {
  it("routes ArrowUp/PageUp back and ArrowDown/PageDown forward", () => {
    expect(sectionNavDirection("ArrowUp")).toBe("prev");
    expect(sectionNavDirection("PageUp")).toBe("prev");
    expect(sectionNavDirection("ArrowDown")).toBe("next");
    expect(sectionNavDirection("PageDown")).toBe("next");
  });

  it("ignores every other key, including horizontal arrows", () => {
    expect(sectionNavDirection("ArrowLeft")).toBeNull();
    expect(sectionNavDirection("ArrowRight")).toBeNull();
    expect(sectionNavDirection("a")).toBeNull();
    expect(sectionNavDirection(" ")).toBeNull();
  });
});
