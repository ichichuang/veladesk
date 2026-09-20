/**
 * Recording asset transport + runtime factory for runtime tests.
 */

import { createAssetRuntime } from "../src/browser";
import type { AssetTransport } from "../src/browser";
import type { ContentAssetId, UploadedAssetMediaType } from "../src/core";

import { makePngBlob, openTestAssetStore, pngBlobId } from "./test-support";

export interface AssetRecordInput {
  readonly id: ContentAssetId;
  readonly blob: Blob;
  readonly mediaType: UploadedAssetMediaType;
  readonly byteLength: number;
}

/** A record whose bytes genuinely hash to its id (hydrate verifies this). */
export async function trueRecord(seed: number): Promise<AssetRecordInput> {
  const blob = makePngBlob(seed);
  return {
    id: await pngBlobId(seed),
    blob,
    mediaType: "image/png",
    byteLength: blob.size,
  };
}

export type ScriptedFailure = "network-error" | "server-error" | "protocol-error";

export interface RecordingTransport extends AssetTransport {
  readonly puts: AssetRecordInput[];
  readonly gets: ContentAssetId[];
  readonly heads: ContentAssetId[];
  /** Assets the fake server already holds (id → record). */
  readonly remoteAssets: Map<ContentAssetId, AssetRecordInput>;
  fail: ScriptedFailure | null;
}

export function makeRecordingTransport(options: {
  readonly putDelayMs?: number;
  readonly getDelayMs?: number;
  readonly fail?: ScriptedFailure | null;
} = {}): RecordingTransport {
  const puts: AssetRecordInput[] = [];
  const gets: ContentAssetId[] = [];
  const heads: ContentAssetId[] = [];
  const remoteAssets = new Map<ContentAssetId, AssetRecordInput>();
  const fail = options.fail ?? null;
  const putDelayMs = options.putDelayMs ?? 0;
  const getDelayMs = options.getDelayMs ?? 0;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  function scriptedFailure():
    | { ok: false; reason: "network-error" }
    | { ok: false; reason: "server-error"; status: number }
    | { ok: false; reason: "protocol-error" }
    | null {
    if (fail === null) {
      return null;
    }
    if (fail === "server-error") {
      return { ok: false, reason: "server-error", status: 500 };
    }
    if (fail === "protocol-error") {
      return { ok: false, reason: "protocol-error" };
    }
    return { ok: false, reason: "network-error" };
  }

  return {
    puts,
    gets,
    heads,
    remoteAssets,
    fail,

    async putAsset(record) {
      puts.push(record);
      if (putDelayMs > 0) {
        await sleep(putDelayMs);
      }
      const failure = scriptedFailure();
      if (failure !== null) {
        return failure;
      }
      const already = puts.filter((put) => put.id === record.id).length > 1;
      remoteAssets.set(record.id, record);
      return {
        ok: true,
        status: already ? "existed" : "stored",
        asset: { id: record.id, mediaType: record.mediaType, byteLength: record.byteLength },
      };
    },

    async getAsset(assetId) {
      gets.push(assetId);
      if (getDelayMs > 0) {
        await sleep(getDelayMs);
      }
      const failure = scriptedFailure();
      if (failure !== null) {
        if (failure.reason === "network-error") {
          return { ok: false, reason: "network-error" };
        }
        if (failure.reason === "server-error") {
          return { ok: false, reason: "server-error", status: 500 };
        }
        return { ok: false, reason: "protocol-error" };
      }
      const record = remoteAssets.get(assetId);
      if (record === undefined) {
        return { ok: false, reason: "not-found" };
      }
      return { ok: true, blob: record.blob, mediaType: record.mediaType };
    },

    async headAsset(assetId) {
      heads.push(assetId);
      const failure = scriptedFailure();
      if (failure !== null) {
        if (failure.reason === "network-error") {
          return { ok: false, reason: "network-error" };
        }
        if (failure.reason === "server-error") {
          return { ok: false, reason: "server-error", status: 500 };
        }
        return { ok: false, reason: "protocol-error" };
      }
      return remoteAssets.has(assetId) ? { ok: true } : { ok: false, reason: "not-found" };
    },
  };
}

export async function openRuntime(
  options: {
    readonly putDelayMs?: number;
    readonly getDelayMs?: number;
    readonly fail?: ScriptedFailure | null;
  } = {}
) {
  const store = await openTestAssetStore();
  const transport = makeRecordingTransport(options);
  const runtime = createAssetRuntime({ store, transport });
  return { runtime, transport, store };
}

export { makePngBlob, pngBlobId };
