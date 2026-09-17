import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import {
  FakeWorkspaceSyncTransport,
  buildTestSnapshot,
  cleanupTestStores,
  deferred,
  manualClock,
  openTestStore,
  renamedSnapshot,
} from "./test-support";
import { createWorkspaceSyncCoordinator } from "./coordinator";
import type { CreateRemoteWorkspaceResult, SaveRemoteWorkspaceResult } from "./types";

afterEach(async () => {
  await cleanupTestStores();
});

function createOk(snapshot: WorkspaceSnapshot, revision: number): CreateRemoteWorkspaceResult {
  return { ok: true, workspace: { snapshot, revision } };
}

function saveOk(snapshot: WorkspaceSnapshot, revision: number): SaveRemoteWorkspaceResult {
  return { ok: true, workspace: { snapshot, revision } };
}

describe("syncWorkspace — idle", () => {
  it("returns idle without any network request when the outbox is empty", async () => {
    const store = await openTestStore();
    const fake = new FakeWorkspaceSyncTransport();
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-missing");

    expect(result).toEqual({ status: "idle", workspaceId: "ws-missing" });
    expect(fake.getCalls).toHaveLength(0);
    expect(fake.createCalls).toHaveLength(0);
    expect(fake.saveCalls).toHaveLength(0);
  });
});

describe("syncWorkspace — normal create/save", () => {
  it("syncs a pending create: clean local copy at the server revision", async () => {
    const clock = manualClock(10_000);
    const store = await openTestStore({ now: clock.now });
    const local = buildTestSnapshot("ws-create", "Local Name");
    await store.stageWorkspaceCreate(local);
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => createOk(local, 1);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });
    clock.advance(50);

    const result = await coordinator.syncWorkspace("ws-create");

    expect(result).toEqual({ status: "synced", workspaceId: "ws-create", serverRevision: 1 });
    expect(fake.createCalls).toEqual([{ snapshot: local }]);
    const record = await store.getWorkspace("ws-create");
    expect(record?.syncState).toBe("clean");
    expect(record?.serverRevision).toBe(1);
    expect(record?.localGeneration).toBe(1);
    expect(record?.lastSyncedAt).toBe(10_050);
    expect(await store.getOutboxEntry("ws-create")).toBeUndefined();
  });

  it("syncs a pending save with the captured base revision: clean at the new revision", async () => {
    const store = await openTestStore();
    await store.hydrateWorkspaceFromServer(buildTestSnapshot("ws-save"), 2);
    const edited = renamedSnapshot(buildTestSnapshot("ws-save"), "Edited");
    await store.stageWorkspaceUpdate(edited);
    const fake = new FakeWorkspaceSyncTransport();
    fake.saveWorkspaceHandler = () => saveOk(edited, 3);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-save");

    expect(result).toEqual({ status: "synced", workspaceId: "ws-save", serverRevision: 3 });
    expect(fake.saveCalls).toEqual([{ snapshot: edited, expectedRevision: 2 }]);
    const record = await store.getWorkspace("ws-save");
    expect(record?.syncState).toBe("clean");
    expect(record?.serverRevision).toBe(3);
    expect(await store.getOutboxEntry("ws-save")).toBeUndefined();
  });
});

describe("syncWorkspace — in-flight local edits", () => {
  it("keeps a newer local edit on create: pending with a rebased save outbox", async () => {
    const clock = manualClock(20_000);
    const store = await openTestStore({ now: clock.now });
    const v1 = buildTestSnapshot("ws-flight", "v1");
    await store.stageWorkspaceCreate(v1); // generation 1 captured by the request
    const gate = deferred<CreateRemoteWorkspaceResult>();
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => gate.promise;
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });
    const syncPromise = coordinator.syncWorkspace("ws-flight");
    await vi.waitFor(() => expect(fake.createCalls).toHaveLength(1));

    clock.advance(10);
    const v2 = renamedSnapshot(v1, "v2");
    await store.stageWorkspaceUpdate(v2); // generation 2 while request in flight

    clock.advance(10);
    gate.resolve(createOk(v1, 1));
    const result = await syncPromise;

    expect(result).toEqual({ status: "pending", workspaceId: "ws-flight", serverRevision: 1 });
    const record = await store.getWorkspace("ws-flight");
    expect(record?.snapshot).toEqual(v2);
    expect(record?.localGeneration).toBe(2);
    expect(record?.serverRevision).toBe(1);
    expect(record?.syncState).toBe("dirty");
    const outbox = await store.getOutboxEntry("ws-flight");
    expect(outbox?.operation).toBe("save");
    expect(outbox?.baseRevision).toBe(1);
    expect(outbox?.snapshot).toEqual(v2);
    expect(outbox?.localGeneration).toBe(2);
    expect(outbox?.queuedAt).toBe(20_000);
  });

  it("keeps a newer local edit on save: pending with the outbox rebased onto the new revision", async () => {
    const clock = manualClock(30_000);
    const store = await openTestStore({ now: clock.now });
    const base = buildTestSnapshot("ws-flight2");
    await store.hydrateWorkspaceFromServer(base, 2);
    const e1 = renamedSnapshot(base, "e1");
    await store.stageWorkspaceUpdate(e1); // generation 1 captured by the request
    const gate = deferred<SaveRemoteWorkspaceResult>();
    const fake = new FakeWorkspaceSyncTransport();
    fake.saveWorkspaceHandler = () => gate.promise;
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });
    const syncPromise = coordinator.syncWorkspace("ws-flight2");
    await vi.waitFor(() => expect(fake.saveCalls).toHaveLength(1));

    clock.advance(10);
    const e2 = renamedSnapshot(base, "e2");
    await store.stageWorkspaceUpdate(e2); // generation 2 while request in flight

    clock.advance(10);
    gate.resolve(saveOk(e1, 3));
    const result = await syncPromise;

    expect(result).toEqual({ status: "pending", workspaceId: "ws-flight2", serverRevision: 3 });
    const record = await store.getWorkspace("ws-flight2");
    expect(record?.snapshot).toEqual(e2);
    expect(record?.localGeneration).toBe(2);
    expect(record?.serverRevision).toBe(3);
    const outbox = await store.getOutboxEntry("ws-flight2");
    expect(outbox?.operation).toBe("save");
    expect(outbox?.baseRevision).toBe(3);
    expect(outbox?.snapshot).toEqual(e2);
  });
});

describe("syncWorkspace — same-process single-flight", () => {
  it("reuses the in-flight promise: one network mutation, identical results, cleaned up after", async () => {
    const store = await openTestStore();
    const local = buildTestSnapshot("ws-single");
    await store.stageWorkspaceCreate(local);
    const gate = deferred<CreateRemoteWorkspaceResult>();
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => gate.promise;
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const first = coordinator.syncWorkspace("ws-single");
    await vi.waitFor(() => expect(fake.createCalls).toHaveLength(1));
    const second = coordinator.syncWorkspace("ws-single");
    expect(second).toBe(first);

    gate.resolve(createOk(local, 1));
    const results = await Promise.all([first, second]);
    expect(results).toEqual([
      { status: "synced", workspaceId: "ws-single", serverRevision: 1 },
      { status: "synced", workspaceId: "ws-single", serverRevision: 1 },
    ]);
    expect(fake.createCalls).toHaveLength(1);

    const third = await coordinator.syncWorkspace("ws-single");
    expect(third).toEqual({ status: "idle", workspaceId: "ws-single" });
    expect(fake.createCalls).toHaveLength(1);
  });

  it("does not serialize different workspaces against each other", async () => {
    const store = await openTestStore();
    const a = buildTestSnapshot("ws-a");
    const b = buildTestSnapshot("ws-b");
    await store.stageWorkspaceCreate(a);
    await store.stageWorkspaceCreate(b);
    const gateA = deferred<CreateRemoteWorkspaceResult>();
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = (snapshot) =>
      snapshot.id === "ws-a" ? gateA.promise : Promise.resolve(createOk(b, 1));
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const syncA = coordinator.syncWorkspace("ws-a");
    const syncB = coordinator.syncWorkspace("ws-b");
    await vi.waitFor(() => expect(fake.createCalls).toHaveLength(2));

    gateA.resolve(createOk(a, 1));
    expect((await syncB).status).toBe("synced");
    expect((await syncA).status).toBe("synced");
  });
});

describe("syncWorkspace — failures preserve the outbox", () => {
  it("maps a network failure and keeps the create outbox", async () => {
    const store = await openTestStore();
    const local = buildTestSnapshot("ws-net");
    await store.stageWorkspaceCreate(local);
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "network-error" });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-net");

    expect(result).toEqual({ status: "network-error", workspaceId: "ws-net" });
    expect(await store.getOutboxEntry("ws-net")).toBeDefined();
    expect((await store.getWorkspace("ws-net"))?.syncState).toBe("dirty");
  });

  it("maps a server failure with its HTTP status and keeps the save outbox", async () => {
    const store = await openTestStore();
    await store.hydrateWorkspaceFromServer(buildTestSnapshot("ws-5xx"), 2);
    await store.stageWorkspaceUpdate(renamedSnapshot(buildTestSnapshot("ws-5xx"), "Edited"));
    const fake = new FakeWorkspaceSyncTransport();
    fake.saveWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "server-error", status: 503 });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-5xx");

    expect(result).toEqual({ status: "server-error", workspaceId: "ws-5xx", httpStatus: 503 });
    expect(await store.getOutboxEntry("ws-5xx")).toBeDefined();
  });

  it("maps a 422 invalid-workspace to server-rejected and keeps the outbox", async () => {
    const store = await openTestStore();
    const local = buildTestSnapshot("ws-422");
    await store.stageWorkspaceCreate(local);
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "invalid-workspace" });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-422");

    expect(result).toEqual({ status: "server-rejected", workspaceId: "ws-422" });
    expect(await store.getOutboxEntry("ws-422")).toBeDefined();
    expect(await store.getWorkspace("ws-422")).toBeDefined();
  });

  it("maps a save 404 to server-missing without auto-recreating", async () => {
    const store = await openTestStore();
    await store.hydrateWorkspaceFromServer(buildTestSnapshot("ws-404"), 2);
    await store.stageWorkspaceUpdate(renamedSnapshot(buildTestSnapshot("ws-404"), "Edited"));
    const fake = new FakeWorkspaceSyncTransport();
    fake.saveWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "not-found" });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-404");

    expect(result).toEqual({ status: "server-missing", workspaceId: "ws-404" });
    expect(fake.createCalls).toHaveLength(0);
    expect(await store.getOutboxEntry("ws-404")).toBeDefined();
  });

  it("maps a protocol failure and keeps the outbox", async () => {
    const store = await openTestStore();
    const local = buildTestSnapshot("ws-proto");
    await store.stageWorkspaceCreate(local);
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () =>
      Promise.resolve({ ok: false, reason: "protocol-error", status: 200 });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-proto");

    expect(result).toEqual({ status: "protocol-error", workspaceId: "ws-proto", httpStatus: 200 });
    expect(await store.getOutboxEntry("ws-proto")).toBeDefined();
  });
});

describe("syncWorkspace — superseded acknowledgements", () => {
  it("maps a stale-server-revision acknowledgement to superseded without touching data", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-super");
    await store.hydrateWorkspaceFromServer(base, 2);
    await store.stageWorkspaceUpdate(renamedSnapshot(base, "Edited"));
    const fake = new FakeWorkspaceSyncTransport();
    // A save "succeeding" at the revision the client already knows is a
    // server-side anomaly; the store's generation/revision guards must win.
    fake.saveWorkspaceHandler = () =>
      saveOk(renamedSnapshot(base, "Edited"), 2);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-super");

    expect(result).toEqual({ status: "superseded", workspaceId: "ws-super" });
    expect(await store.getOutboxEntry("ws-super")).toBeDefined();
    expect((await store.getWorkspace("ws-super"))?.snapshot.name).toBe("Edited");
  });
});
