import { afterEach, describe, expect, it } from "vitest";
import { openTestStore, cleanupLocalStores, buildSnapshot } from "./test-support";
afterEach(cleanupLocalStores);
describe("local workspace deletion", () => {
  it("atomically removes a dirty working copy and its create outbox", async () => {
    const store = await openTestStore(); await store.stageWorkspaceCreate(buildSnapshot("delete"));
    expect(await store.getOutboxEntry("delete")).toBeDefined(); expect(await store.deleteWorkspace("delete")).toBe(true);
    expect(await store.getWorkspace("delete")).toBeUndefined(); expect(await store.getOutboxEntry("delete")).toBeUndefined();
  });
  it("preserves a concurrent local edit when the expected generation changed", async () => {
    const store = await openTestStore(); const snapshot = buildSnapshot("delete"); await store.stageWorkspaceCreate(snapshot);
    await store.stageWorkspaceUpdate({ ...snapshot, name: "Newer edit" });
    expect(await store.deleteWorkspace("delete", 1)).toBe(false);
    expect((await store.getWorkspace("delete"))?.snapshot.name).toBe("Newer edit"); expect(await store.getOutboxEntry("delete")).toBeDefined();
  });
});
