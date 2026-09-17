import { afterEach, describe, expect, it, vi } from "vitest";
import type { GetRemoteWorkspaceResult, ListRemoteWorkspacesResult } from "@veladesk/sync";

import { createWorkspaceClientRuntime } from "./runtime";
import {
  FakeWorkspaceSyncTransport,
  buildTestSnapshot,
  cleanupTestStores,
  deferred,
  listOk,
  openTestStore,
  remoteOk,
} from "./test-support";
import type { WorkspaceClientRuntimeState } from "./types";

afterEach(async () => {
  await cleanupTestStores();
});

describe("runtime external-store basics", () => {
  it("starts idle before initialize", async () => {
    const store = await openTestStore();
    const runtime = createWorkspaceClientRuntime({
      store,
      transport: new FakeWorkspaceSyncTransport(),
    });

    expect(runtime.getSnapshot()).toEqual({ status: "idle" });
  });

  it("emits a booting state before the bootstrap settles", async () => {
    const store = await openTestStore();
    const fake = new FakeWorkspaceSyncTransport();
    const gate = deferred<ListRemoteWorkspacesResult>();
    fake.listWorkspacesHandler = () => gate.promise;
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });
    const seen: WorkspaceClientRuntimeState[] = [];
    runtime.subscribe(() => seen.push(runtime.getSnapshot()));

    const initPromise = runtime.initialize();
    await vi.waitFor(() => expect(seen.map((s) => s.status)).toContain("booting"));

    gate.resolve(listOk());
    await initPromise;

    expect(seen[0]).toEqual({ status: "booting" });
    expect(runtime.getSnapshot()).toEqual({ status: "empty" });
  });

  it("is single-flight: concurrent initializes bootstrap once and later calls return the current state", async () => {
    const store = await openTestStore();
    const fake = new FakeWorkspaceSyncTransport();
    const gate = deferred<ListRemoteWorkspacesResult>();
    fake.listWorkspacesHandler = () => gate.promise;
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const first = runtime.initialize();
    const second = runtime.initialize();
    await vi.waitFor(() => expect(fake.listCalls).toHaveLength(1));
    const third = runtime.initialize();

    gate.resolve(listOk());
    const results = await Promise.all([first, second, third]);
    expect(fake.listCalls).toHaveLength(1);
    expect(results[0]).toEqual(results[1]);
    expect(results[2]).toEqual(results[0]);

    // Initialized runtime: another call returns the current state without
    // re-bootstrapping, even after the state moved on.
    gate.resolve(listOk({ id: "ws-late", name: "Late", revision: 1 }));
    const again = await runtime.initialize();
    expect(again).toEqual({ status: "empty" });
    expect(fake.listCalls).toHaveLength(1);
  });
});

describe("bootstrap — local empty, remote discovery", () => {
  it("reaches empty when local and remote are both empty", async () => {
    const store = await openTestStore();
    const fake = new FakeWorkspaceSyncTransport();
    fake.listWorkspacesHandler = () => listOk();
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const state = await runtime.initialize();

    expect(state).toEqual({ status: "empty" });
  });

  it("hydrates and becomes ready when the remote has exactly one workspace", async () => {
    const store = await openTestStore();
    const remoteSnapshot = buildTestSnapshot("ws-solo", "Server Desk");
    const fake = new FakeWorkspaceSyncTransport();
    fake.listWorkspacesHandler = () => listOk({ id: "ws-solo", name: "Server Desk", revision: 4 });
    fake.getWorkspaceHandler = () => remoteOk(remoteSnapshot, 4);
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const state = await runtime.initialize();

    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.workspace.snapshot).toEqual(remoteSnapshot);
      expect(state.workspace.serverRevision).toBe(4);
      expect(state.workspace.localGeneration).toBe(0);
      expect(state.workspace.syncState).toBe("clean");
    }
    expect(fake.getCalls).toEqual(["ws-solo"]);
  });

  it("requires selection in server order when the remote has multiple workspaces", async () => {
    const store = await openTestStore();
    const fake = new FakeWorkspaceSyncTransport();
    fake.listWorkspacesHandler = () =>
      listOk(
        { id: "ws-zeta", name: "Zeta", revision: 2 },
        { id: "ws-alpha", name: "Alpha", revision: 9 },
      );
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const state = await runtime.initialize();

    expect(state).toEqual({
      status: "selection-required",
      candidates: [
        { source: "remote", id: "ws-zeta", name: "Zeta", revision: 2 },
        { source: "remote", id: "ws-alpha", name: "Alpha", revision: 9 },
      ],
    });
  });

  it("maps remote list network/server/protocol failures to remote-unavailable", async () => {
    async function bootWith(
      handler: () => ListRemoteWorkspacesResult
    ): Promise<WorkspaceClientRuntimeState> {
      const store = await openTestStore();
      const fake = new FakeWorkspaceSyncTransport();
      fake.listWorkspacesHandler = handler;
      const runtime = createWorkspaceClientRuntime({ store, transport: fake });
      return runtime.initialize();
    }

    expect(await bootWith(() => ({ ok: false, reason: "network-error" }))).toEqual({
      status: "remote-unavailable",
      reason: "network-error",
    });

    expect(await bootWith(() => ({ ok: false, reason: "server-error", status: 503 }))).toEqual({
      status: "remote-unavailable",
      reason: "server-error",
      httpStatus: 503,
    });

    expect(await bootWith(() => ({ ok: false, reason: "protocol-error", status: 200 }))).toEqual({
      status: "remote-unavailable",
      reason: "protocol-error",
      httpStatus: 200,
    });
  });

  it("stays ready with the local record when the single remote pull loses a race to another tab", async () => {
    const store = await openTestStore();
    const remoteSnapshot = buildTestSnapshot("ws-race");
    const fake = new FakeWorkspaceSyncTransport();
    fake.listWorkspacesHandler = () => listOk({ id: "ws-race", name: "Test Desk", revision: 9 });
    const getGate = deferred<GetRemoteWorkspaceResult>();
    fake.getWorkspaceHandler = () => getGate.promise;
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const initPromise = runtime.initialize();
    await vi.waitFor(() => expect(fake.getCalls).toEqual(["ws-race"]));

    // Another tab hydrated a NEWER revision while our pull was in flight;
    // our own (older) pull must then be refused as stale.
    await store.hydrateWorkspaceFromServer(remoteSnapshot, 9);
    getGate.resolve(remoteOk(remoteSnapshot, 5));

    const state = await initPromise;

    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.workspace.id).toBe("ws-race");
      expect(state.workspace.serverRevision).toBe(9);
      expect(state.lastRemoteResult).toEqual({
        status: "stale-server-revision",
        workspaceId: "ws-race",
        currentRevision: 9,
      });
    }
  });
});

describe("bootstrap — local copies present", () => {
  it("requires local selection in id ASC order without querying the remote catalog", async () => {
    const clock = { now: () => 1_000 };
    const store = await openTestStore({ now: clock.now });
    // Stage in non-alphabetical creation order; candidates must come back
    // in store id ASC order regardless.
    await store.stageWorkspaceCreate(buildTestSnapshot("ws-bbb"));
    await store.stageWorkspaceCreate(buildTestSnapshot("ws-aaa"));
    const fake = new FakeWorkspaceSyncTransport();
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });

    const state = await runtime.initialize();

    expect(state).toEqual({
      status: "selection-required",
      candidates: [
        {
          source: "local",
          id: "ws-aaa",
          name: "Test Desk",
          syncState: "dirty",
          serverRevision: null,
        },
        {
          source: "local",
          id: "ws-bbb",
          name: "Test Desk",
          syncState: "dirty",
          serverRevision: null,
        },
      ],
    });
    expect(fake.listCalls).toHaveLength(0);
  });
});
