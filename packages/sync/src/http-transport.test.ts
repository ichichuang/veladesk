import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import { createHttpWorkspaceSyncTransport } from "./http-transport";
import { buildRichSnapshot } from "./test-support";

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

interface FetchStub {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: readonly RecordedCall[];
}

function fetchResponding(buildResponse: () => Response): FetchStub {
  const calls: RecordedCall[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    return buildResponse();
  };
  return { fetch, calls };
}

function fetchJson(status: number, body: unknown): FetchStub {
  return fetchResponding(
    () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

function fetchRaw(status: number, body: string): FetchStub {
  return fetchResponding(() => new Response(body, { status }));
}

function fetchRejecting(): FetchStub {
  const calls: RecordedCall[] = [];
  const fetch = async (): Promise<Response> => {
    throw new TypeError("fetch failed");
  };
  return { fetch, calls };
}

function successEnvelope(snapshot: WorkspaceSnapshot, revision = 1): unknown {
  return { workspace: { snapshot, revision, createdAt: 1_000, updatedAt: 2_000 } };
}

const SNAPSHOT = buildRichSnapshot("ws-1");

function transportWith(stub: FetchStub) {
  return { transport: createHttpWorkspaceSyncTransport({ fetch: stub.fetch }), stub };
}

describe("createHttpWorkspaceSyncTransport — options", () => {
  it("defaults to same-origin relative paths", async () => {
    const { transport, stub } = transportWith(fetchJson(200, successEnvelope(SNAPSHOT)));

    await transport.getWorkspace("ws-1");

    expect(stub.calls[0]?.url).toBe("/api/v1/workspaces/ws-1");
  });

  it("strips a trailing slash from a non-empty baseUrl without changing it further", async () => {
    const { stub } = transportWith(fetchJson(200, successEnvelope(SNAPSHOT)));
    const withBase = createHttpWorkspaceSyncTransport({
      baseUrl: "http://localhost:3000/",
      fetch: stub.fetch,
    });

    await withBase.getWorkspace("ws-1");

    expect(stub.calls[0]?.url).toBe("http://localhost:3000/api/v1/workspaces/ws-1");
  });

  it("throws RangeError for an explicit whitespace-only baseUrl", () => {
    expect(() =>
      createHttpWorkspaceSyncTransport({ baseUrl: "   ", fetch: fetchJson(200, {}).fetch }),
    ).toThrow(RangeError);
  });

  it("throws Error when neither options.fetch nor globalThis.fetch exist", () => {
    const globalWithFetch = globalThis as {
      fetch?: typeof globalThis.fetch | undefined;
    };
    const original = globalWithFetch.fetch;
    delete globalWithFetch.fetch;
    try {
      expect(() => createHttpWorkspaceSyncTransport()).toThrow(Error);
    } finally {
      globalWithFetch.fetch = original;
    }
  });
});

describe("GET /api/v1/workspaces/:id", () => {
  it("encodes the workspace id into the path", async () => {
    const { transport, stub } = transportWith(fetchJson(200, successEnvelope(SNAPSHOT)));

    await transport.getWorkspace("ws/a b?");

    expect(stub.calls[0]?.url).toBe("/api/v1/workspaces/ws%2Fa%20b%3F");
  });

  it("sends Accept and cache no-store", async () => {
    const { transport, stub } = transportWith(fetchJson(200, successEnvelope(SNAPSHOT)));

    await transport.getWorkspace("ws-1");

    expect(stub.calls[0]?.init.method).toBe("GET");
    expect(stub.calls[0]?.init.headers).toMatchObject({ Accept: "application/json" });
    expect(stub.calls[0]?.init.cache).toBe("no-store");
  });

  it("returns the remote workspace on 200", async () => {
    const { transport } = transportWith(fetchJson(200, successEnvelope(SNAPSHOT, 4)));

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({
      ok: true,
      workspace: { snapshot: SNAPSHOT, revision: 4 },
    });
  });

  it("maps 404 + workspace-not-found to not-found", async () => {
    const { transport } = transportWith(
      fetchJson(404, { error: { code: "workspace-not-found" } }),
    );

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("maps 404 with an unexpected error code to protocol-error", async () => {
    const { transport } = transportWith(fetchJson(404, { error: { code: "something-else" } }));

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({ ok: false, reason: "protocol-error", status: 404 });
  });

  it("maps 5xx to server-error with the status", async () => {
    const { transport } = transportWith(fetchJson(503, { error: { code: "unavailable" } }));

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({ ok: false, reason: "server-error", status: 503 });
  });

  it("maps malformed JSON on 200 to protocol-error", async () => {
    const { transport } = transportWith(fetchRaw(200, "{oops"));

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({ ok: false, reason: "protocol-error", status: 200 });
  });

  it("maps a malformed workspace shape on 200 to protocol-error", async () => {
    const { transport } = transportWith(
      fetchJson(200, { workspace: { snapshot: 5, revision: 1, createdAt: 1, updatedAt: 1 } }),
    );

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({ ok: false, reason: "protocol-error", status: 200 });
  });

  it("maps a structurally valid but domain-invalid snapshot to protocol-error", async () => {
    const invalid = { ...SNAPSHOT, name: "   " };
    const { transport } = transportWith(fetchJson(200, successEnvelope(invalid)));

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({ ok: false, reason: "protocol-error", status: 200 });
  });

  it("maps a returned snapshot id mismatch to protocol-error", async () => {
    const other = buildRichSnapshot("ws-other");
    const { transport } = transportWith(fetchJson(200, successEnvelope(other)));

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({ ok: false, reason: "protocol-error", status: 200 });
  });

  it("maps a non-positive revision on 200 to protocol-error", async () => {
    const { transport } = transportWith(fetchJson(200, successEnvelope(SNAPSHOT, 0)));

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({ ok: false, reason: "protocol-error", status: 200 });
  });

  it("maps a negative createdAt on 200 to protocol-error", async () => {
    const { transport } = transportWith(
      fetchJson(200, {
        workspace: { snapshot: SNAPSHOT, revision: 1, createdAt: -1, updatedAt: 1 },
      }),
    );

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({ ok: false, reason: "protocol-error", status: 200 });
  });

  it("maps a fetch rejection to network-error", async () => {
    const { transport } = transportWith(fetchRejecting());

    const result = await transport.getWorkspace("ws-1");

    expect(result).toEqual({ ok: false, reason: "network-error" });
  });
});

describe("POST /api/v1/workspaces", () => {
  it("sends the snapshot as JSON with Content-Type and Accept", async () => {
    const { transport, stub } = transportWith(fetchJson(201, successEnvelope(SNAPSHOT)));

    await transport.createWorkspace(SNAPSHOT);

    expect(stub.calls[0]?.url).toBe("/api/v1/workspaces");
    expect(stub.calls[0]?.init.method).toBe("POST");
    expect(stub.calls[0]?.init.headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(JSON.parse(String(stub.calls[0]?.init.body))).toEqual({ snapshot: SNAPSHOT });
  });

  it("returns the created workspace on 201", async () => {
    const { transport } = transportWith(fetchJson(201, successEnvelope(SNAPSHOT, 1)));

    const result = await transport.createWorkspace(SNAPSHOT);

    expect(result).toEqual({ ok: true, workspace: { snapshot: SNAPSHOT, revision: 1 } });
  });

  it("maps 409 + workspace-already-exists to already-exists", async () => {
    const { transport } = transportWith(
      fetchJson(409, { error: { code: "workspace-already-exists" } }),
    );

    const result = await transport.createWorkspace(SNAPSHOT);

    expect(result).toEqual({ ok: false, reason: "already-exists" });
  });

  it("maps 409 with a different error code to protocol-error", async () => {
    const { transport } = transportWith(fetchJson(409, { error: { code: "revision-conflict" } }));

    const result = await transport.createWorkspace(SNAPSHOT);

    expect(result).toEqual({ ok: false, reason: "protocol-error", status: 409 });
  });

  it("maps 422 + invalid-workspace to invalid-workspace", async () => {
    const { transport } = transportWith(
      fetchJson(422, { error: { code: "invalid-workspace", issues: [] } }),
    );

    const result = await transport.createWorkspace(SNAPSHOT);

    expect(result).toEqual({ ok: false, reason: "invalid-workspace" });
  });

  it("maps a malformed 201 body to protocol-error", async () => {
    const { transport } = transportWith(fetchRaw(201, "not json"));

    const result = await transport.createWorkspace(SNAPSHOT);

    expect(result).toEqual({ ok: false, reason: "protocol-error", status: 201 });
  });

  it("maps a fetch rejection to network-error", async () => {
    const { transport } = transportWith(fetchRejecting());

    const result = await transport.createWorkspace(SNAPSHOT);

    expect(result).toEqual({ ok: false, reason: "network-error" });
  });
});

describe("PUT /api/v1/workspaces/:id", () => {
  it("rejects a non-positive-safe-integer expectedRevision with RangeError before any request", async () => {
    const { transport, stub } = transportWith(fetchJson(200, successEnvelope(SNAPSHOT)));

    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(transport.saveWorkspace(SNAPSHOT, bad)).rejects.toThrow(RangeError);
    }
    expect(stub.calls).toHaveLength(0);
  });

  it("sends snapshot and expectedRevision as JSON", async () => {
    const { transport, stub } = transportWith(fetchJson(200, successEnvelope(SNAPSHOT, 2)));

    await transport.saveWorkspace(SNAPSHOT, 2);

    expect(stub.calls[0]?.url).toBe("/api/v1/workspaces/ws-1");
    expect(stub.calls[0]?.init.method).toBe("PUT");
    expect(JSON.parse(String(stub.calls[0]?.init.body))).toEqual({
      snapshot: SNAPSHOT,
      expectedRevision: 2,
    });
  });

  it("returns the saved workspace on 200", async () => {
    const { transport } = transportWith(fetchJson(200, successEnvelope(SNAPSHOT, 3)));

    const result = await transport.saveWorkspace(SNAPSHOT, 2);

    expect(result).toEqual({ ok: true, workspace: { snapshot: SNAPSHOT, revision: 3 } });
  });

  it("maps 404 + workspace-not-found to not-found", async () => {
    const { transport } = transportWith(
      fetchJson(404, { error: { code: "workspace-not-found" } }),
    );

    const result = await transport.saveWorkspace(SNAPSHOT, 2);

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("maps 409 + revision-conflict to revision-conflict with actualRevision", async () => {
    const { transport } = transportWith(
      fetchJson(409, { error: { code: "revision-conflict", actualRevision: 7 } }),
    );

    const result = await transport.saveWorkspace(SNAPSHOT, 2);

    expect(result).toEqual({ ok: false, reason: "revision-conflict", actualRevision: 7 });
  });

  it("maps 409 + revision-conflict with an illegal actualRevision to protocol-error", async () => {
    for (const bad of ["3", 0, 1.5, null]) {
      const { transport } = transportWith(
        fetchJson(409, { error: { code: "revision-conflict", actualRevision: bad } }),
      );

      const result = await transport.saveWorkspace(SNAPSHOT, 2);

      expect(result).toEqual({ ok: false, reason: "protocol-error", status: 409 });
    }
  });

  it("maps 422 + invalid-workspace to invalid-workspace", async () => {
    const { transport } = transportWith(
      fetchJson(422, { error: { code: "invalid-workspace", issues: [] } }),
    );

    const result = await transport.saveWorkspace(SNAPSHOT, 2);

    expect(result).toEqual({ ok: false, reason: "invalid-workspace" });
  });

  it("maps 5xx to server-error with the status", async () => {
    const { transport } = transportWith(fetchJson(500, { error: { code: "boom" } }));

    const result = await transport.saveWorkspace(SNAPSHOT, 2);

    expect(result).toEqual({ ok: false, reason: "server-error", status: 500 });
  });

  it("maps a fetch rejection to network-error", async () => {
    const { transport } = transportWith(fetchRejecting());

    const result = await transport.saveWorkspace(SNAPSHOT, 2);

    expect(result).toEqual({ ok: false, reason: "network-error" });
  });
});
