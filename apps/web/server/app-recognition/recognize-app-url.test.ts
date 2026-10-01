import { describe, expect, it } from "vitest";

import {
  recognizeAppUrl,
  type RecognizeAppUrlResult,
} from "./recognize-app-url";
import type { SafeFetchIo, SafeTransportRequest, SafeTransportResult } from "./safe-public-fetch";

/** 8-byte PNG signature + padding — enough for the magic-byte gate. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const ICO_BYTES = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
const PUBLIC = { address: "93.184.216.34", family: 4 as const };

function textBody(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function htmlResponse(html: string): SafeTransportResult {
  return {
    ok: true,
    response: {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: textBody(html),
    },
  };
}

interface Script {
  dns?: Record<string, ReadonlyArray<{ address: string; family: 4 | 6 }>>;
  responses: SafeTransportResult[];
  requests: SafeTransportRequest[];
}

function makeIo(script: Script): SafeFetchIo {
  return {
    lookupHost: async (hostname) => {
      const addresses = script.dns?.[hostname];
      if (addresses === undefined) {
        if (hostname === "site.example" || hostname === "cdn.example") {
          return [PUBLIC];
        }
        throw new Error("NXDOMAIN");
      }
      return addresses;
    },
    transport: async (request) => {
      script.requests.push(request);
      const next = script.responses.shift();
      return next ?? { ok: false, reason: "connection-failed" };
    },
  };
}

function pageWith(overrides: {
  applicationName?: string;
  ogSiteName?: string;
  title?: string;
  manifestHref?: string;
  appleTouch?: string;
  icons?: string;
}): string {
  const head = [
    overrides.applicationName !== undefined
      ? `<meta name="application-name" content="${overrides.applicationName}">`
      : "",
    overrides.ogSiteName !== undefined
      ? `<meta property="og:site_name" content="${overrides.ogSiteName}">`
      : "",
    overrides.title !== undefined ? `<title>${overrides.title}</title>` : "",
    overrides.manifestHref !== undefined
      ? `<link rel="manifest" href="${overrides.manifestHref}">`
      : "",
    overrides.appleTouch !== undefined
      ? `<link rel="apple-touch-icon" sizes="180x180" href="${overrides.appleTouch}">`
      : "",
    overrides.icons ?? "",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
  return `<html><head>${head}</head><body></body></html>`;
}

function manifestResponse(json: unknown): SafeTransportResult {
  return {
    ok: true,
    response: {
      status: 200,
      headers: { "content-type": "application/manifest+json" },
      body: textBody(JSON.stringify(json)),
    },
  };
}

function pngResponse(bytes: Uint8Array = PNG_BYTES): SafeTransportResult {
  return {
    ok: true,
    response: { status: 200, headers: { "content-type": "image/png" }, body: bytes },
  };
}

describe("recognizeAppUrl brand fast path", () => {
  it("returns a catalog match without any network I/O", async () => {
    const script: Script = { responses: [], requests: [] };
    const result = await recognizeAppUrl("https://github.com/openai", makeIo(script));
    expect(result).toEqual({
      ok: true,
      recognition: {
        normalizedUrl: "https://github.com/openai",
        hostname: "github.com",
        name: "GitHub",
        nameSource: "brand",
        icon: {
          kind: "catalog",
          iconKey: "simple-icons:github",
          displayName: "GitHub",
          source: "brand",
        },
        confidence: "high",
        status: "recognized",
      },
    });
    expect(script.requests).toHaveLength(0);
  });

  it("hard-fails invalid and unsafe input", async () => {
    expect(await recognizeAppUrl("javascript:alert(1)", makeIo({ responses: [], requests: [] }))).toEqual({
      ok: false,
      reason: "unsupported-protocol",
    });
    expect(await recognizeAppUrl("https://127.0.0.1/", makeIo({ responses: [], requests: [] }))).toEqual({
      ok: false,
      reason: "unsafe-host",
    });
    expect(await recognizeAppUrl("not a url at all", makeIo({ responses: [], requests: [] }))).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("recognizeAppUrl metadata flows", () => {
  it("uses application-name and the best manifest icon", async () => {
    const script: Script = {
      responses: [
        htmlResponse(
          pageWith({
            applicationName: "Example App",
            manifestHref: "/app.webmanifest",
          })
        ),
        manifestResponse({
          short_name: "Shorty",
          name: "Longer Name",
          icons: [
            { src: "/icon32.png", sizes: "32x32", type: "image/png" },
            { src: "/icon512.png", sizes: "512x512", type: "image/png" },
          ],
        }),
        pngResponse(),
      ],
      requests: [],
    };
    const result = await recognizeAppUrl("https://site.example/", makeIo(script));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recognition.name).toBe("Example App");
    expect(result.recognition.nameSource).toBe("application-name");
    expect(result.recognition.icon).toMatchObject({
      kind: "embedded-image",
      mimeType: "image/png",
      source: "manifest",
    });
    expect(result.recognition.confidence).toBe("medium");
    expect(result.recognition.status).toBe("recognized");
    // The 512 candidate was fetched, not the 32.
    expect(script.requests[2]!.url.pathname).toBe("/icon512.png");
    // Embedded bytes round-trip exactly.
    const embedded = result.recognition.icon as { kind: "embedded-image"; base64: string };
    expect(new Uint8Array(Buffer.from(embedded.base64, "base64"))).toEqual(PNG_BYTES);
  });

  it("name priority: og:site_name > manifest short_name > manifest name > cleaned title > hostname", async () => {
    async function nameFor(overrides: Parameters<typeof pageWith>[0]): Promise<string> {
      const script: Script = {
        responses: [
          htmlResponse(pageWith({ ...overrides, manifestHref: "/m.json" })),
          manifestResponse({ short_name: "MShort", name: "MFull", icons: [] }),
        ],
        requests: [],
      };
      const result = await recognizeAppUrl("https://site.example/", makeIo(script));
      return (result as { ok: true; recognition: { name: string } }).recognition.name;
    }
    expect(await nameFor({ ogSiteName: "OG Name" })).toBe("OG Name");
    expect(await nameFor({ manifestHref: "/m.json" })).toBe("MShort");
    expect(
      await recognizeAppUrl("https://site.example/", makeIo({
        responses: [
          htmlResponse(pageWith({ title: "Site Example — Great Tools", manifestHref: "/m.json" })),
          manifestResponse({ name: "MFull", icons: [] }),
        ],
        requests: [],
      })).then((r) => (r as { ok: true; recognition: { name: string } }).recognition.name)
    ).toBe("MFull");
    expect(
      await recognizeAppUrl("https://site.example/", makeIo({
        responses: [htmlResponse(pageWith({ title: "Site Example — Great Tools" }))],
        requests: [],
      })).then((r) => (r as { ok: true; recognition: { name: string } }).recognition.name)
    ).toBe("Site Example");
    expect(
      await recognizeAppUrl("https://site.example/", makeIo({
        responses: [htmlResponse(pageWith({}))],
        requests: [],
      })).then((r) => (r as { ok: true; recognition: { name: string } }).recognition.name)
    ).toBe("Site");
  });

  it("apple-touch-icon is used when the manifest fetch fails", async () => {
    const script: Script = {
      responses: [
        htmlResponse(pageWith({ manifestHref: "/m.json", appleTouch: "/touch.png" })),
        { ok: false, reason: "connection-failed" },
        pngResponse(),
      ],
      requests: [],
    };
    const result = await recognizeAppUrl("https://site.example/", makeIo(script));
    expect(result).toMatchObject({
      ok: true,
      recognition: { icon: { kind: "embedded-image", source: "apple-touch-icon" } },
    } as Partial<RecognizeAppUrlResult>);
  });

  it("skips non-raster icon bytes (ICO) and falls through to /favicon.ico", async () => {
    const script: Script = {
      responses: [
        htmlResponse(
          pageWith({
            icons: `<link rel="icon" href="/favicon.ico" sizes="32x32">`,
          })
        ),
        { ok: true, response: { status: 200, headers: { "content-type": "image/x-icon" }, body: ICO_BYTES } },
        pngResponse(),
      ],
      requests: [],
    };
    const result = await recognizeAppUrl("https://site.example/", makeIo(script));
    expect(script.requests[1]!.url.pathname).toBe("/favicon.ico");
    expect(script.requests[2]!.url.pathname).toBe("/favicon.ico");
    expect(result).toMatchObject({
      ok: true,
      recognition: { icon: { kind: "embedded-image", source: "favicon" } },
    } as Partial<RecognizeAppUrlResult>);
  });

  it("oversized icons are skipped and a smaller candidate wins", async () => {
    const script: Script = {
      responses: [
        htmlResponse(
          pageWith({
            icons: `<link rel="icon" href="/big.png" sizes="512x512"><link rel="icon" href="/small.png" sizes="32x32">`,
          })
        ),
        { ok: false, reason: "body-too-large" },
        pngResponse(),
      ],
      requests: [],
    };
    const result = await recognizeAppUrl("https://site.example/", makeIo(script));
    expect(script.requests[1]!.url.pathname).toBe("/big.png");
    expect(script.requests[2]!.url.pathname).toBe("/small.png");
    expect(result).toMatchObject({
      ok: true,
      recognition: { icon: { kind: "embedded-image" } },
    } as Partial<RecognizeAppUrlResult>);
  });

  it("declared SVG icon links are never fetched", async () => {
    const script: Script = {
      responses: [
        htmlResponse(
          pageWith({
            icons: `<link rel="icon" type="image/svg+xml" href="/vector.svg"><link rel="icon" href="/ok.png">`,
          })
        ),
        pngResponse(),
      ],
      requests: [],
    };
    await recognizeAppUrl("https://site.example/", makeIo(script));
    expect(script.requests.map((request) => request.url.pathname)).toEqual(["/", "/ok.png"]);
  });

  it("metadata pointing at private space is blocked by the safe-fetch boundary", async () => {
    const script: Script = {
      responses: [
        htmlResponse(pageWith({ manifestHref: "http://127.0.0.1/secret.json" })),
      ],
      requests: [],
    };
    const result = await recognizeAppUrl("https://site.example/", makeIo(script));
    // The page itself was fetched (public) and its favicon probed — but the
    // metadata-declared localhost manifest never reached the transport.
    expect(script.requests.map((request) => request.url.hostname)).toEqual([
      "site.example",
      "site.example",
    ]);
    expect(result).toMatchObject({
      ok: true,
      recognition: { status: "partial", confidence: "low" },
    } as Partial<RecognizeAppUrlResult>);
  });
});

describe("recognizeAppUrl failure degradation", () => {
  it("unreachable hosts produce a hostname partial, not an error", async () => {
    const script: Script = { responses: [], requests: [] };
    const result = await recognizeAppUrl("https://gone.example/", makeIo(script));
    expect(result).toEqual({
      ok: true,
      recognition: {
        normalizedUrl: "https://gone.example/",
        hostname: "gone.example",
        name: "Gone",
        nameSource: "hostname",
        icon: { kind: "generated", source: "generated" },
        confidence: "low",
        status: "partial",
      },
    });
  });

  it("HTTP errors degrade to partial", async () => {
    const script: Script = {
      responses: [{ ok: true, response: { status: 404, headers: {}, body: new Uint8Array(0) } }],
      requests: [],
    };
    const result = await recognizeAppUrl("https://site.example/missing", makeIo(script));
    expect(result).toMatchObject({
      ok: true,
      recognition: { nameSource: "hostname", status: "partial" },
    } as Partial<RecognizeAppUrlResult>);
  });

  it("timeouts degrade to partial", async () => {
    const script: Script = {
      responses: [{ ok: false, reason: "timeout" }],
      requests: [],
    };
    const result = await recognizeAppUrl("https://site.example/", makeIo(script));
    expect(result).toMatchObject({
      ok: true,
      recognition: { confidence: "low", status: "partial" },
    } as Partial<RecognizeAppUrlResult>);
  });

  it("an oversized HTML body is treated as no metadata (partial)", async () => {
    const script: Script = {
      responses: [{ ok: false, reason: "body-too-large" }],
      requests: [],
    };
    const result = await recognizeAppUrl("https://site.example/", makeIo(script));
    expect(result).toMatchObject({
      ok: true,
      recognition: { name: "Site", nameSource: "hostname", status: "partial" },
    } as Partial<RecognizeAppUrlResult>);
  });

  it("an oversized manifest is ignored safely (name falls to title)", async () => {
    const script: Script = {
      responses: [
        htmlResponse(pageWith({ title: "Site Example — Tools", manifestHref: "/m.json" })),
        { ok: false, reason: "body-too-large" },
      ],
      requests: [],
    };
    const result = await recognizeAppUrl("https://site.example/", makeIo(script));
    expect(result).toMatchObject({
      ok: true,
      recognition: { name: "Site Example", nameSource: "title" },
    } as Partial<RecognizeAppUrlResult>);
  });

  it("wrong content types are ignored", async () => {
    const script: Script = {
      responses: [
        {
          ok: true,
          response: { status: 200, headers: { "content-type": "application/json" }, body: textBody("{}") },
        },
      ],
      requests: [],
    };
    const result = await recognizeAppUrl("https://site.example/api", makeIo(script));
    expect(result).toMatchObject({
      ok: true,
      recognition: { nameSource: "hostname", status: "partial" },
    } as Partial<RecognizeAppUrlResult>);
  });
});
