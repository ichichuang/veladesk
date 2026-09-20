import { describe, expect, it } from "vitest";

import {
  ICON_PICKER_TABS,
  buildIconSearchUrl,
  decodeIconSearchResponse,
  isIconPickerTab,
  tabCollectionParam,
} from "./icon-picker-model";

describe("ICON_PICKER_TABS", () => {
  it("leads with All and follows the catalog's brand-first order", () => {
    expect(ICON_PICKER_TABS).toEqual(["all", "simple-icons", "lucide", "tabler", "ph"]);
  });
});

describe("isIconPickerTab / tabCollectionParam", () => {
  it("accepts the five tabs and maps All to no collection param", () => {
    for (const tab of ICON_PICKER_TABS) {
      expect(isIconPickerTab(tab)).toBe(true);
    }
    expect(isIconPickerTab("material-symbols")).toBe(false);
    expect(tabCollectionParam("all")).toBeUndefined();
    expect(tabCollectionParam("simple-icons")).toBe("simple-icons");
  });
});

describe("buildIconSearchUrl", () => {
  it("targets the self-hosted endpoint with collection and default limit", () => {
    expect(buildIconSearchUrl({ query: "", tab: "simple-icons" })).toBe(
      "/api/v1/icons/search?collection=simple-icons&limit=60"
    );
  });

  it("omits q for browse mode and includes trimmed queries", () => {
    expect(buildIconSearchUrl({ query: "   ", tab: "all" })).toBe("/api/v1/icons/search?limit=60");
    expect(buildIconSearchUrl({ query: " github ", tab: "all" })).toBe(
      "/api/v1/icons/search?q=github&limit=60"
    );
  });

  it("encodes queries safely and honors custom limits", () => {
    expect(buildIconSearchUrl({ query: "brand github", tab: "tabler", limit: 24 })).toBe(
      "/api/v1/icons/search?q=brand+github&collection=tabler&limit=24"
    );
  });
});

describe("decodeIconSearchResponse", () => {
  const entry = { id: "simple-icons:github", collection: "simple-icons", name: "github", label: "github" };

  it("decodes a well-formed response", () => {
    expect(decodeIconSearchResponse({ icons: [entry] })).toEqual([entry]);
    expect(decodeIconSearchResponse({ icons: [] })).toEqual([]);
  });

  it("rejects malformed envelopes and entries", () => {
    expect(decodeIconSearchResponse(undefined)).toBeUndefined();
    expect(decodeIconSearchResponse("nope")).toBeUndefined();
    expect(decodeIconSearchResponse({})).toBeUndefined();
    expect(decodeIconSearchResponse({ icons: "all" })).toBeUndefined();
    expect(decodeIconSearchResponse({ icons: [{ ...entry, id: 7 }] })).toBeUndefined();
    expect(
      decodeIconSearchResponse({ icons: [{ ...entry, label: undefined }] })
    ).toBeUndefined();
    expect(decodeIconSearchResponse({ icons: [entry, "junk"] })).toBeUndefined();
  });
});
