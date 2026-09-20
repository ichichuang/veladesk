import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MAX_ASSET_BYTES, createContentAssetId } from "@veladesk/assets/core";

import { createFilesystemAssetRepository } from "../assets/repository";
import { handleGetAsset, handleHeadAsset, handlePutAsset, readBoundedBody } from "./asset-handlers";

function makePng(seed = 1): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([seed], 16);
  return bytes;
}

function makeJpeg(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}

function makeWebp(): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes.set([0x52, 0x49, 0x46, 0x46]);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

function makeAvif(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  bytes.set([0x61, 0x76, 0x69, 0x66], 8);
  return bytes;
}

function makeRepo() {
  const assetsDir = path.join(mkdtempSync(path.join(tmpdir(), "veladesk-assets-api-")), "assets");
  return {
    assetsDir,
    repository: createFilesystemAssetRepository({ assetsDir }),
    cleanup: () => rmSync(path.dirname(assetsDir), { recursive: true, force: true }),
  };
}

function putRequest(bytes: Uint8Array, contentType = "application/octet-stream"): Request {
  return new Request("http://localhost:3000/api/v1/assets/x", {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes as unknown as BodyInit,
    duplex: "half",
  } as RequestInit);
}

describe("handlePutAsset", () => {
  it("stores a valid new PNG as 201 with the asset envelope", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      const bytes = makePng(1);
      const assetId = await createContentAssetId(bytes);
      const response = await handlePutAsset(repository, putRequest(bytes), assetId);

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        asset: { id: assetId, mediaType: "image/png", byteLength: bytes.byteLength },
      });
    } finally {
      cleanup();
    }
  });

  it("answers 200 already-existed on an identical duplicate PUT", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      const bytes = makePng(2);
      const assetId = await createContentAssetId(bytes);
      await handlePutAsset(repository, putRequest(bytes), assetId);
      const response = await handlePutAsset(repository, putRequest(bytes), assetId);

      expect(response.status).toBe(200);
    } finally {
      cleanup();
    }
  });

  it("accepts JPEG, WebP and AVIF magic bytes", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      const cases: readonly [Uint8Array, string][] = [
        [makeJpeg(), "image/jpeg"],
        [makeWebp(), "image/webp"],
        [makeAvif(), "image/avif"],
      ];
      for (const [bytes, mediaType] of cases) {
        const assetId = await createContentAssetId(bytes);
        const response = await handlePutAsset(repository, putRequest(bytes), assetId);
        expect(response.status).toBe(201);
        expect(((await response.json()) as { asset: { mediaType: string } }).asset.mediaType).toBe(
          mediaType
        );
      }
    } finally {
      cleanup();
    }
  });

  it("rejects a malformed asset id with 400 before reading the body", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      const response = await handlePutAsset(
        repository,
        putRequest(makePng()),
        "../../etc/passwd"
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "invalid-asset-id" } });
    } finally {
      cleanup();
    }
  });

  it("rejects an empty body with 400 asset-empty", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      const assetId = await createContentAssetId(makePng());
      const response = await handlePutAsset(repository, putRequest(new Uint8Array(0)), assetId);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "asset-empty" } });
    } finally {
      cleanup();
    }
  });

  it("rejects an oversized body with 413 asset-too-large", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      const oversized = new Uint8Array(MAX_ASSET_BYTES + 1);
      oversized.set(makePng());
      const bytes = oversized;
      const assetId = "asset-sha256-" + "a".repeat(64);
      const response = await handlePutAsset(repository, putRequest(bytes), assetId);
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: { code: "asset-too-large" } });
    } finally {
      cleanup();
    }
  });

  it("rejects unsupported media with 415 (SVG, GIF, text)", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      for (const bytes of [
        new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
        Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      ]) {
        const assetId = await createContentAssetId(bytes);
        const response = await handlePutAsset(repository, putRequest(bytes), assetId);
        expect(response.status).toBe(415);
        expect(await response.json()).toEqual({ error: { code: "unsupported-image-type" } });
      }
    } finally {
      cleanup();
    }
  });

  it("rejects a hash mismatch with 422 asset-id-mismatch (Content-Type never trusted)", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      const bytes = makePng(7);
      const wrongId = await createContentAssetId(makePng(8));
      const response = await handlePutAsset(
        repository,
        putRequest(bytes, "image/png"),
        wrongId
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { code: "asset-id-mismatch" } });
    } finally {
      cleanup();
    }
  });
});

describe("handleGetAsset / handleHeadAsset", () => {
  it("serves exact bytes with detected type, immutable cache and the id as ETag", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      const bytes = makePng(10);
      const assetId = await createContentAssetId(bytes);
      await handlePutAsset(repository, putRequest(bytes), assetId);

      const response = await handleGetAsset(repository, assetId);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("ETag")).toBe(`"${assetId}"`);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    } finally {
      cleanup();
    }
  });

  it("serves HEAD with the same metadata and no body", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      const bytes = makePng(11);
      const assetId = await createContentAssetId(bytes);
      await handlePutAsset(repository, putRequest(bytes), assetId);

      const response = await handleHeadAsset(repository, assetId);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
      expect((await response.arrayBuffer()).byteLength).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("404s unknown assets and path-traversal ids", async () => {
    const { repository, cleanup } = makeRepo();
    try {
      const missing = await createContentAssetId(makePng(12));
      expect((await handleGetAsset(repository, missing)).status).toBe(404);
      expect(((await handleGetAsset(repository, missing)).json(), await (await handleGetAsset(repository, missing)).json())).toEqual({
        error: { code: "asset-not-found" },
      });
      for (const bad of ["../../etc/passwd", "short-id", "asset-sha256-%2F"]) {
        expect((await handleGetAsset(repository, bad)).status).toBe(400);
        expect((await handleHeadAsset(repository, bad)).status).toBe(400);
      }
      const missingHead = await handleHeadAsset(repository, missing);
      expect(missingHead.status).toBe(404);
    } finally {
      cleanup();
    }
  });
});

describe("readBoundedBody", () => {
  it("caps reads at the shared MAX_ASSET_BYTES budget", async () => {
    const within = new Uint8Array(10);
    const ok = await readBoundedBody(putRequest(within), MAX_ASSET_BYTES);
    expect(ok.ok).toBe(true);

    const oversized = new Uint8Array(MAX_ASSET_BYTES + 1);
    const tooLarge = await readBoundedBody(putRequest(oversized), MAX_ASSET_BYTES);
    expect(tooLarge).toEqual({ ok: false, reason: "asset-too-large" });

    const empty = await readBoundedBody(putRequest(new Uint8Array(0)), MAX_ASSET_BYTES);
    expect(empty).toEqual({ ok: false, reason: "asset-empty" });
  });
});
