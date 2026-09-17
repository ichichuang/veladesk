/**
 * Shared helpers for @veladesk/sync tests.
 *
 * Coordinator tests run against the REAL @veladesk/local-store over
 * fake-indexeddb — no store fakes — so the coordinator's interaction with
 * the local Dexie state machine is genuinely exercised. Every test
 * database gets a unique name and is deleted again in cleanup.
 */

import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceId, WorkspaceSnapshot } from "@veladesk/domain";
import { openLocalWorkspaceStore } from "@veladesk/local-store";
import type { LocalWorkspaceStore } from "@veladesk/local-store";
import { indexedDB as fakeIndexedDB, IDBKeyRange } from "fake-indexeddb";
import type {
  CreateRemoteWorkspaceResult,
  GetRemoteWorkspaceResult,
  ListRemoteWorkspacesResult,
  SaveRemoteWorkspaceResult,
  WorkspaceSyncTransport,
} from "./types";

export { fakeIndexedDB, IDBKeyRange };

let databaseSequence = 0;
const openStores: LocalWorkspaceStore[] = [];
const usedDatabaseNames: string[] = [];

/** Next unique test database name (never reused across tests). */
export function nextDatabaseName(prefix = "veladesk-sync-test"): string {
  databaseSequence += 1;
  return `${prefix}-${databaseSequence}`;
}

/** Open a real local-store backed by fake-indexeddb with a unique name. */
export async function openTestStore(options: { readonly now?: () => number } = {}): Promise<LocalWorkspaceStore> {
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

/**
 * Domain-valid snapshot with apps, a folder, a widget (nested JSON config),
 * a category, layout items and dock pins — rich enough to exercise every
 * transport decode and equality branch.
 */
export function buildRichSnapshot(id: WorkspaceId): WorkspaceSnapshot {
  const pageId = `${id}-page`;
  return {
    id,
    name: "Rich Desk",
    pages: [
      {
        id: pageId,
        name: "Home",
        layout: {
          id: pageId,
          grid: { columns: 12, rows: 8 },
          items: [
            {
              id: `${id}-app-2`,
              position: { column: 0, row: 0 },
              span: { columns: 2, rows: 1 },
            },
            {
              id: `${id}-folder`,
              position: { column: 2, row: 0 },
              span: { columns: 2, rows: 1 },
            },
            {
              id: `${id}-widget`,
              position: { column: 4, row: 0 },
              span: { columns: 4, rows: 2 },
            },
          ],
        },
      },
    ],
    entities: [
      {
        kind: "app",
        id: `${id}-app-1`,
        name: "Obsidian",
        url: "obsidian://open?vault=Notes",
        description: "Notes vault",
        icon: { kind: "generated", text: "OB" },
        openMode: "new-tab",
        categoryId: `${id}-cat`,
        tags: ["notes", "writing"],
      },
      {
        kind: "app",
        id: `${id}-app-2`,
        name: "Docs",
        url: "https://docs.example.com",
        icon: { kind: "favicon" },
        openMode: "same-tab",
        tags: [],
      },
      {
        kind: "folder",
        id: `${id}-folder`,
        name: "Work",
        children: [`${id}-app-1`],
      },
      {
        kind: "widget",
        id: `${id}-widget`,
        widgetType: "plugin.example.weather",
        title: "Weather",
        config: {
          city: "Shanghai",
          options: { units: "metric", days: [1, 2, 3], extended: true },
          source: null,
        },
      },
    ],
    categories: [{ id: `${id}-cat`, name: "Notes" }],
    dock: { items: [`${id}-app-1`] },
    preferences: { defaultPageId: pageId, layoutLocked: true },
  };
}
