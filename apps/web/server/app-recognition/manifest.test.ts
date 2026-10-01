import { describe, expect, it } from "vitest";

import {
  declaredSizeFrom,
  isManifestContentType,
  parseWebManifest,
  rankManifestIcons,
} from "./manifest";

const MANIFEST_URL = "https://site.example/app.webmanifest";

describe("parseWebManifest names", () => {
  it("short_name beats name", () => {
    const manifest = parseWebManifest(
      JSON.stringify({ short_name: "Short", name: "The Longer Name" }),
      MANIFEST_URL
    );
    expect(manifest?.shortName).toBe("Short");
    expect(manifest?.name).toBe("The Longer Name");
  });

  it("name is the fallback", () => {
    const manifest = parseWebManifest(JSON.stringify({ name: "Only Name" }), MANIFEST_URL);
    expect(manifest?.shortName).toBeUndefined();
    expect(manifest?.name).toBe("Only Name");
  });

  it("collapses whitespace and clamps long names", () => {
    const manifest = parseWebManifest(
      JSON.stringify({ short_name: "  Spaced \n Out   Name  " }),
      MANIFEST_URL
    );
    expect(manifest?.shortName).toBe("Spaced Out Name");
    const long = parseWebManifest(JSON.stringify({ name: "x".repeat(120) }), MANIFEST_URL);
    expect(Array.from(long?.name ?? "")).toHaveLength(80);
  });

  it("ignores malformed manifests", () => {
    expect(parseWebManifest("{not json", MANIFEST_URL)).toBeUndefined();
    expect(parseWebManifest("[]", MANIFEST_URL)).toBeUndefined();
    expect(parseWebManifest("null", MANIFEST_URL)).toBeUndefined();
    expect(parseWebManifest(JSON.stringify({}), MANIFEST_URL)).toBeUndefined();
    expect(
      parseWebManifest(JSON.stringify({ icons: [{ src: "about:blank" }] }), MANIFEST_URL)
    ).toMatchObject({ icons: [{ url: "about:blank" }] });
  });
});

describe("parseWebManifest icon ranking", () => {
  it("ranks larger declared raster sizes first", () => {
    const manifest = parseWebManifest(
      JSON.stringify({
        icons: [
          { src: "/32.png", sizes: "32x32", type: "image/png" },
          { src: "/512.png", sizes: "512x512", type: "image/png" },
          { src: "/192.png", sizes: "192x192", type: "image/png" },
          { src: "/256.png", sizes: "256x256", type: "image/png" },
        ],
      }),
      MANIFEST_URL
    );
    expect(manifest?.icons.map((icon) => icon.url)).toEqual([
      "https://site.example/512.png",
      "https://site.example/256.png",
      "https://site.example/192.png",
      "https://site.example/32.png",
    ]);
  });

  it("a 512 raster outranks a tiny favicon-sized entry", () => {
    const manifest = parseWebManifest(
      JSON.stringify({
        icons: [
          { src: "/favicon-32.png", sizes: "32x32" },
          { src: "/app-512.png", sizes: "512x512" },
        ],
      }),
      MANIFEST_URL
    );
    expect(manifest?.icons[0]!.url).toBe("https://site.example/app-512.png");
  });

  it("resolves relative icon URLs against the manifest URL", () => {
    const manifest = parseWebManifest(
      JSON.stringify({ icons: [{ src: "icons/192.png", sizes: "192x192" }] }),
      "https://site.example/assets/manifest.json"
    );
    expect(manifest?.icons[0]!.url).toBe("https://site.example/assets/icons/192.png");
  });

  it("skips SVG and monochrome icons", () => {
    const manifest = parseWebManifest(
      JSON.stringify({
        icons: [
          { src: "/vector.svg", sizes: "any", type: "image/svg+xml" },
          { src: "/maskable.png", sizes: "512x512", purpose: "maskable" },
          { src: "/mono.png", sizes: "512x512", purpose: "monochrome" },
          { src: "/good.png", sizes: "192x192", type: "image/png" },
        ],
      }),
      MANIFEST_URL
    );
    expect(manifest?.icons.map((icon) => icon.url)).toEqual([
      "https://site.example/maskable.png",
      "https://site.example/good.png",
    ]);
  });
});

describe("declaredSizeFrom", () => {
  it("takes the largest edge from multi-size entries", () => {
    expect(declaredSizeFrom("192x192 512x512")).toBe(512);
    expect(declaredSizeFrom("512x512")).toBe(512);
    expect(declaredSizeFrom("180x180")).toBe(180);
    expect(declaredSizeFrom("any")).toBeUndefined();
    expect(declaredSizeFrom("garbage")).toBeUndefined();
    expect(declaredSizeFrom(undefined)).toBeUndefined();
  });
});

describe("rankManifestIcons", () => {
  it("keeps input order for equal sizes", () => {
    const ranked = rankManifestIcons([
      { url: "a" },
      { url: "b", declaredSize: 64 },
      { url: "c" },
      { url: "d", declaredSize: 512 },
    ]);
    expect(ranked.map((icon) => icon.url)).toEqual(["d", "b", "a", "c"]);
  });
});

describe("isManifestContentType", () => {
  it("accepts the manifest and JSON media types only", () => {
    expect(isManifestContentType("application/manifest+json")).toBe(true);
    expect(isManifestContentType("application/manifest+json; charset=utf-8")).toBe(true);
    expect(isManifestContentType("application/json")).toBe(true);
    expect(isManifestContentType("text/html")).toBe(false);
    expect(isManifestContentType("")).toBe(false);
  });
});
