/**
 * Shared helpers for @veladesk/local-store tests.
 *
 * Tests run in Node against fake-indexeddb through Dexie's official
 * indexedDB/IDBKeyRange injection. Every test database gets a unique name
 * and is deleted again in cleanup, so tests never pollute each other.
 */

import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceId, WorkspaceSnapshot } from "@veladesk/domain";
import { indexedDB as fakeIndexedDB, IDBKeyRange } from "fake-indexeddb";

import { VelaDeskLocalDatabase } from "./database";
import { openLocalWorkspaceStore } from "./store";
import type { LocalWorkspaceRecord, LocalWorkspaceStore } from "./types";

let databaseSequence = 0;
const openStores: LocalWorkspaceStore[] = [];
const usedDatabaseNames: string[] = [];

/** Next unique test database name (never reused across tests). */
export function nextDatabaseName(prefix = "veladesk-local-store-test"): string {
  databaseSequence += 1;
  return `${prefix}-${databaseSequence}`;
}

/** Open a test store backed by fake-indexeddb with a unique database name. */
export async function openTestStore(options: {
  readonly databaseName?: string;
  readonly now?: () => number;
} = {}): Promise<LocalWorkspaceStore> {
  const databaseName = options.databaseName ?? nextDatabaseName();
  const store = await openLocalWorkspaceStore({
    databaseName,
    ...(options.now !== undefined ? { now: options.now } : {}),
    indexedDB: fakeIndexedDB,
    IDBKeyRange,
  });
  openStores.push(store);
  usedDatabaseNames.push(databaseName);
  return store;
}

/** Close and delete every database opened through {@link openTestStore}. */
export async function cleanupLocalStores(): Promise<void> {
  for (const store of openStores) {
    store.close();
  }
  openStores.length = 0;
  const names = [...usedDatabaseNames];
  usedDatabaseNames.length = 0;
  await Promise.all(names.map((name) => deleteFakeDatabase(name)));
}

function deleteFakeDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`failed to delete database ${name}`));
    request.onblocked = () => resolve();
  });
}

/** Deterministic controllable clock that also counts its reads. */
export interface ManualClock {
  now(): number;
  advance(ms: number): void;
  reads(): number;
}

/** Create a clock whose value only moves on explicit `advance`. */
export function manualClock(initialMs = 1_000): ManualClock {
  let current = initialMs;
  let reads = 0;
  return {
    now: () => {
      reads += 1;
      return current;
    },
    advance: (ms: number) => {
      current += ms;
    },
    reads: () => reads,
  };
}

/** Build a domain-valid empty workspace snapshot for tests. */
export function buildSnapshot(id: WorkspaceId, name = "Test Desk"): WorkspaceSnapshot {
  return createEmptyWorkspace({
    workspaceId: id,
    workspaceName: name,
    pageId: `${id}-page`,
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  });
}

/** Same snapshot with a different workspace name (a local edit). */
export function renamedSnapshot(snapshot: WorkspaceSnapshot, name: string): WorkspaceSnapshot {
  return { ...snapshot, name };
}

/**
 * White-box seeding of a working-copy record, for states unreachable
 * through the public API alone (e.g. generation overflow). The target
 * database must not be held open by a store at call time.
 */
export async function seedWorkspaceRecord(
  databaseName: string,
  record: LocalWorkspaceRecord
): Promise<void> {
  const db = new VelaDeskLocalDatabase(databaseName, {
    indexedDB: fakeIndexedDB,
    IDBKeyRange,
  });
  try {
    await db.workspaceCopies.put(record);
  } finally {
    db.close();
  }
}

export { fakeIndexedDB, IDBKeyRange };
