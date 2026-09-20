import { describe, expect, it } from "vitest";

import { createContentAssetId } from "../src/core";
import { createHttpAssetTransport } from "../src/browser";
import type { PutAssetResult } from "../src/browser";

function makePng(seed = 1): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([seed], 16);
  return bytes;
}

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: Uint8Array | null;
}

/** Minimal in-memory asset server for transport tests. */
function makeServer(handler: (request: RecordedRequest) => Response | Promise<Response>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: Uint8Array | null = null;
    if (init?.body instanceof Blob) {
      body = new Uint8Array(await init.body.arrayBuffer());
    } else if (typeof init?.body === "string") {
      body = new TextEncoder().encode(init.body);
    }
    requests.push({ method, url, body });
    return handler({ method, url, body });
  };
  return { requests, fetch: fetchImpl as typeof globalThis.fetch };
}

function assetRecord(bytes: Uint8Array) {
  const id = createContentAssetId(bytes);
  return id.then((resolvedId) => ({
    id: resolvedId,
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
    mediaType: "image/png" as const,
    byteLength: bytes.byteLength,
  }));
}

function envelope(asset: { id: string; mediaType: string; byteLength: number }, status: number): Response {
  return Response.json(
    { asset },
    { status, headers: { "Content-Type": "application/json" } }
  );
}

describe("http asset transport: putAsset", () => {
  it("PUTs raw bytes to /api/v1/assets/<id> and decodes the 201 envelope", async () => {
    const bytes = makePng(1);
    const record = await assetRecord(bytes);
    const server = makeServer(() => envelope({ id: record.id, mediaType: "image/png", byteLength: 64 }, 201));
    const transport = createHttpAssetTransport({ fetch: server.fetch });

    const result = await transport.putAsset(record);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("stored");
      expect(result.asset.id).toBe(record.id);
    }
    expect(server.requests[0]?.method).toBe("PUT");
    expect(server.requests[0]?.url).toContain(`/api/v1/assets/${record.id}`);
    expect(server.requests[0]?.body).toEqual(bytes);
  });

  it("maps 200 to existed", async () => {
    const bytes = makePng(2);
    const record = await assetRecord(bytes);
    const server = makeServer(() => envelope({ id: record.id, mediaType: "image/png", byteLength: 64 }, 200));
    const transport = createHttpAssetTransport({ fetch: server.fetch });

    const result: PutAssetResult = await transport.putAsset(record);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("existed");
    }
  });

  it("classifies network failures, 5xx and contract violations", async () => {
    const bytes = makePng(3);
    const record = await assetRecord(bytes);

    const failing = createHttpAssetTransport({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof globalThis.fetch,
    });
    expect(await failing.putAsset(record)).toEqual({ ok: false, reason: "network-error" });

    const erroring = createHttpAssetTransport({
      fetch: (async () => new Response("boom", { status: 503 })) as typeof globalThis.fetch,
    });
    expect(await erroring.putAsset(record)).toEqual({ ok: false, reason: "server-error", status: 503 });

    const rejecting = createHttpAssetTransport({
      fetch: (async () => new Response("nope", { status: 413 })) as typeof globalThis.fetch,
    });
    const rejected = await rejecting.putAsset(record);
    expect(!rejected.ok && rejected.reason === "protocol-error").toBe(true);

    const lying = createHttpAssetTransport({
      fetch: (async () =>
        envelope({ id: "asset-sha256-" + "0".repeat(64), mediaType: "image/png", byteLength: 64 }, 201)) as typeof globalThis.fetch,
    });
    const lied = await lying.putAsset(record);
    expect(!lied.ok && lied.reason === "protocol-error").toBe(true);
  });
});

describe("http asset transport: getAsset", () => {
  it("returns a verified blob and re-hashes the bytes against the id", async () => {
    const bytes = makePng(4);
    const id = await createContentAssetId(bytes);
    const server = makeServer(
      () =>
        new Response(bytes as unknown as BodyInit, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
    );
    const transport = createHttpAssetTransport({ fetch: server.fetch });

    const result = await transport.getAsset(id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mediaType).toBe("image/png");
      expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    }
  });

  it("rejects 200 bytes whose hash does not match the requested id", async () => {
    const bytes = makePng(5);
    const wrongId = await createContentAssetId(makePng(6));
    const server = makeServer(
      () =>
        new Response(bytes as unknown as BodyInit, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
    );
    const transport = createHttpAssetTransport({ fetch: server.fetch });

    const result = await transport.getAsset(wrongId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("protocol-error");
    }
  });

  it("maps 404 to not-found and 5xx to server-error", async () => {
    const id = await createContentAssetId(makePng(7));

    const missing = createHttpAssetTransport({
      fetch: (async () => new Response("{}", { status: 404 })) as typeof globalThis.fetch,
    });
    expect(await missing.getAsset(id)).toEqual({ ok: false, reason: "not-found" });

    const erroring = createHttpAssetTransport({
      fetch: (async () => new Response("boom", { status: 500 })) as typeof globalThis.fetch,
    });
    expect(await erroring.getAsset(id)).toEqual({ ok: false, reason: "server-error", status: 500 });

    const offline = createHttpAssetTransport({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof globalThis.fetch,
    });
    expect(await offline.getAsset(id)).toEqual({ ok: false, reason: "network-error" });
  });
});

describe("http asset transport: headAsset", () => {
  it("maps 200/404/network distinctly", async () => {
    const id = await createContentAssetId(makePng(8));

    const present = createHttpAssetTransport({
      fetch: (async () => new Response(null, { status: 200 })) as typeof globalThis.fetch,
    });
    expect(await present.headAsset(id)).toEqual({ ok: true });

    const missing = createHttpAssetTransport({
      fetch: (async () => new Response(null, { status: 404 })) as typeof globalThis.fetch,
    });
    expect(await missing.headAsset(id)).toEqual({ ok: false, reason: "not-found" });

    const offline = createHttpAssetTransport({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof globalThis.fetch,
    });
    expect(await offline.headAsset(id)).toEqual({ ok: false, reason: "network-error" });
  });
});
