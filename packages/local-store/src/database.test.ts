import { afterEach, describe, expect, it } from "vitest";

import { openLocalWorkspaceStore } from "./store";
import {
  IDBKeyRange,
  buildSnapshot,
  cleanupLocalStores,
  fakeIndexedDB,
  manualClock,
  nextDatabaseName,
  openTestStore,
} from "./test-support";
import { LOCAL_STORE_SCHEMA_VERSION } from "./database";

afterEach(async () => {
  await cleanupLocalStores();
});

describe("local database open/close", () => {
  it("exposes IndexedDB schema version 1", () => {
    expect(LOCAL_STORE_SCHEMA_VERSION).toBe(1);
  });

  it("opens and closes, and unknown lookups stay empty", async () => {
    const store = await openTestStore();

    expect(await store.getWorkspace("missing")).toBeUndefined();
    expect(await store.getOutboxEntry("missing")).toBeUndefined();
    expect(await store.listWorkspaces()).toEqual([]);
    expect(await store.listOutboxEntries()).toEqual([]);

    store.close();
  });

  it("rejects a databaseName that is blank after trimming", async () => {
    await expect(openLocalWorkspaceStore({ databaseName: "   " })).rejects.toThrow(RangeError);
  });

  it("rejects indexedDB injection without IDBKeyRange", async () => {
    await expect(
      openLocalWorkspaceStore({
        databaseName: nextDatabaseName(),
        indexedDB: fakeIndexedDB,
      })
    ).rejects.toThrow(/together/i);
  });

  it("rejects IDBKeyRange injection without indexedDB", async () => {
    await expect(
      openLocalWorkspaceStore({
        databaseName: nextDatabaseName(),
        IDBKeyRange,
      })
    ).rejects.toThrow(/together/i);
  });
});

describe("workspace listing", () => {
  it("lists hydrated workspaces ordered by id ascending", async () => {
    const store = await openTestStore();

    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-b"), 4);
    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-a"), 1);
    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-c"), 9);

    const listed = await store.listWorkspaces();
    expect(listed.map((record) => record.id)).toEqual(["ws-a", "ws-b", "ws-c"]);
  });
});

describe("reopen persistence of hydrated state", () => {
  it("keeps a hydrated workspace readable after close and reopen", async () => {
    const clock = manualClock(2_000);
    // Leading/trailing spaces pin that the name is used verbatim, never trimmed.
    const databaseName = `  ${nextDatabaseName()}  `;

    const first = await openTestStore({ databaseName, now: clock.now });
    const hydrated = await first.hydrateWorkspaceFromServer(buildSnapshot("ws-keep"), 6);
    expect(hydrated.ok).toBe(true);
    first.close();

    const reopened = await openTestStore({ databaseName, now: clock.now });
    const record = await reopened.getWorkspace("ws-keep");

    expect(record).toBeDefined();
    expect(record?.snapshot).toEqual(buildSnapshot("ws-keep"));
    expect(record?.serverRevision).toBe(6);
    expect(record?.localGeneration).toBe(0);
    expect(record?.syncState).toBe("clean");
    expect(record?.conflictRevision).toBeUndefined();
    expect(record?.lastSyncedAt).toBe(2_000);
    expect(await reopened.getOutboxEntry("ws-keep")).toBeUndefined();
  });
});
