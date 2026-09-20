import { describe, expect, it } from "vitest";

import { handleIconSearch, handleIconSvg } from "./icon-handlers";

function searchRequest(query: string): Request {
  return new Request(`http://localhost:3000/api/v1/icons/search${query}`);
}

describe("handleIconSearch", () => {
  it("returns icons for a query", async () => {
    const response = await handleIconSearch(searchRequest("?q=github&collection=simple-icons"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as {
      icons: { id: string; collection: string; name: string; label: string }[];
    };
    expect(body.icons[0]).toEqual({
      id: "simple-icons:github",
      collection: "simple-icons",
      name: "github",
      label: "github",
    });
  });

  it("browses a collection when the query is missing", async () => {
    const response = await handleIconSearch(searchRequest("?collection=lucide&limit=5"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { icons: unknown[] };
    expect(body.icons).toHaveLength(5);
  });

  it("serves curated starters when neither query nor collection is given", async () => {
    const response = await handleIconSearch(searchRequest(""));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { icons: { id: string }[] };
    expect(body.icons[0]?.id).toBe("simple-icons:github");
  });

  it("maps an over-long query to 400 invalid-query", async () => {
    const response = await handleIconSearch(searchRequest(`?q=${"a".repeat(101)}`));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid-query" } });
  });

  it("maps a bad limit to 400 invalid-limit", async () => {
    const response = await handleIconSearch(searchRequest("?q=home&limit=0"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid-limit" } });
  });

  it("maps an unknown collection to 400 unknown-collection", async () => {
    const response = await handleIconSearch(searchRequest("?q=home&collection=whatever"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "unknown-collection" } });
  });
});

describe("handleIconSvg", () => {
  it("serves a bundled icon with the immutable svg cache contract", async () => {
    const response = await handleIconSvg("simple-icons", "github.svg");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const svg = await response.text();
    expect(svg).toContain("<svg");
    expect(svg).toContain('fill="currentColor"');
  });

  it("resolves names without the .svg suffix identically", async () => {
    const withSuffix = await handleIconSvg("lucide", "terminal.svg");
    const withoutSuffix = await handleIconSvg("lucide", "terminal");

    expect(await withSuffix.text()).toBe(await withoutSuffix.text());
  });

  it("404s unknown collections without treating them as paths", async () => {
    const response = await handleIconSvg("does-not-exist", "github.svg");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "icon-not-found" } });
  });

  it("404s unknown icons", async () => {
    const response = await handleIconSvg("lucide", "not-an-icon.svg");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "icon-not-found" } });
  });

  it("404s malformed names (path traversal, wrong charset, empty)", async () => {
    for (const name of ["..%2Fetc%2Fpasswd", "../../etc/passwd", "GitHub", "", ".svg"]) {
      const response = await handleIconSvg("lucide", name);
      expect(response.status).toBe(404);
    }
  });

  it("404s a bare suffix-only segment", async () => {
    const response = await handleIconSvg("lucide", ".svg");

    expect(response.status).toBe(404);
  });

  it("renders icons whose bodies contain internal ids without breaking", async () => {
    const response = await handleIconSvg("tabler", "brand-livewire.svg");

    expect(response.status).toBe(200);
    const svg = await response.text();
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<script");
  });
});
