import { ensureRecipeAssetIds, probeLocalRecipeAssetIds, stageDecodedRecipeAssets } from "./recipe-asset-runtime";
/*
 * Recipe D1 — embedded wallpaper binaries: every decode/verify rule
 * rejects (size, base64, magic, media-type, sha, dimensions), the success
 * path yields canonical staged-ready binaries, the reference/notice
 * helpers fold exactly like the apply layer, and the asset-runtime
 * gateway maps every failure onto "unavailable" instead of throwing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createContentAssetId } from "@veladesk/assets/core";
import type { RecipeAssetV1 } from "@veladesk/domain";
import type { LocalAssetRecord } from "@veladesk/assets/browser";

import { officeWorkspace } from "./fixtures";
import { parseImportDocument } from "./parser";
import { planImport } from "./planner";
import { recipeSpacePreviews } from "./recipe-adapter";
import {
  collectRecipeAssetRefs,
  decodeRecipeAssets,
  missingRecipeAssetIds,
  recipeAssetCloudNotices,
  recipeAssetDecodeIssue,
  recipeAssetFallbackNotices,
  recipeThemeWallpaperAssetId,
} from "./recipe-assets";
import type { DecodedRecipeAsset } from "./recipe-assets";

// --- fixtures -------------------------------------------------------------------

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];

/** A minimal PNG-magic payload of `extra` extra bytes. */
function pngBytes(extra = 4): Uint8Array {
  return new Uint8Array([...PNG_MAGIC, ...new Array<number>(extra).fill(0x11)]);
}

const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

/** A verified asset entry for arbitrary bytes (id = real SHA-256 of them). */
async function pngEntry(bytes: Uint8Array, mediaType: RecipeAssetV1["mediaType"] = "image/png"): Promise<Record<string, RecipeAssetV1>> {
  return { [await createContentAssetId(bytes)]: { mediaType, data: base64Of(bytes) } };
}

/** Deterministic 800×600 decoder; the real browser gate is injected nowhere here. */
const fakeDimensions = async (): Promise<{ width: number; height: number }> => ({ width: 800, height: 600 });

const decodeOptions = {
  decodeDimensions: fakeDimensions,
  yieldControl: async (): Promise<void> => {},
};

const idOf = (hex: string): string => `asset-sha256-${hex.repeat(64 / hex.length)}`;

// --- decode + verify ------------------------------------------------------------

describe("decodeRecipeAssets: success", () => {
  it("verifies and decodes an embedded PNG into a canonical staged-ready binary", async () => {
    const bytes = pngBytes();
    const assets = await pngEntry(bytes);
    const result = await decodeRecipeAssets(assets, decodeOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assets).toHaveLength(1);
    const asset = result.assets[0]!;
    expect(asset.id).toBe(Object.keys(assets)[0]);
    expect(asset.mediaType).toBe("image/png");
    expect(asset.byteLength).toBe(bytes.byteLength);
    expect(asset.blob.type).toBe("image/png");
    expect(asset.width).toBe(800);
    expect(asset.height).toBe(600);
    expect(new Uint8Array(await asset.blob.arrayBuffer())).toEqual(bytes);
  });

  it("decodes chunked base64 byte-exactly and yields to the event loop between slices", async () => {
    const bytes = pngBytes(600); // 608 bytes → several small slices below
    const assets = await pngEntry(bytes);
    const id = Object.keys(assets)[0]!;
    const yieldControl = vi.fn(async (): Promise<void> => {});
    const result = await decodeRecipeAssets(assets, {
      ...decodeOptions,
      yieldControl,
      base64ChunkChars: 4 * 16,
    });
    expect(result.ok).toBe(true);
    expect(yieldControl.mock.calls.length).toBeGreaterThanOrEqual(Math.ceil(assets[id]!.data.length / 64));
    if (!result.ok) return;
    expect(result.assets[0]!.byteLength).toBe(bytes.byteLength);
  });
});

describe("decodeRecipeAssets: every rule rejects the whole file", () => {
  it("asset-too-large: a payload decoding past the 4 MiB budget, before any decode work", async () => {
    // 5 592 412 chars ≡ 4 194 307 decoded bytes — over the 4 MiB budget.
    const data = "A".repeat(5_592_412 - 2) + "==";
    const result = await decodeRecipeAssets({ [idOf("0")]: { mediaType: "image/png", data } }, decodeOptions);
    expect(result).toEqual({
      ok: false,
      issue: { path: expect.stringContaining(".data"), reason: "asset-too-large" },
    });
  });

  it("invalid-base64: bytes the domain syntax check would never let through", async () => {
    const bad = { mediaType: "image/png", data: "iVBORw0KGgo*=" } as RecipeAssetV1;
    const result = await decodeRecipeAssets({ [idOf("1")]: bad }, decodeOptions);
    expect(result).toEqual({ ok: false, issue: { path: expect.stringContaining(".data"), reason: "invalid-base64" } });
  });

  it("unsupported-image-type: magic bytes of no supported format", async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const assets = await pngEntry(bytes);
    const result = await decodeRecipeAssets(assets, decodeOptions);
    expect(result).toEqual({ ok: false, issue: { path: expect.stringContaining(".data"), reason: "unsupported-image-type" } });
  });

  it("media-type-mismatch: PNG bytes declared image/jpeg", async () => {
    const assets = await pngEntry(pngBytes(), "image/jpeg");
    const result = await decodeRecipeAssets(assets, decodeOptions);
    expect(result).toEqual({
      ok: false,
      issue: { path: expect.stringContaining(".mediaType"), reason: "media-type-mismatch" },
    });
  });

  it("asset-id-mismatch: a well-formed PNG whose SHA-256 is not its id", async () => {
    const assets = await pngEntry(pngBytes());
    const wrongId = idOf("9");
    const result = await decodeRecipeAssets({ [wrongId]: Object.values(assets)[0]! }, decodeOptions);
    expect(result).toEqual({ ok: false, issue: { path: `assets.${wrongId}`, reason: "asset-id-mismatch" } });
  });

  it("decode-failed: a payload the dimension decoder cannot decode", async () => {
    const assets = await pngEntry(pngBytes());
    const result = await decodeRecipeAssets(assets, {
      ...decodeOptions,
      decodeDimensions: async () => {
        throw new Error("nope");
      },
    });
    expect(result).toEqual({ ok: false, issue: { path: expect.stringContaining(".data"), reason: "decode-failed" } });
  });

  it("decode-failed: the default decoder without createImageBitmap (no browser)", async () => {
    const host = globalThis as { createImageBitmap?: unknown };
    const saved = host.createImageBitmap;
    host.createImageBitmap = undefined;
    try {
      const assets = await pngEntry(pngBytes());
      const result = await decodeRecipeAssets(assets, { yieldControl: async () => {} });
      expect(result).toEqual({ ok: false, issue: { path: expect.stringContaining(".data"), reason: "decode-failed" } });
    } finally {
      host.createImageBitmap = saved;
    }
  });

  it.each([
    ["side over 8192", { width: 8193, height: 10 }],
    ["decoded area over the wallpaper budget", { width: 8192, height: 8192 }],
  ])("dimensions-too-large: %s", async (_name, dimensions) => {
    const assets = await pngEntry(pngBytes());
    const result = await decodeRecipeAssets(assets, { ...decodeOptions, decodeDimensions: async () => dimensions });
    expect(result).toEqual({ ok: false, issue: { path: expect.stringContaining(".data"), reason: "dimensions-too-large" } });
  });

  it("walks entries in document order; the first rejection wins", async () => {
    const good = await pngEntry(pngBytes());
    const bad = await pngEntry(new Uint8Array([...JPEG_MAGIC, 0, 0, 0]), "image/png"); // jpeg magic declared png
    const merged = { ...bad, ...good };
    const result = await decodeRecipeAssets(merged, decodeOptions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.path).toBe(`assets.${Object.keys(bad)[0]}.mediaType`);
  });
});

// --- reference helpers -----------------------------------------------------------

describe("reference folding", () => {
  const EMBEDDED = idOf("e");
  const DEVICE = idOf("d");
  const CLOUD = idOf("c");
  const THEME = idOf("7");

  /** Office exists in the fixture workspace → the deck's Office space MERGES. */
  function deckText(): string {
    return JSON.stringify({
      format: "vela.recipe",
      version: 1,
      theme: { mode: "dark", accent: 30, material: "glass", wallpaper: { light: `asset:${THEME}` } },
      spaces: [
        { name: "AI", layout: "grid", wallpaper: { light: "preset:aurora", dark: `asset:${EMBEDDED}` }, tiles: [] },
        { name: "Board", layout: "grid", wallpaper: { dark: `asset:${DEVICE}` }, tiles: [] },
        { name: "Cloud", layout: "grid", wallpaper: { dark: `asset:${CLOUD}` }, tiles: [] },
        { name: "Office", layout: "grid", wallpaper: { dark: `asset:${CLOUD}` }, tiles: [] },
      ],
      plugins: [],
    });
  }

  function planned() {
    const parsed = parseImportDocument(deckText());
    if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.issues)}`);
    const plan = planImport(officeWorkspace().workspace, parsed.parsed.document, parsed.parsed.issues);
    return { plan, extras: parsed.parsed.recipe! };
  }

  it("collectRecipeAssetRefs gathers spaces + theme refs, deduplicated in document order", () => {
    const { extras } = planned();
    expect(collectRecipeAssetRefs(extras)).toEqual([EMBEDDED, DEVICE, CLOUD, THEME]);
  });

  it("missingRecipeAssetIds subtracts the embedded ids", () => {
    const { extras } = planned();
    expect(missingRecipeAssetIds(extras, new Set([EMBEDDED, THEME]))).toEqual([DEVICE, CLOUD]);
  });

  it("recipeThemeWallpaperAssetId mirrors the apply layer's per-mode pick", () => {
    const { extras } = planned();
    expect(recipeThemeWallpaperAssetId(extras.theme)).toBe(THEME); // dark theme, dark absent → light
    expect(
      recipeThemeWallpaperAssetId({ mode: "dark", wallpaper: { dark: `asset:${DEVICE}`, light: `asset:${THEME}` } }),
    ).toBe(DEVICE);
    expect(recipeThemeWallpaperAssetId({ mode: "light", wallpaper: { light: "preset:dawn" } })).toBeUndefined();
    expect(recipeThemeWallpaperAssetId(undefined)).toBeUndefined();
  });

  it("recipeAssetCloudNotices lists only created spaces' cloud refs and the applied theme", () => {
    const { plan, extras } = planned();
    const status = { embedded: new Set([EMBEDDED]), device: new Set([DEVICE]) };
    const previews = recipeSpacePreviews(plan.document, extras, status);
    expect(recipeAssetCloudNotices(plan, extras, previews, status, false)).toEqual([
      { spaceName: "Cloud", mode: "dark" },
    ]);
    expect(recipeAssetCloudNotices(plan, extras, previews, status, true)).toEqual([
      { spaceName: "Cloud", mode: "dark" },
      { theme: true },
    ]);
  });

  it("recipeAssetFallbackNotices names the created spaces (and theme) whose refs stayed unresolved", () => {
    const { plan, extras } = planned();
    const notices = recipeAssetFallbackNotices(plan, extras, new Set([CLOUD, THEME]), true);
    expect(notices).toEqual([
      { spaceName: "Cloud", mode: "dark" },
      { theme: true },
    ]);
    // The merged Office space never lands wallpapers → never reported, even
    // though its (cloud) ref is in the unavailable set.
    expect(notices.some((notice) => "spaceName" in notice && notice.spaceName === "Office")).toBe(false);
    expect(recipeAssetFallbackNotices(plan, extras, new Set([idOf("f")]), true)).toEqual([]);
  });
});

// --- asset-runtime gateway -------------------------------------------------------

const gateway = vi.hoisted(() => ({
  failOpen: false,
  stageAsset: vi.fn(),
  getLocalAsset: vi.fn(),
  loadAsset: vi.fn(),
}));

vi.mock("../assets/browser-assets", () => ({
  getBrowserAssetRuntime: async () => {
    if (gateway.failOpen) {
      throw new Error("no idb");
    }
    return gateway;
  },
}));

function decodedBinary(id: string): DecodedRecipeAsset {
  return { id, blob: new Blob(["x"], { type: "image/png" }), mediaType: "image/png", byteLength: 1, width: 4, height: 4 };
}

function localRecord(id: string): LocalAssetRecord {
  return { id, blob: new Blob(["x"]), mediaType: "image/png", byteLength: 1, createdAt: 0, syncState: "clean" };
}

describe("asset-runtime gateway", () => {
  beforeEach(() => {
    gateway.failOpen = false;
    gateway.stageAsset.mockReset();
    gateway.getLocalAsset.mockReset();
    gateway.loadAsset.mockReset();
  });

  describe("stageDecodedRecipeAssets", () => {
    it("stages every binary through the runtime and verifies the derived id", async () => {
      const one = idOf("1");
      const two = idOf("2");
      gateway.stageAsset
        .mockResolvedValueOnce({ ok: true, status: "staged", record: localRecord(one) })
        .mockResolvedValueOnce({ ok: true, status: "clean", record: localRecord(two) });
      await expect(stageDecodedRecipeAssets([decodedBinary(one), decodedBinary(two)])).resolves.toEqual({ ok: true });
      expect(gateway.stageAsset).toHaveBeenCalledTimes(2);
    });

    it("fails closed when the runtime refuses or the derived id disagrees", async () => {
      gateway.stageAsset.mockResolvedValue({ ok: false, reason: "asset-too-large" });
      await expect(stageDecodedRecipeAssets([decodedBinary(idOf("1"))])).resolves.toEqual({ ok: false });
      gateway.stageAsset.mockReset();
      gateway.stageAsset.mockResolvedValue({ ok: true, status: "staged", record: localRecord(idOf("9")) });
      await expect(stageDecodedRecipeAssets([decodedBinary(idOf("1"))])).resolves.toEqual({ ok: false });
    });

    it("fails closed when the runtime cannot be opened", async () => {
      gateway.failOpen = true;
      await expect(stageDecodedRecipeAssets([decodedBinary(idOf("1"))])).resolves.toEqual({ ok: false });
    });
  });

  describe("probeLocalRecipeAssetIds", () => {
    it("returns only the locally present ids", async () => {
      const present = idOf("1");
      gateway.getLocalAsset.mockImplementation(async (id: string) => (id === present ? localRecord(id) : undefined));
      await expect(probeLocalRecipeAssetIds([present, idOf("2")])).resolves.toEqual(new Set([present]));
    });

    it("never touches the runtime without ids and never throws", async () => {
      await expect(probeLocalRecipeAssetIds([])).resolves.toEqual(new Set());
      expect(gateway.getLocalAsset).not.toHaveBeenCalled();
      gateway.getLocalAsset.mockRejectedValue(new Error("no idb"));
      await expect(probeLocalRecipeAssetIds([idOf("1")])).resolves.toEqual(new Set());
    });
  });

  describe("ensureRecipeAssetIds", () => {
    it("splits resolved and failed ids (local hit or verified remote fetch)", async () => {
      const hit = idOf("1");
      const fetched = idOf("2");
      gateway.loadAsset
        .mockResolvedValueOnce({ ok: true, blob: new Blob(["a"]), mediaType: "image/png", source: "local" })
        .mockResolvedValueOnce({ ok: true, blob: new Blob(["b"]), mediaType: "image/png", source: "remote" })
        .mockResolvedValueOnce({ ok: false, reason: "not-found" });
      await expect(ensureRecipeAssetIds([hit, fetched, idOf("3")])).resolves.toEqual({
        available: new Set([hit, fetched]),
        failed: [idOf("3")],
      });
    });

    it("marks everything failed when the runtime cannot be opened", async () => {
      gateway.failOpen = true;
      const id = idOf("1");
      await expect(ensureRecipeAssetIds([id])).resolves.toEqual({ available: new Set(), failed: [id] });
    });

    it("never touches the runtime without ids", async () => {
      await expect(ensureRecipeAssetIds([])).resolves.toEqual({ available: new Set(), failed: [] });
      expect(gateway.loadAsset).not.toHaveBeenCalled();
    });
  });
});

describe("recipeAssetDecodeIssue", () => {
  it("maps a rejection onto the parser's error issue shape", () => {
    expect(recipeAssetDecodeIssue({ path: "assets.x.data", reason: "asset-id-mismatch" })).toEqual({
      severity: "error",
      code: "RECIPE_ASSET_INVALID",
      path: "assets.x.data",
      value: "asset-id-mismatch",
    });
  });
});
