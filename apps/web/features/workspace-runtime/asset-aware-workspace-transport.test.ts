import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import type { AssetRuntime } from "@veladesk/assets/browser";
import type {
  CreateRemoteWorkspaceResult,
  SaveRemoteWorkspaceResult,
  WorkspaceSyncTransport,
} from "@veladesk/sync";

import { collectSnapshotAssetIds } from "./asset-references";
import { createAssetAwareWorkspaceSyncTransport } from "./asset-aware-workspace-transport";

/** Deterministic pseudo asset ids (collectSnapshotAssetIds only reads strings). */
function assetIdFor(seed: number): string {
  return `asset-sha256-${String(seed).padStart(64, "0")}`;
}

function snapshotWithIcons(icons: readonly (
  | { readonly kind: "asset"; readonly assetId: string }
  | { readonly kind: "generated"; readonly text: string }
  | { readonly kind: "iconify"; readonly icon: string }
)[]): WorkspaceSnapshot {
  return {
    id: "ws",
    name: "WS",
    pages: [
      { id: "page-1", name: "Home", layout: { id: "page-1", grid: { columns: 8, rows: 6 }, items: [] } },
    ],
    entities: icons.map((icon, index) => ({
      kind: "app" as const,
      id: `app-${index}`,
      name: `App ${index}`,
      url: "https://example.com",
      icon,
      openMode: "new-tab" as const,
      tags: [],
    })),
    categories: [],
    dock: { items: [] },
    preferences: { defaultPageId: "page-1", layoutLocked: true },
  };
}

describe("collectSnapshotAssetIds", () => {
  it("collects asset ids in first-occurrence order, deduplicated", () => {
    const a = assetIdFor(1);
    const b = assetIdFor(2);
    const snapshot = snapshotWithIcons([
      { kind: "generated", text: "AA" },
      { kind: "asset", assetId: a },
      { kind: "iconify", icon: "lucide:bot" },
      { kind: "asset", assetId: b },
      { kind: "asset", assetId: a },
    ]);

    expect(collectSnapshotAssetIds(snapshot)).toEqual([a, b]);
  });

  it("returns empty for a workspace without asset icons", () => {
    expect(collectSnapshotAssetIds(snapshotWithIcons([]))).toEqual([]);
    expect(
      collectSnapshotAssetIds(snapshotWithIcons([{ kind: "generated", text: "AA" }]))
    ).toEqual([]);
  });
});

// --- Wrapper tests ---------------------------------------------------------

interface Fixture {
  readonly calls: {
    readonly ensure: string[];
    readonly create: WorkspaceSnapshot[];
    readonly save: number[];
    readonly list: number;
    readonly get: string[];
  };
  readonly transport: WorkspaceSyncTransport;
  readonly runtimeOpenCount: () => number;
  setEnsureFailure(failure: { ok: false; reason: "network-error" } | { ok: false; reason: "asset-missing" } | { ok: false; reason: "server-error"; status: number } | null): void;
}

function makeFixture(options: { readonly runtimeShouldOpen?: boolean } = {}): Fixture {
  const calls = { ensure: [] as string[], create: [] as WorkspaceSnapshot[], save: [] as number[], list: 0, get: [] as string[] };
  let runtimeOpenCount = 0;
  let ensureFailure: { ok: false; reason: "network-error" } | { ok: false; reason: "asset-missing" } | { ok: false; reason: "server-error"; status: number } | null = null;

  const runtime: AssetRuntime = {
    async ensureRemoteAsset(assetId) {
      calls.ensure.push(assetId);
      if (ensureFailure !== null) {
        return ensureFailure;
      }
      return { ok: true };
    },
    async stageAsset() {
      throw new Error("not used");
    },
    async getLocalAsset() {
      return undefined;
    },
    async loadAsset() {
      throw new Error("not used");
    },
    async syncAsset() {
      throw new Error("not used");
    },
    async flushOutbox() {
      return [];
    },
    async close() {},
  };

  const base: WorkspaceSyncTransport = {
    async listWorkspaces() {
      calls.list += 1;
      return { ok: true, workspaces: [] };
    },
    async getWorkspace(workspaceId) {
      calls.get.push(workspaceId);
      return { ok: false, reason: "not-found" };
    },
    async createWorkspace(snapshot) {
      calls.create.push(snapshot);
      return {
        ok: true,
        workspace: { snapshot, revision: 1 },
      };
    },
    async saveWorkspace(snapshot, expectedRevision) {
      calls.save.push(expectedRevision);
      return {
        ok: true,
        workspace: { snapshot, revision: expectedRevision + 1 },
      };
    },
  };

  const transport = createAssetAwareWorkspaceSyncTransport({
    base,
    getAssetRuntime: async () => {
      runtimeOpenCount += 1;
      if (options.runtimeShouldOpen === false) {
        throw new Error("asset runtime must not be opened");
      }
      return runtime;
    },
  });

  return {
    calls,
    transport,
    runtimeOpenCount: () => runtimeOpenCount,
    setEnsureFailure(failure) {
      ensureFailure = failure;
    },
  };
}

const noAssets = snapshotWithIcons([{ kind: "generated", text: "AA" }]);
const withAsset = snapshotWithIcons([{ kind: "asset", assetId: assetIdFor(1) }]);
const withTwoAssets = snapshotWithIcons([
  { kind: "asset", assetId: assetIdFor(1) },
  { kind: "asset", assetId: assetIdFor(2) },
]);

describe("asset-aware workspace transport", () => {
  it("delegates reads untouched", async () => {
    const fixture = makeFixture();

    await fixture.transport.listWorkspaces();
    await fixture.transport.getWorkspace("ws-1");

    expect(fixture.calls.list).toBe(1);
    expect(fixture.calls.get).toEqual(["ws-1"]);
    expect(fixture.calls.ensure).toEqual([]);
    expect(fixture.runtimeOpenCount()).toBe(0);
  });

  it("create with assets: ensures BEFORE the POST, in order", async () => {
    const fixture = makeFixture();
    const result = await fixture.transport.createWorkspace(withTwoAssets);

    expect(result.ok).toBe(true);
    expect(fixture.calls.ensure).toEqual([assetIdFor(1), assetIdFor(2)]);
    expect(fixture.calls.create).toEqual([withTwoAssets]);
  });

  it("save with assets: ensures BEFORE the PUT", async () => {
    const fixture = makeFixture();
    const result = await fixture.transport.saveWorkspace(withAsset, 7);

    expect(result.ok).toBe(true);
    expect(fixture.calls.ensure).toEqual([assetIdFor(1)]);
    expect(fixture.calls.save).toEqual([7]);
  });

  it("snapshot without assets: zero asset runtime opens, plain delegation", async () => {
    const fixture = makeFixture({ runtimeShouldOpen: false });

    await fixture.transport.createWorkspace(noAssets);
    await fixture.transport.saveWorkspace(noAssets, 3);

    expect(fixture.calls.ensure).toEqual([]);
    expect(fixture.calls.create.length).toBe(1);
    expect(fixture.calls.save).toEqual([3]);
  });

  it("asset network failure → workspace mutation count 0 (network-error)", async () => {
    const fixture = makeFixture();
    fixture.setEnsureFailure({ ok: false, reason: "network-error" });

    const created: CreateRemoteWorkspaceResult = await fixture.transport.createWorkspace(withAsset);
    const saved: SaveRemoteWorkspaceResult = await fixture.transport.saveWorkspace(withAsset, 2);

    expect(created).toEqual({ ok: false, reason: "network-error" });
    expect(saved).toEqual({ ok: false, reason: "network-error" });
    expect(fixture.calls.create).toHaveLength(0);
    expect(fixture.calls.save).toHaveLength(0);
  });

  it("asset server error → server-error, workspace mutation count 0", async () => {
    const fixture = makeFixture();
    fixture.setEnsureFailure({ ok: false, reason: "server-error", status: 503 });

    const created = await fixture.transport.createWorkspace(withAsset);

    expect(created).toEqual({ ok: false, reason: "server-error", status: 503 });
    expect(fixture.calls.create).toHaveLength(0);
  });

  it("asset missing both sides → protocol-error, workspace mutation count 0", async () => {
    const fixture = makeFixture();
    fixture.setEnsureFailure({ ok: false, reason: "asset-missing" });

    const saved = await fixture.transport.saveWorkspace(withAsset, 4);

    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.reason).toBe("protocol-error");
    }
    expect(fixture.calls.save).toHaveLength(0);
  });

  it("ordinary text/iconify workspaces behave unchanged", async () => {
    const fixture = makeFixture({ runtimeShouldOpen: false });
    const textWorkspace = snapshotWithIcons([{ kind: "generated", text: "AI" }]);

    const created = await fixture.transport.createWorkspace(textWorkspace);
    const saved = await fixture.transport.saveWorkspace(textWorkspace, 9);

    expect(created.ok).toBe(true);
    expect(saved.ok).toBe(true);
    expect(fixture.calls.create).toEqual([textWorkspace]);
    expect(fixture.calls.save).toEqual([9]);
  });
});
