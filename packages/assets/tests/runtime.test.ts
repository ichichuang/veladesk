import { afterEach, describe, expect, it } from "vitest";

import { closeTestAssetStores, makePngBlob, openTestAssetStore } from "./test-support";
import { makePngBlob as _unusedPng, openRuntime, trueRecord } from "./runtime-test-support";
import type { AssetRecordInput } from "./runtime-test-support";

void _unusedPng;

afterEach(async () => {
  await closeTestAssetStores();
});

/** A pending stage whose record truly hashes to its id. */
async function stageSeed(runtime: Awaited<ReturnType<typeof openRuntime>>["runtime"], seed: number): Promise<string> {
  const input = await trueRecord(seed);
  const result = await runtime.stageAsset(input.blob);
  if (!result.ok) {
    throw new Error("fixture stage failed");
  }
  return input.id;
}

const record = (input: AssetRecordInput): AssetRecordInput => input;

describe("asset runtime: syncAsset", () => {
  it("syncs a pending asset: PUT then ack (record clean, outbox empty)", async () => {
    const { runtime, transport } = await openRuntime();
    const id = await stageSeed(runtime, 1);

    const result = await runtime.syncAsset(id);

    expect(result).toEqual({ ok: true, status: "synced" });
    expect(transport.puts.map((put) => put.id)).toEqual([id]);
    expect((await runtime.getLocalAsset(id))?.syncState).toBe("clean");
    expect(await runtime.flushOutbox()).toEqual([]);
  });

  it("singleflights concurrent syncs of the same asset into ONE PUT", async () => {
    const { runtime, transport } = await openRuntime({ putDelayMs: 25 });
    const id = await stageSeed(runtime, 2);

    const [a, b, c] = await Promise.all([
      runtime.syncAsset(id),
      runtime.syncAsset(id),
      runtime.syncAsset(id),
    ]);

    expect(a).toEqual({ ok: true, status: "synced" });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(transport.puts).toHaveLength(1);
  });

  it("keeps the record pending on network failure", async () => {
    const { runtime } = await openRuntime({ fail: "network-error" });
    const id = await stageSeed(runtime, 3);

    expect(await runtime.syncAsset(id)).toEqual({ ok: false, reason: "network-error" });
    expect((await runtime.getLocalAsset(id))?.syncState).toBe("pending");
    expect((await runtime.flushOutbox()).length).toBe(1);
  });

  it("keeps pending on server errors", async () => {
    const { runtime } = await openRuntime({ fail: "server-error" });
    const id = await stageSeed(runtime, 4);

    expect(await runtime.syncAsset(id)).toEqual({ ok: false, reason: "server-error", status: 500 });
    expect((await runtime.getLocalAsset(id))?.syncState).toBe("pending");
  });

  it("keeps pending on protocol errors", async () => {
    const { runtime } = await openRuntime({ fail: "protocol-error" });
    const id = await stageSeed(runtime, 5);

    const protocolFailure = await runtime.syncAsset(id);
    expect(!protocolFailure.ok && protocolFailure.reason === "protocol-error").toBe(true);
    expect((await runtime.getLocalAsset(id))?.syncState).toBe("pending");
  });

  it("flushes one pass over the snapshot, in deterministic queued order", async () => {
    const { runtime, transport } = await openRuntime();
    // Stage B first (older queuedAt), then A.
    const idB = await stageSeed(runtime, 7);
    const idA = await stageSeed(runtime, 6);

    const results = await runtime.flushOutbox();

    expect(results.map((entry) => entry.assetId)).toEqual([idB, idA]);
    expect(results.every((entry) => entry.result.ok)).toBe(true);
    expect(transport.puts.map((put) => put.id)).toEqual([idB, idA]);
  });

  it("reports a missing-asset invariant without creating anything", async () => {
    const { runtime, transport } = await openRuntime();
    const ghost = (await trueRecord(8)).id;

    expect(await runtime.syncAsset(ghost)).toEqual({ ok: false, reason: "asset-missing" });
    expect(transport.puts).toHaveLength(0);
  });
});

describe("asset runtime: loadAsset", () => {
  it("serves a local hit with zero network", async () => {
    const { runtime, transport } = await openRuntime();
    const id = await stageSeed(runtime, 9);

    const result = await runtime.loadAsset(id);

    expect(result).toMatchObject({ ok: true, source: "local" });
    expect(transport.gets).toHaveLength(0);
  });

  it("fetches and hydrates a remote miss, then hits locally afterwards", async () => {
    const { runtime, transport } = await openRuntime();
    const remote = await trueRecord(10);
    transport.remoteAssets.set(remote.id, record(remote));

    const first = await runtime.loadAsset(remote.id);

    expect(first).toMatchObject({ ok: true, source: "remote" });
    expect(transport.gets).toEqual([remote.id]);
    expect((await runtime.getLocalAsset(remote.id))?.syncState).toBe("clean");

    await runtime.loadAsset(remote.id);
    expect(transport.gets).toEqual([remote.id]);
  });

  it("rejects remote bytes whose hash does not match (protocol failure)", async () => {
    const { runtime, transport } = await openRuntime();
    const targetId = (await trueRecord(11)).id;
    const wrongBytes = await trueRecord(99);
    // The remote serves DIFFERENT bytes under this id.
    transport.remoteAssets.set(targetId, record(wrongBytes));

    const result = await runtime.loadAsset(targetId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("protocol-error");
    }
    expect(await runtime.getLocalAsset(targetId)).toBeUndefined();
  });

  it("maps remote 404 to not-found", async () => {
    const { runtime } = await openRuntime();
    const id = (await trueRecord(12)).id;

    expect(await runtime.loadAsset(id)).toEqual({ ok: false, reason: "not-found" });
  });

  it("singleflights concurrent remote misses into ONE GET", async () => {
    const { runtime, transport } = await openRuntime({ getDelayMs: 25 });
    const remote = await trueRecord(13);
    transport.remoteAssets.set(remote.id, record(remote));

    const [a, b] = await Promise.all([runtime.loadAsset(remote.id), runtime.loadAsset(remote.id)]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(transport.gets).toHaveLength(1);
  });
});

describe("asset runtime: ensureRemoteAsset", () => {
  it("pending local → one PUT, then success", async () => {
    const { runtime, transport } = await openRuntime();
    const id = await stageSeed(runtime, 14);

    expect(await runtime.ensureRemoteAsset(id)).toEqual({ ok: true });
    expect(transport.puts.map((put) => put.id)).toEqual([id]);
  });

  it("clean local → success with zero network", async () => {
    const { runtime, transport } = await openRuntime();
    const id = await stageSeed(runtime, 15);
    await runtime.syncAsset(id);
    transport.puts.length = 0;

    expect(await runtime.ensureRemoteAsset(id)).toEqual({ ok: true });
    expect(transport.puts).toHaveLength(0);
    expect(transport.heads).toHaveLength(0);
  });

  it("missing local → HEAD probe (200 success / 404 asset-missing)", async () => {
    const { runtime, transport } = await openRuntime();
    const present = await trueRecord(16);
    transport.remoteAssets.set(present.id, record(present));
    const absent = (await trueRecord(17)).id;

    expect(await runtime.ensureRemoteAsset(present.id)).toEqual({ ok: true });
    expect(transport.heads).toEqual([present.id]);
    expect(await runtime.ensureRemoteAsset(absent)).toEqual({ ok: false, reason: "asset-missing" });
  });

  it("propagates network failure from the HEAD probe", async () => {
    const { runtime } = await openRuntime({ fail: "network-error" });
    const id = (await trueRecord(18)).id;

    expect(await runtime.ensureRemoteAsset(id)).toEqual({ ok: false, reason: "network-error" });
  });
});

describe("asset runtime: stageAsset validation", () => {
  it("rejects unsupported uploads before anything is staged", async () => {
    const { runtime } = await openRuntime();
    const svg = new Blob([new TextEncoder().encode("<svg/>")], { type: "image/svg+xml" });

    expect(await runtime.stageAsset(svg)).toEqual({ ok: false, reason: "unsupported-image-type" });
    expect(await runtime.flushOutbox()).toEqual([]);
  });

  it("stages identical uploads onto the same record (same id)", async () => {
    const { runtime } = await openRuntime();
    const blob = makePngBlob(20);
    const first = await runtime.stageAsset(blob);
    const second = await runtime.stageAsset(blob);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.record.id).toBe(first.record.id);
      expect(second.status === "pending" || second.status === "staged").toBe(true);
    }
    expect(await openTestAssetStore()).toBeDefined();
  });
});
