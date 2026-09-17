import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import {
  FakeWorkspaceSyncTransport,
  buildTestSnapshot,
  cleanupTestStores,
  openTestStore,
  renamedSnapshot,
} from "./test-support";
import { createWorkspaceSyncCoordinator } from "./coordinator";

afterEach(async () => {
  await cleanupTestStores();
});

function remoteOk(snapshot: WorkspaceSnapshot, revision: number) {
  return { ok: true as const, workspace: { snapshot, revision } };
}

describe("pullWorkspace", () => {
  it("hydrates a locally missing workspace from the remote", async () => {
    const store = await openTestStore();
    const remote = buildTestSnapshot("ws-pull", "Remote Name");
    const fake = new FakeWorkspaceSyncTransport();
    fake.getWorkspaceHandler = () => remoteOk(remote, 3);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.pullWorkspace("ws-pull");

    expect(result).toEqual({
      status: "hydrated",
      workspaceId: "ws-pull",
      serverRevision: 3,
    });
    const record = await store.getWorkspace("ws-pull");
    expect(record?.snapshot).toEqual(remote);
    expect(record?.serverRevision).toBe(3);
    expect(record?.syncState).toBe("clean");
    expect(record?.localGeneration).toBe(0);
  });

  it("hydrates a clean local copy when the remote is newer", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-pull2", "Old");
    await store.hydrateWorkspaceFromServer(base, 2);
    const newer = renamedSnapshot(base, "New");
    const fake = new FakeWorkspaceSyncTransport();
    fake.getWorkspaceHandler = () => remoteOk(newer, 4);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.pullWorkspace("ws-pull2");

    expect(result).toEqual({ status: "hydrated", workspaceId: "ws-pull2", serverRevision: 4 });
    expect((await store.getWorkspace("ws-pull2"))?.snapshot).toEqual(newer);
  });

  it("hydrates a clean local copy even when the remote revision is equal", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-pull3");
    await store.hydrateWorkspaceFromServer(base, 2);
    const fake = new FakeWorkspaceSyncTransport();
    fake.getWorkspaceHandler = () => remoteOk(base, 2);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.pullWorkspace("ws-pull3");

    expect(result).toEqual({ status: "hydrated", workspaceId: "ws-pull3", serverRevision: 2 });
  });

  it("reports stale-server-revision when the remote is older than the clean local copy", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-pull4");
    await store.hydrateWorkspaceFromServer(base, 5);
    const fake = new FakeWorkspaceSyncTransport();
    fake.getWorkspaceHandler = () => remoteOk(renamedSnapshot(base, "Older"), 3);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.pullWorkspace("ws-pull4");

    expect(result).toEqual({
      status: "stale-server-revision",
      workspaceId: "ws-pull4",
      currentRevision: 5,
    });
    expect((await store.getWorkspace("ws-pull4"))?.snapshot).toEqual(base);
  });

  it("refuses to overwrite a dirty local copy without any network request", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-pull5");
    await store.hydrateWorkspaceFromServer(base, 2);
    await store.stageWorkspaceUpdate(renamedSnapshot(base, "Local Edit"));
    const fake = new FakeWorkspaceSyncTransport();
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.pullWorkspace("ws-pull5");

    expect(result).toEqual({ status: "local-changes-present", workspaceId: "ws-pull5" });
    expect(fake.getCalls).toHaveLength(0);
    expect((await store.getWorkspace("ws-pull5"))?.snapshot.name).toBe("Local Edit");
  });

  it("refuses to overwrite a conflicted local copy without any network request", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-pull6");
    await store.hydrateWorkspaceFromServer(base, 2);
    await store.stageWorkspaceUpdate(renamedSnapshot(base, "Local Edit"));
    const marked = await store.markWorkspaceConflict({
      workspaceId: "ws-pull6",
      localGeneration: 1,
      actualRevision: 3,
    });
    expect(marked.ok).toBe(true);
    const fake = new FakeWorkspaceSyncTransport();
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.pullWorkspace("ws-pull6");

    expect(result).toEqual({ status: "local-changes-present", workspaceId: "ws-pull6" });
    expect(fake.getCalls).toHaveLength(0);
  });

  it("maps a remote 404 to not-found", async () => {
    const store = await openTestStore();
    const fake = new FakeWorkspaceSyncTransport();
    fake.getWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "not-found" });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.pullWorkspace("ws-nowhere");

    expect(result).toEqual({ status: "not-found", workspaceId: "ws-nowhere" });
  });

  it("maps network and server failures", async () => {
    const store = await openTestStore();
    const fake = new FakeWorkspaceSyncTransport();
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    fake.getWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "network-error" });
    expect(await coordinator.pullWorkspace("ws-pull7")).toEqual({
      status: "network-error",
      workspaceId: "ws-pull7",
    });

    fake.getWorkspaceHandler = () =>
      Promise.resolve({ ok: false, reason: "server-error", status: 500 });
    expect(await coordinator.pullWorkspace("ws-pull7")).toEqual({
      status: "server-error",
      workspaceId: "ws-pull7",
      httpStatus: 500,
    });
  });

  it("maps a protocol failure from a malformed remote response", async () => {
    const store = await openTestStore();
    const fake = new FakeWorkspaceSyncTransport();
    fake.getWorkspaceHandler = () =>
      Promise.resolve({ ok: false, reason: "protocol-error", status: 200 });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.pullWorkspace("ws-pull8");

    expect(result).toEqual({
      status: "protocol-error",
      workspaceId: "ws-pull8",
      httpStatus: 200,
    });
  });
});
