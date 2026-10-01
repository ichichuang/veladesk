import { describe, expect, it } from "vitest";

import {
  extractHtmlMetadata,
  isHtmlContentType,
  looksLikeHtml,
} from "./html-metadata";

const BASE = "https://site.example/page";

describe("extractHtmlMetadata", () => {
  it("extracts application-name", () => {
    const meta = extractHtmlMetadata(
      `<!doctype html><html><head>
        <meta name="application-name" content="Example App">
      </head><body></body></html>`,
      BASE
    );
    expect(meta.applicationName).toBe("Example App");
    expect(meta.ogSiteName).toBeUndefined();
    expect(meta.title).toBeUndefined();
  });

  it("extracts og:site_name", () => {
    const meta = extractHtmlMetadata(
      `<html><head>
        <meta property="og:site_name" content="Site Example">
      </head></html>`,
      BASE
    );
    expect(meta.ogSiteName).toBe("Site Example");
  });

  it("extracts the document title", () => {
    const meta = extractHtmlMetadata(
      `<html><head><title>Example &amp; Friends</title></head></html>`,
      BASE
    );
    expect(meta.title).toBe("Example & Friends");
  });

  it("extracts and resolves the manifest link", () => {
    const meta = extractHtmlMetadata(
      `<html><head><link rel="manifest" href="/app.webmanifest"></head></html>`,
      BASE
    );
    expect(meta.manifestUrl).toBe("https://site.example/app.webmanifest");
  });

  it("extracts apple-touch-icons and declared icons with multiple sizes", () => {
    const meta = extractHtmlMetadata(
      `<html><head>
        <link rel="apple-touch-icon" sizes="180x180" href="/touch.png">
        <link rel="icon" type="image/png" sizes="192x192 512x512" href="/big.png">
        <link rel="icon" type="image/png" sizes="32x32" href="/small.png">
        <link rel="shortcut icon" href="/favicon-16.png">
        <link rel="stylesheet" href="/app.css">
      </head></html>`,
      BASE
    );
    expect(meta.appleTouchIcons).toEqual([
      { url: "https://site.example/touch.png", kind: "apple-touch-icon", sizes: "180x180" },
    ]);
    expect(meta.iconLinks.map((icon) => icon.url)).toEqual([
      "https://site.example/big.png",
      "https://site.example/small.png",
      "https://site.example/favicon-16.png",
    ]);
    expect(meta.iconLinks[0]!.sizes).toBe("192x192 512x512");
  });

  it("resolves relative URLs against the final page URL", () => {
    const meta = extractHtmlMetadata(
      `<html><head>
        <link rel="icon" href="icons/favicon.ico">
        <link rel="apple-touch-icon" href="../touch/apple.png">
      </head></html>`,
      "https://site.example/docs/index.html"
    );
    expect(meta.iconLinks[0]!.url).toBe("https://site.example/docs/icons/favicon.ico");
    expect(meta.appleTouchIcons[0]!.url).toBe("https://site.example/touch/apple.png");
  });

  it("ignores <base> and unresolvable hrefs", () => {
    const meta = extractHtmlMetadata(
      `<html><head>
        <base href="https://evil.example/">
        <link rel="icon" href="/favicon.png">
        <link rel="icon" href="https://[">
      </head></html>`,
      BASE
    );
    expect(meta.iconLinks).toEqual([
      { url: "https://site.example/favicon.png", kind: "icon" },
    ]);
  });

  it("survives malformed HTML", () => {
    const meta = extractHtmlMetadata(
      `<html><head><meta name="application-name" content="Broken"><link rel=manifest href=/m.json><title>Unclosed`,
      BASE
    );
    // Whatever it managed to see is fine; it must not throw and not invent.
    expect(meta.applicationName).toBe("Broken");
    expect(meta.manifestUrl).toBe("https://site.example/m.json");
  });

  it("returns empty metadata for documents without any", () => {
    const meta = extractHtmlMetadata(`<html><body><p>Nothing here.</p></body></html>`, BASE);
    expect(meta.applicationName).toBeUndefined();
    expect(meta.ogSiteName).toBeUndefined();
    expect(meta.title).toBeUndefined();
    expect(meta.manifestUrl).toBeUndefined();
    expect(meta.appleTouchIcons).toEqual([]);
    expect(meta.iconLinks).toEqual([]);
  });

  it("keeps the FIRST occurrence of duplicate metas (deterministic)", () => {
    const meta = extractHtmlMetadata(
      `<html><head>
        <meta name="application-name" content="First">
        <meta name="application-name" content="Second">
      </head></html>`,
      BASE
    );
    expect(meta.applicationName).toBe("First");
  });

  it("handles a marketing-heavy title and a hyphenated name untouched (title cleaning is separate)", () => {
    const meta = extractHtmlMetadata(
      `<html><head><title>Hyphen-App — The Best Tool Ever Made</title></head></html>`,
      BASE
    );
    expect(meta.title).toBe("Hyphen-App — The Best Tool Ever Made");
  });
});

describe("content-type guards", () => {
  it("accepts HTML and XHTML only", () => {
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("application/xhtml+xml")).toBe(true);
    expect(isHtmlContentType("application/json")).toBe(false);
    expect(isHtmlContentType("image/png")).toBe(false);
    expect(isHtmlContentType("")).toBe(false);
  });

  it("sniffs missing content-types conservatively", () => {
    expect(looksLikeHtml(`<!doctype html><html>`)).toBe(true);
    expect(looksLikeHtml(`  <HTML lang="en">`)).toBe(true);
    expect(looksLikeHtml(`{"name":"not html"}`)).toBe(false);
    expect(looksLikeHtml(`<?xml version="1.0"?><html>`)).toBe(true);
  });
});
