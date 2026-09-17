import { describe, expect, it, vi } from "vitest";

import { openWorkspaceClientRuntime } from "@veladesk/client-runtime";

import { getBrowserWorkspaceRuntime } from "./browser-runtime";

vi.mock("@veladesk/client-runtime", () => ({
  openWorkspaceClientRuntime: vi.fn(),
}));

const openMock = vi.mocked(openWorkspaceClientRuntime);

describe("getBrowserWorkspaceRuntime", () => {
  it("evicts a rejected open so a retry constructs again, and caches only success", async () => {
    const databaseName = `veladesk-retry-test-${globalThis.crypto.randomUUID()}`;
    const runtime = { marker: "runtime" };
    openMock.mockImplementationOnce(() =>
      Promise.reject(new Error("transient IndexedDB failure"))
    );
    openMock.mockImplementationOnce(() => Promise.resolve(runtime as never));

    // First attempt rejects — and must not be cached as a poisoned promise.
    await expect(getBrowserWorkspaceRuntime(databaseName)).rejects.toThrow(
      "transient IndexedDB failure"
    );
    expect(openMock).toHaveBeenCalledTimes(1);

    // Second attempt is a real new constructor call and succeeds.
    await expect(getBrowserWorkspaceRuntime(databaseName)).resolves.toBe(runtime);
    expect(openMock).toHaveBeenCalledTimes(2);
    expect(openMock).toHaveBeenLastCalledWith({ databaseName, baseUrl: "" });

    // Third attempt for the same database reuses the successful singleton.
    await expect(getBrowserWorkspaceRuntime(databaseName)).resolves.toBe(runtime);
    expect(openMock).toHaveBeenCalledTimes(2);
  });
});
