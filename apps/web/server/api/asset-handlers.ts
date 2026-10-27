import {
  MAX_ASSET_BYTES,
  isContentAssetId,
  verifyAssetBytes,
} from "@veladesk/assets/core";

import type { AssetPutResult, AssetRepository } from "../assets/repository";
import type { AssetUploadGuard } from "./write-guard";
import { errorResponse, jsonResponse } from "./response";

/**
 * HTTP handlers for the uploaded-asset API (task 016-B).
 *
 * PUT bodies are RAW BINARY (never multipart) and are read through a
 * bounded stream reader — an oversized body is cut off at the shared
 * `MAX_ASSET_BYTES` budget and answered 413 before its bytes are ever
 * hashed or written. Content-type headers are never trusted: the magic
 * bytes decide, and the recomputed SHA-256 must equal the id in the URL.
 *
 * The optional upload guard adds the server-side quotas (task vd-guard):
 * 507 `storage-full` while the data dir is over budget, and 507
 * `asset-quota-exceeded` when a NEW asset would exceed the assets-dir
 * count/size quota — with admission and store serialized per process so
 * concurrent uploads cannot jointly overshoot the cap. Idempotent
 * re-uploads of an existing id never hit the quota check. Without a guard
 * the handler behaves exactly as before, so unit tests of the HTTP
 * contract stay dependency-free.
 */

export type BoundedBodyResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: "asset-too-large" }
  | { readonly ok: false; readonly reason: "asset-empty" }
  | { readonly ok: false; readonly reason: "body-read-failed" };

/**
 * Reads a request body with a hard cap. The stream is cancelled as soon
 * as the budget is exceeded — the server never buffers an unbounded
 * `request.arrayBuffer()`.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number
): Promise<BoundedBodyResult> {
  const body = request.body;
  if (body === null) {
    return { ok: false, reason: "asset-empty" };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return { ok: false, reason: "asset-too-large" };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, reason: "body-read-failed" };
  }
  if (total === 0) {
    return { ok: false, reason: "asset-empty" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** PUT /api/v1/assets/:assetId */
export async function handlePutAsset(
  repository: AssetRepository,
  request: Request,
  assetId: string,
  guard?: AssetUploadGuard
): Promise<Response> {
  // 0. Data-dir budget: refuse before reading a single body byte.
  if (guard?.storageFull) {
    return errorResponse(507, "storage-full");
  }
  // 1. The URL id must be a well-formed content address.
  if (!isContentAssetId(assetId)) {
    return errorResponse(400, "invalid-asset-id");
  }
  // 2. Bounded body read (413 wins before any validation below).
  const body = await readBoundedBody(request, MAX_ASSET_BYTES);
  if (!body.ok) {
    if (body.reason === "asset-too-large") {
      return errorResponse(413, "asset-too-large");
    }
    if (body.reason === "asset-empty") {
      return errorResponse(400, "asset-empty");
    }
    return errorResponse(400, "invalid-request");
  }
  // 3–5. Magic detection + hash identity: the Content-Type header is
  // never trusted, and the bytes must hash exactly to the URL id.
  const verified = await verifyAssetBytes(assetId, body.bytes);
  if (!verified.ok) {
    switch (verified.reason) {
      case "asset-too-large":
        return errorResponse(413, "asset-too-large");
      case "unsupported-image-type":
        return errorResponse(415, "unsupported-image-type");
      case "asset-id-mismatch":
        return errorResponse(422, "asset-id-mismatch");
      case "asset-empty":
        return errorResponse(400, "asset-empty");
      case "invalid-asset-id":
        return errorResponse(400, "invalid-asset-id");
    }
  }
  // 6. Quota admission + store as ONE serialized critical section (per
  // process) — only a NEW id is quota-checked; an existing file is a
  // content-addressed no-op (idempotent PUT) that stores nothing new and
  // must keep succeeding even at the quota.
  let put: AssetPutResult;
  if (guard !== undefined) {
    const stored = await guard.storeWithinQuota(repository, assetId, body.bytes);
    if (stored.refused) {
      return errorResponse(507, "asset-quota-exceeded");
    }
    put = stored.put;
  } else {
    put = await repository.put(assetId, body.bytes);
  }
  if (!put.stored) {
    return errorResponse(422, "asset-id-mismatch");
  }
  return jsonResponse(
    {
      asset: {
        id: assetId,
        mediaType: put.mediaType,
        byteLength: put.byteLength,
      },
    },
    { status: put.alreadyExisted ? 200 : 201 }
  );
}

/** GET /api/v1/assets/:assetId */
export async function handleGetAsset(
  repository: AssetRepository,
  assetId: string
): Promise<Response> {
  if (!isContentAssetId(assetId)) {
    return errorResponse(400, "invalid-asset-id");
  }
  const asset = await repository.get(assetId);
  if (!asset.found) {
    return errorResponse(404, "asset-not-found");
  }
  return new Response(asset.bytes as unknown as BodyInit, {
    status: 200,
    headers: assetHeaders(assetId, asset.mediaType, asset.byteLength),
  });
}

/** HEAD /api/v1/assets/:assetId — metadata only, for sync existence probes. */
export async function handleHeadAsset(
  repository: AssetRepository,
  assetId: string
): Promise<Response> {
  if (!isContentAssetId(assetId)) {
    return errorResponse(400, "invalid-asset-id");
  }
  const asset = await repository.head(assetId);
  if (!asset.exists) {
    return errorResponse(404, "asset-not-found");
  }
  // HEAD re-detects the media type from the bytes via the shared GET path.
  const stored = await repository.get(assetId);
  const mediaType = stored.found ? stored.mediaType : "application/octet-stream";
  return new Response(null, {
    status: 200,
    headers: assetHeaders(assetId, mediaType, asset.byteLength),
  });
}

function assetHeaders(
  assetId: string,
  mediaType: string,
  byteLength: number
): Headers {
  const headers = new Headers({
    "Content-Type": mediaType,
    // Content-addressed: the id IS the etag and the content never changes.
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: `"${assetId}"`,
  });
  headers.set("Content-Length", String(byteLength));
  return headers;
}
