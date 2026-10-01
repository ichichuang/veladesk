import { describe, expect, it } from "vitest";

import {
  BoundedBodySink,
  safeFetchPublicUrl,
  type SafeFetchIo,
  type SafeTransportRequest,
  type SafeTransportResponse,
  type SafeTransportResult,
} from "./safe-public-fetch";

const PUBLIC_A = { address: "93.184.216.34", family: 4 as const };
const PUBLIC_B = { address: "140.82.112.4", family: 4 as const };

function textBody(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

interface MockTransportScript {
  /** Responses in order; the last one repeats if exhausted. */
  responses: SafeTransportResult[];
  /** Recorded requests, for assertions. */
  requests: SafeTransportRequest[];
}

function makeIo(
  dns: Record<string, ReadonlyArray<{ address: string; family: 4 | 6 }>> = {
    "example.com": [PUBLIC_A],
    "other.example": [PUBLIC_B],
  },
  script: MockTransportScript = { responses: [], requests: [] },
  clock?: () => number
): SafeFetchIo {
  return {
    lookupHost: async (hostname) => {
      const addresses = dns[hostname];
      if (addresses === undefined) {
        throw new Error("NXDOMAIN");
      }
      return addresses;
    },
    transport: async (request) => {
      script.requests.push(request);
      const next = script.responses.shift();
      return next ?? { ok: false, reason: "connection-failed" };
    },
    ...(clock !== undefined ? { now: clock } : {}),
  };
}

function okResponse(init: Partial<SafeTransportResponse> = {}): SafeTransportResult {
  return {
    ok: true,
    response: {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: textBody("<html></html>"),
      ...init,
    },
  };
}

function redirectResponse(location: string): SafeTransportResult {
  return {
    ok: true,
    response: { status: 302, headers: { location }, body: new Uint8Array(0) },
  };
}

describe("safeFetchPublicUrl host + DNS validation", () => {
  it("connects through the pinned validated address", async () => {
    const script: MockTransportScript = { responses: [okResponse()], requests: [] };
    const result = await safeFetchPublicUrl(
      "https://example.com/page",
      { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
      makeIo(undefined, script)
    );
    expect(result).toMatchObject({ ok: true, status: 200, finalUrl: "https://example.com/page" });
    expect(script.requests[0]).toMatchObject({
      address: PUBLIC_A.address,
      family: 4,
      url: new URL("https://example.com/page"),
    });
    expect(script.requests[0]!.headers["user-agent"]).toContain("VelaDeskRecognition");
    expect(script.requests[0]!.headers).not.toHaveProperty("cookie");
  });

  it("rejects hosts that resolve to private addresses", async () => {
    const script: MockTransportScript = { responses: [okResponse()], requests: [] };
    const result = await safeFetchPublicUrl(
      "https://private.example/",
      { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
      makeIo({ "private.example": [{ address: "10.1.2.3", family: 4 }] }, script)
    );
    expect(result).toEqual({ ok: false, reason: "non-public-address" });
    expect(script.requests).toHaveLength(0);
  });

  it("rejects mixed public + private DNS answers", async () => {
    const script: MockTransportScript = { responses: [okResponse()], requests: [] };
    const result = await safeFetchPublicUrl(
      "https://mixed.example/",
      { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
      makeIo(
        { "mixed.example": [PUBLIC_A, { address: "192.168.0.9", family: 4 }] },
        script
      )
    );
    expect(result).toEqual({ ok: false, reason: "non-public-address" });
    expect(script.requests).toHaveLength(0);
  });

  it("rejects unsafe local hostnames and DNS failures without connecting", async () => {
    const script: MockTransportScript = { responses: [okResponse()], requests: [] };
    const io = makeIo(
      { "meta.example": [{ address: "169.254.169.254", family: 4 }] },
      script
    );
    expect(
      await safeFetchPublicUrl("https://localhost/", { maxBytes: 10, accept: "*", timeoutMs: 10 }, io)
    ).toEqual({ ok: false, reason: "unsafe-host" });
    expect(
      await safeFetchPublicUrl("https://meta.example/", { maxBytes: 10, accept: "*", timeoutMs: 10 }, io)
    ).toEqual({ ok: false, reason: "non-public-address" });
    expect(
      await safeFetchPublicUrl("https://nxdomain.example/", { maxBytes: 10, accept: "*", timeoutMs: 10 }, io)
    ).toEqual({ ok: false, reason: "dns-failed" });
    expect(script.requests).toHaveLength(0);
  });

  it("rejects non-default ports and credentials before connecting", async () => {
    const script: MockTransportScript = { responses: [okResponse()], requests: [] };
    const io = makeIo(undefined, script);
    expect(
      await safeFetchPublicUrl("https://example.com:8443/", { maxBytes: 10, accept: "*", timeoutMs: 10 }, io)
    ).toEqual({ ok: false, reason: "unsupported-port" });
    expect(
      await safeFetchPublicUrl("https://user@example.com/", { maxBytes: 10, accept: "*", timeoutMs: 10 }, io)
    ).toEqual({ ok: false, reason: "credentials-not-allowed" });
    expect(script.requests).toHaveLength(0);
  });
});

describe("safeFetchPublicUrl redirect policy", () => {
  it("follows public redirects with full re-validation per hop", async () => {
    const script: MockTransportScript = {
      responses: [redirectResponse("https://other.example/landing"), okResponse()],
      requests: [],
    };
    const result = await safeFetchPublicUrl(
      "https://example.com/",
      { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
      makeIo(undefined, script)
    );
    expect(result).toMatchObject({ ok: true, finalUrl: "https://other.example/landing" });
    expect(script.requests[1]).toMatchObject({ address: PUBLIC_B.address });
  });

  it("resolves relative redirect locations", async () => {
    const script: MockTransportScript = {
      responses: [redirectResponse("/deep/page?x=1"), okResponse()],
      requests: [],
    };
    const result = await safeFetchPublicUrl(
      "https://example.com/start",
      { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
      makeIo(undefined, script)
    );
    expect(result).toMatchObject({ ok: true, finalUrl: "https://example.com/deep/page?x=1" });
  });

  it("blocks redirects to localhost and private addresses", async () => {
    const localhostScript: MockTransportScript = {
      responses: [redirectResponse("http://127.0.0.1/"), okResponse()],
      requests: [],
    };
    expect(
      await safeFetchPublicUrl(
        "https://example.com/",
        { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
        makeIo(undefined, localhostScript)
      )
    ).toEqual({ ok: false, reason: "unsafe-host" });

    const privateScript: MockTransportScript = {
      responses: [redirectResponse("https://internal.example/"), okResponse()],
      requests: [],
    };
    expect(
      await safeFetchPublicUrl(
        "https://example.com/",
        { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
        makeIo(
          {
            "example.com": [PUBLIC_A],
            "internal.example": [{ address: "172.16.5.5", family: 4 }],
          },
          privateScript
        )
      )
    ).toEqual({ ok: false, reason: "non-public-address" });
  });

  it("blocks more than 4 redirect hops", async () => {
    const script: MockTransportScript = {
      responses: [
        redirectResponse("https://example.com/r1"),
        redirectResponse("https://example.com/r2"),
        redirectResponse("https://example.com/r3"),
        redirectResponse("https://example.com/r4"),
        redirectResponse("https://example.com/r5"),
        okResponse(),
      ],
      requests: [],
    };
    const result = await safeFetchPublicUrl(
      "https://example.com/",
      { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
      makeIo(undefined, script)
    );
    expect(result).toEqual({ ok: false, reason: "too-many-redirects" });
    expect(script.requests).toHaveLength(5);
  });

  it("blocks redirects to unsupported schemes and malformed locations", async () => {
    const script: MockTransportScript = {
      responses: [redirectResponse("ftp://other.example/file"), okResponse()],
      requests: [],
    };
    expect(
      await safeFetchPublicUrl(
        "https://example.com/",
        { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
        makeIo(undefined, script)
      )
    ).toEqual({ ok: false, reason: "unsupported-protocol" });

    const malformed: MockTransportScript = { responses: [redirectResponse("https://["), okResponse()], requests: [] };
    expect(
      await safeFetchPublicUrl(
        "https://example.com/",
        { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
        makeIo(undefined, malformed)
      )
    ).toEqual({ ok: false, reason: "invalid-redirect" });
  });

  it("re-pins DNS on every hop (redirect to a second host)", async () => {
    const script: MockTransportScript = {
      responses: [redirectResponse("https://other.example/x"), okResponse()],
      requests: [],
    };
    await safeFetchPublicUrl(
      "https://example.com/",
      { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
      makeIo(undefined, script)
    );
    expect(script.requests.map((request) => request.url.hostname)).toEqual([
      "example.com",
      "other.example",
    ]);
  });
});

describe("safeFetchPublicUrl transport failures + deadlines", () => {
  it("propagates transport failures", async () => {
    for (const reason of ["timeout", "connection-failed", "body-too-large", "network-error"] as const) {
      const script: MockTransportScript = { responses: [{ ok: false, reason }], requests: [] };
      expect(
        await safeFetchPublicUrl(
          "https://example.com/",
          { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
          makeIo(undefined, script)
        )
      ).toEqual({ ok: false, reason });
    }
  });

  it("refuses to start a hop once the deadline has passed", async () => {
    let tick = 0;
    const clock = () => {
      tick += 1;
      return tick * 1000;
    };
    const script: MockTransportScript = {
      responses: [redirectResponse("https://other.example/"), okResponse()],
      requests: [],
    };
    // now()=1000 → deadline 2000; the pre-transport check sees now()=2000
    // → the hop never starts and no connection is attempted.
    const result = await safeFetchPublicUrl(
      "https://example.com/",
      { maxBytes: 1024, accept: "text/html", timeoutMs: 1000 },
      makeIo(undefined, script, clock)
    );
    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(script.requests).toHaveLength(0);
  });
});

describe("BoundedBodySink", () => {
  it("accumulates within budget and reports overflow immediately", () => {
    const sink = new BoundedBodySink(10);
    expect(sink.push(new Uint8Array([1, 2, 3]))).toBe("ok");
    expect(sink.push(new Uint8Array([4, 5, 6, 7]))).toBe("ok");
    expect(sink.byteLength()).toBe(7);
    expect(sink.push(new Uint8Array([8, 9, 10, 11]))).toBe("overflow");
    expect(sink.toBytes()).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
  });

  it("handles exact-budget bodies", () => {
    const sink = new BoundedBodySink(4);
    expect(sink.push(new Uint8Array([9, 9, 9, 9]))).toBe("ok");
    expect(sink.toBytes()).toEqual(new Uint8Array([9, 9, 9, 9]));
  });
});
