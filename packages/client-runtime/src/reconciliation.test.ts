import { afterEach, describe, expect, it } from "vitest";

import { createWorkspaceClientRuntime } from "./runtime";
import {
  FakeWorkspaceSyncTransport,
  buildTestSnapshot,
  cleanupTestStores,
  listOk,
  manualClock,
  openTestStore,
  renamedSnapshot,
} from "./test-support";

afterEach(async () => {
  await cleanupTestStores();
});

describe("startup reconciliation — clean local copy", () => {
  it("pulls a clean local workspace and reflects the refreshed record", async () => {
    const clock = manualClock(10_000);
    const store = await openTestStore({ now: clock.now });
    const localSnapshot = buildTestSnapshot("ws-clean", "Local");
    await store.hydrateWorkspaceFromServer(localSnapshot, 2);
    const fake = new FakeWorkspaceSyncTransport();
    fake.getWorkspaceHandler = () => ({
      ok: true,
      workspace: { snapshot: renamedSnapshot(localSnapshot, "Server Newer"), revision: 5 },
    });
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const state = await runtime.initialize();

    expect(fake.getCalls).toEqual(["ws-clean"]);
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.workspace.snapshot.name).toBe("Server Newer");
      expect(state.workspace.serverRevision).toBe(5);
      expect(state.lastRemoteResult).toEqual({
        status: "hydrated",
        workspaceId: "ws-clean",
        serverRevision: 5,
      });
    }
  });

  it("keeps local data ready when the startup pull hits the network", async () => {
    const store = await openTestStore();
    const localSnapshot = buildTestSnapshot("ws-offline", "Offline Desk");
    await store.hydrateWorkspaceFromServer(localSnapshot, 2);
    const fake = new FakeWorkspaceSyncTransport();
    fake.getWorkspaceHandler = () => ({ ok: false, reason: "network-error" });
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const state = await runtime.initialize();

    // Local-first: an offline start still opens the local desktop, and the
    // failure is reported as the last remote result — never as
    // remote-unavailable.
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.workspace.snapshot).toEqual(localSnapshot);
      expect(state.workspace.serverRevision).toBe(2);
      expect(state.lastRemoteResult).toEqual({
        status: "network-error",
        workspaceId: "ws-offline",
      });
    }
  });
});

describe("startup reconciliation — dirty local copy", () => {
  it("syncs a dirty local workspace and reflects the clean reloaded record", async () => {
    const clock = manualClock(20_000);
    const store = await openTestStore({ now: clock.now });
    const snapshot = buildTestSnapshot("ws-dirty", "v1");
    await store.stageWorkspaceCreate(snapshot);
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => ({
      ok: true,
      workspace: { snapshot, revision: 1 },
    });
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const state = await runtime.initialize();

    expect(fake.createCalls).toHaveLength(1);
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.workspace.syncState).toBe("clean");
      expect(state.workspace.serverRevision).toBe(1);
      expect(state.lastRemoteResult).toEqual({
        status: "synced",
        workspaceId: "ws-dirty",
        serverRevision: 1,
      });
    }
    expect(await store.getOutboxEntry("ws-dirty")).toBeUndefined();
  });

  it("reflects the latest generation after a pending startup sync", async () => {
    const store = await openTestStore();
    const v1 = buildTestSnapshot("ws-pend", "v1");
    await store.stageWorkspaceCreate(v1); // generation 1 sent by startup
    const fake = new FakeWorkspaceSyncTransport();
    // The user (or another tab) edited while the startup request was in
    // flight; the ack keeps the newer local work and reports pending.
    fake.createWorkspaceHandler = async () => {
      await store.stageWorkspaceUpdate(renamedSnapshot(v1, "v2"));
      return { ok: true, workspace: { snapshot: v1, revision: 1 } };
    };
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const state = await runtime.initialize();

    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.workspace.snapshot.name).toBe("v2");
      expect(state.workspace.localGeneration).toBe(2);
      expect(state.workspace.syncState).toBe("dirty");
      expect(state.lastRemoteResult).toEqual({
        status: "pending",
        workspaceId: "ws-pend",
        serverRevision: 1,
      });
    }
  });

  it("reflects a startup sync that resolved into a conflict", async () => {
    const store = await openTestStore();
    const v1 = buildTestSnapshot("ws-sc", "v1");
    await store.stageWorkspaceCreate(v1);
    const fake = new FakeWorkspaceSyncTransport();
    // The offline create already landed on the server from another device;
    // the snapshot there differs, so the 409 recovery marks a conflict.
    fake.createWorkspaceHandler = () => ({ ok: false, reason: "already-exists" });
    fake.getWorkspaceHandler = () => ({
      ok: true,
      workspace: { snapshot: renamedSnapshot(v1, "Server Name"), revision: 3 },
    });
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const state = await runtime.initialize();

    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.workspace.syncState).toBe("conflict");
      expect(state.workspace.conflictRevision).toBe(3);
      expect(state.workspace.snapshot).toEqual(v1);
      expect(state.lastRemoteResult).toEqual({
        status: "conflict",
        workspaceId: "ws-sc",
        actualRevision: 3,
      });
    }
    expect(await store.getOutboxEntry("ws-sc")).toBeDefined();
  });
});

describe("startup reconciliation — conflicted local copy", () => {
  it("never touches the network and reports conflict-present", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-conflict");
    await store.hydrateWorkspaceFromServer(base, 2);
    await store.stageWorkspaceUpdate(renamedSnapshot(base, "Local Edit"));
    const marked = await store.markWorkspaceConflict({
      workspaceId: "ws-conflict",
      localGeneration: 1,
      actualRevision: 4,
    });
    expect(marked.ok).toBe(true);
    const fake = new FakeWorkspaceSyncTransport();
    fake.listWorkspacesHandler = () => listOk();
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const state = await runtime.initialize();

    expect(fake.listCalls).toHaveLength(0);
    expect(fake.getCalls).toHaveLength(0);
    expect(fake.createCalls).toHaveLength(0);
    expect(fake.saveCalls).toHaveLength(0);
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.workspace.snapshot).toEqual(renamedSnapshot(base, "Local Edit"));
      expect(state.workspace.serverRevision).toBe(2);
      expect(state.workspace.conflictRevision).toBe(4);
      expect(await store.getOutboxEntry("ws-conflict")).toBeDefined();
      expect(state.lastRemoteResult).toEqual({
        status: "conflict-present",
        workspaceId: "ws-conflict",
      });
    }
  });
});
