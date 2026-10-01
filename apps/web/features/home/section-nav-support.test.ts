import { describe, expect, it } from "vitest";

import { scopedToLayer, sectionLayerSelector } from "./section-layer-query";

describe("section-layer-query (021-R1)", () => {
  it("scopes every lookup to exactly one page's layer", () => {
    expect(sectionLayerSelector("page-1")).toBe('[data-page-id="page-1"]');
    expect(scopedToLayer("page-1", ".vela-section-scroller")).toBe(
      '[data-page-id="page-1"] .vela-section-scroller'
    );
  });

  it("returns null (never a bare document-wide selector) without a page id", () => {
    expect(sectionLayerSelector(null)).toBeNull();
    expect(scopedToLayer(null, ".vela-grid-stage")).toBeNull();
  });

  it("escapes ids that would otherwise break the attribute selector", () => {
    expect(sectionLayerSelector('weird"id\\')).toBe('[data-page-id="weird\\"id\\\\"]');
  });
});
