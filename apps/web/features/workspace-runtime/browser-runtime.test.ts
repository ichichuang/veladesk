import { describe, expect, it, vi } from "vitest";
import { openLocalWorkspaceStore } from "@veladesk/local-store";
import { createHttpWorkspaceSyncTransport } from "@veladesk/sync";
import { createWorkspaceClientRuntime } from "@veladesk/client-runtime";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import { getBrowserWorkspaceRuntime } from "./browser-runtime";

vi.mock("@veladesk/local-store", () => ({
  openLocalWorkspaceStore: vi.fn(),
}));
vi.mock("@veladesk/sync", () => ({
  createHttpWorkspaceSyncTransport: vi.fn(),
}));
vi.mock("@veladesk/client-runtime", () => ({
  createWorkspaceClientRuntime: vi.fn(),
}));

const openStoreMock = vi.mocked(openLocalWorkspaceStore);
const httpTransportMock = vi.mocked(createHttpWorkspaceSyncTransport);
const createRuntimeMock = vi.mocked(createWorkspaceClientRuntime);

const assetlessSnapshot: WorkspaceSnapshot = {
  id: "ws-retry",
  name: "WS",
  pages: [
    { id: "page-1", name: "Home", layout: { id: "page-1", grid: { columns: 8, rows: 6 }, items: [] } },
  ],
  entities: [],
  categories: [],
  dock: { items: [] },
  preferences: { defaultPageId: "page-1", layoutLocked: true },
};

describe("getBrowserWorkspaceRuntime", () => {
  it("evicts a rejected open so a retry constructs again, and caches only success", async () => {
    const databaseName = `veladesk-retry-test-${globalThis.crypto.randomUUID()}`;
    const store = { marker: "store" };
    const baseListWorkspaces = vi.fn(async () => ({ ok: true as const, workspaces: [] }));
    const baseCreateWorkspace = vi.fn(async (snapshot: WorkspaceSnapshot) => ({
      ok: true as const,
      workspace: { snapshot, revision: 1 },
    }));
    const baseTransport = { listWorkspaces: baseListWorkspaces, createWorkspace: baseCreateWorkspace };
    const runtime = { marker: "runtime" };

    openStoreMock.mockImplementationOnce(() =>
      Promise.reject(new Error("transient IndexedDB failure"))
    );
    openStoreMock.mockImplementation(() => Promise.resolve(store as never));
    httpTransportMock.mockImplementation(() => baseTransport as never);
    createRuntimeMock.mockImplementation((() => Promise.resolve(runtime)) as never);

    // First attempt rejects — and must not be cached as a poisoned promise.
    await expect(getBrowserWorkspaceRuntime(databaseName)).rejects.toThrow(
      "transient IndexedDB failure"
    );
    expect(openStoreMock).toHaveBeenCalledTimes(1);

    // Second attempt is a real new constructor call and succeeds.
    await expect(getBrowserWorkspaceRuntime(databaseName)).resolves.toBe(runtime);
    expect(openStoreMock).toHaveBeenCalledTimes(2);
    expect(createRuntimeMock).toHaveBeenCalledTimes(1);

    // The composed transport is the ASSET-AWARE wrapper, not the raw HTTP
    // transport — reads delegate straight through to the base.
    const composition = createRuntimeMock.mock.calls[0]![0]!;
    expect(composition.transport).not.toBe(baseTransport);
    void composition.transport.listWorkspaces();
    expect(baseListWorkspaces).toHaveBeenCalledTimes(1);
    // An asset-less workspace mutates without ever touching asset plumbing.
    await composition.transport.createWorkspace(assetlessSnapshot);

    // Third attempt for the same database reuses the successful singleton.
    await expect(getBrowserWorkspaceRuntime(databaseName)).resolves.toBe(runtime);
    expect(createRuntimeMock).toHaveBeenCalledTimes(1);
  });
});
