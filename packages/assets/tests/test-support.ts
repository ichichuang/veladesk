/**
 * Shared helpers for @veladesk/assets tests.
 *
 * Tests run in Node against fake-indexeddb through Dexie's official
 * indexedDB/IDBKeyRange injection. Every test database gets a unique name
 * and is closed in cleanup.
 */

import { indexedDB as fakeIndexedDB, IDBKeyRange } from "fake-indexeddb";

import { createContentAssetId } from "../src/core";
import { openAssetStore } from "../src/browser";
import type { AssetStore } from "../src/browser";

let databaseSequence = 0;
const openStores: AssetStore[] = [];

/** Next unique test database name (never reused across tests). */
export function nextAssetDatabaseName(prefix = "veladesk-assets-test"): string {
  databaseSequence += 1;
  return `${prefix}-${databaseSequence}`;
}

/** Opens a test store backed by fake-indexeddb with a unique database name. */
export async function openTestAssetStore(options: {
  readonly databaseName?: string;
  readonly now?: () => number;
} = {}): Promise<AssetStore> {
  const store = await openAssetStore({
    databaseName: options.databaseName ?? nextAssetDatabaseName(),
    ...(options.now !== undefined ? { now: options.now } : {}),
    indexedDB: fakeIndexedDB,
    IDBKeyRange,
  });
  openStores.push(store);
  return store;
}

/** A small valid PNG (magic + deterministic filler). */
export function makePngBlob(seed = 1): Blob {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([seed], 16);
  return new Blob([bytes], { type: "image/png" });
}

/** The content id of {@link makePngBlob}'s bytes. */
export async function pngBlobId(seed = 1): Promise<string> {
  const blob = makePngBlob(seed);
  return createContentAssetId(new Uint8Array(await blob.arrayBuffer()));
}

/** Closes every store opened by this test file (vitest afterEach hook). */
export async function closeTestAssetStores(): Promise<void> {
  for (const store of openStores.splice(0)) {
    await store.close();
  }
}
