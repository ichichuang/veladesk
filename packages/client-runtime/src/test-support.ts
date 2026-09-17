/**
 * Shared helpers for @veladesk/client-runtime tests.
 *
 * Runtime tests run against the REAL @veladesk/local-store over
 * fake-indexeddb — no store fakes — so bootstrap genuinely exercises the
 * Dexie state machine. The transport is faked. Every test database gets a
 * unique name and is deleted again in cleanup.
 */

import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceId, WorkspaceSnapshot } from "@veladesk/domain";
import { openLocalWorkspaceStore } from "@veladesk/local-store";
import type { LocalWorkspaceStore } from "@veladesk/local-store";
import type {
  CreateRemoteWorkspaceResult,
  GetRemoteWorkspaceResult,
  ListRemoteWorkspacesResult,
  SaveRemoteWorkspaceResult,
  WorkspaceSyncTransport,
} from "@veladesk/sync";
import { indexedDB as fakeIndexedDB, IDBKeyRange } from "fake-indexeddb";

export { fakeIndexedDB, IDBKeyRange };

let databaseSequence = 0;
const openStores: LocalWorkspaceStore[] = [];
const usedDatabaseNames: string[] = [];

/** Next unique test database name (never reused across tests). */
export function nextDatabaseName(prefix = "veladesk-client-runtime-test"): string {
  databaseSequence += 1;
  return `${prefix}-${databaseSequence}`;
}

/** Open a real local-store backed by fake-indexeddb with a unique name. */
export async function openTestStore(
  options: { readonly now?: () => number } = {}
): Promise<LocalWorkspaceStore> {
  const databaseName = nextDatabaseName();
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
export async function cleanupTestStores(): Promise<void> {
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

/** A promise whose resolution is controlled by the test. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/** Create a deferred promise for gating transport responses in tests. */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deterministic controllable clock. */
export interface ManualClock {
  now(): number;
  advance(ms: number): void;
}

/** Create a clock whose value only moves on explicit `advance`. */
export function manualClock(initialMs = 1_000): ManualClock {
  let current = initialMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** Build a domain-valid empty workspace snapshot for tests. */
export function buildTestSnapshot(id: WorkspaceId, name = "Test Desk"): WorkspaceSnapshot {
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

/** Remote catalog success for one or more summaries. */
export function listOk(...summaries: { id: string; name: string; revision: number }[]): ListRemoteWorkspacesResult {
  return { ok: true, workspaces: summaries };
}

/** Remote single-workspace success. */
export function remoteOk(snapshot: WorkspaceSnapshot, revision: number): GetRemoteWorkspaceResult {
  return { ok: true, workspace: { snapshot, revision } };
}

/**
 * Test transport recording every call. Handlers must be installed per
 * test; an uninstalled call is a test bug and fails loudly.
 */
export class FakeWorkspaceSyncTransport implements WorkspaceSyncTransport {
  readonly listCalls: number[] = [];
  readonly getCalls: WorkspaceId[] = [];
  readonly createCalls: { readonly snapshot: WorkspaceSnapshot }[] = [];
  readonly saveCalls: {
    readonly snapshot: WorkspaceSnapshot;
    readonly expectedRevision: number;
  }[] = [];

  listWorkspacesHandler: () => ListRemoteWorkspacesResult | Promise<ListRemoteWorkspacesResult> =
    () => Promise.reject(new Error("unexpected listWorkspaces call"));

  getWorkspaceHandler: (
    workspaceId: WorkspaceId
  ) => GetRemoteWorkspaceResult | Promise<GetRemoteWorkspaceResult> = () =>
    Promise.reject(new Error("unexpected getWorkspace call"));

  createWorkspaceHandler: (
    snapshot: WorkspaceSnapshot
  ) => CreateRemoteWorkspaceResult | Promise<CreateRemoteWorkspaceResult> = () =>
    Promise.reject(new Error("unexpected createWorkspace call"));

  saveWorkspaceHandler: (
    snapshot: WorkspaceSnapshot,
    expectedRevision: number
  ) => SaveRemoteWorkspaceResult | Promise<SaveRemoteWorkspaceResult> = () =>
    Promise.reject(new Error("unexpected saveWorkspace call"));

  async listWorkspaces(): Promise<ListRemoteWorkspacesResult> {
    this.listCalls.push(this.listCalls.length + 1);
    return this.listWorkspacesHandler();
  }

  async getWorkspace(workspaceId: WorkspaceId): Promise<GetRemoteWorkspaceResult> {
    this.getCalls.push(workspaceId);
    return this.getWorkspaceHandler(workspaceId);
  }

  async createWorkspace(snapshot: WorkspaceSnapshot): Promise<CreateRemoteWorkspaceResult> {
    this.createCalls.push({ snapshot });
    return this.createWorkspaceHandler(snapshot);
  }

  async saveWorkspace(
    snapshot: WorkspaceSnapshot,
    expectedRevision: number
  ): Promise<SaveRemoteWorkspaceResult> {
    this.saveCalls.push({ snapshot, expectedRevision });
    return this.saveWorkspaceHandler(snapshot, expectedRevision);
  }
}
