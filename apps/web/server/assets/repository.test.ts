import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createContentAssetId } from "@veladesk/assets/core";

import { createFilesystemAssetRepository } from "./repository";

function makePng(seed = 1): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([seed], 16);
  return bytes;
}

function makeRepo() {
  const assetsDir = path.join(mkdtempSync(path.join(tmpdir(), "veladesk-assets-")), "assets");
  return { assetsDir, repository: createFilesystemAssetRepository({ assetsDir }) };
}

describe("filesystem asset repository", () => {
  it("stores a new asset under <assetId>.bin and reports stored:new", async () => {
    const { assetsDir, repository } = makeRepo();
    const bytes = makePng(1);
    const assetId = await createContentAssetId(bytes);

    const result = await repository.put(assetId, bytes);

    expect(result).toEqual({
      stored: true,
      alreadyExisted: false,
      mediaType: "image/png",
      byteLength: bytes.byteLength,
    });
    expect(readFileSync(path.join(assetsDir, `${assetId}.bin`))).toEqual(Buffer.from(bytes));
    rmSync(path.dirname(assetsDir), { recursive: true, force: true });
  });

  it("is idempotent: a duplicate PUT returns existed and leaves the file untouched", async () => {
    const { repository } = makeRepo();
    const bytes = makePng(2);
    const assetId = await createContentAssetId(bytes);

    await repository.put(assetId, bytes);
    const second = await repository.put(assetId, bytes);

    expect(second).toEqual({
      stored: true,
      alreadyExisted: true,
      mediaType: "image/png",
      byteLength: bytes.byteLength,
    });
  });

  it("refuses an id whose existing file no longer hashes back to it", async () => {
    const { assetsDir, repository } = makeRepo();
    const bytes = makePng(3);
    const assetId = await createContentAssetId(bytes);
    await repository.put(assetId, bytes);

    // Corrupt the stored file directly: different bytes under the same name.
    writeFileSync(path.join(assetsDir, `${assetId}.bin`), makePng(99));

    expect(await repository.put(assetId, bytes)).toEqual({
      stored: false,
      reason: "corrupt-existing",
    });
  });

  it("reads back exact bytes with the detected media type", async () => {
    const { repository } = makeRepo();
    const bytes = makePng(4);
    const assetId = await createContentAssetId(bytes);
    await repository.put(assetId, bytes);

    expect(await repository.get(assetId)).toEqual({
      found: true,
      bytes,
      mediaType: "image/png",
      byteLength: bytes.byteLength,
    });
  });

  it("heads existence without needing the body", async () => {
    const { repository } = makeRepo();
    const bytes = makePng(5);
    const assetId = await createContentAssetId(bytes);
    await repository.put(assetId, bytes);

    expect(await repository.head(assetId)).toEqual({ exists: true, byteLength: bytes.byteLength });
    const missing = await createContentAssetId(makePng(6));
    expect(await repository.head(missing)).toEqual({ exists: false });
  });

  it("rejects non-content ids before any filesystem access", async () => {
    const { repository } = makeRepo();
    await expect(repository.put("../evil", makePng())).rejects.toThrow(RangeError);
    expect(await repository.get("../evil")).toEqual({ found: false });
    expect(await repository.head("../evil")).toEqual({ exists: false });
    expect(await repository.get("short-id")).toEqual({ found: false });
  });

  it("keeps assets across a repository recreation (restart persistence)", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "veladesk-assets-"));
    const assetsDir = path.join(base, "nested", "assets");
    const bytes = makePng(9);
    const assetId = await createContentAssetId(bytes);

    const first = createFilesystemAssetRepository({ assetsDir });
    await first.put(assetId, bytes);

    const second = createFilesystemAssetRepository({ assetsDir });
    const read = await second.get(assetId);
    expect(read.found).toBe(true);
    if (read.found) {
      expect(read.bytes).toEqual(bytes);
    }
    rmSync(base, { recursive: true, force: true });
  });
});
