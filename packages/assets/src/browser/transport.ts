import { verifyAssetBytes } from "../core";
import type { ContentAssetId, UploadedAssetMediaType } from "../core";

import type {
  AssetTransport,
  GetAssetResult,
  HeadAssetResult,
  PutAssetResult,
} from "./types";

/**
 * Browser HTTP transport for the self-hosted asset API v1.
 *
 * Same discipline as the workspace sync transport: every failure is
 * classified (network / server / protocol), and NO remote bytes are ever
 * trusted because a 200 arrived — a GET body is re-hashed against the
 * requested id before it leaves this module (content addressing is the
 * integrity check).
 */

const ASSETS_COLLECTION_PATH = "/api/v1/assets";

export interface HttpAssetTransportOptions {
  /** Base URL prepended to `/api/v1/assets`. Defaults to same-origin. */
  readonly baseUrl?: string;

  /** Fetch implementation. Defaults to `globalThis.fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

export function createHttpAssetTransport(
  options: HttpAssetTransportOptions = {}
): AssetTransport {
  const baseUrlOption = options.baseUrl ?? "";
  if (baseUrlOption !== "" && baseUrlOption.trim().length === 0) {
    throw new RangeError(
      `baseUrl must not be whitespace-only, received: "${baseUrlOption}"`
    );
  }
  let baseUrl = baseUrlOption;
  while (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "createHttpAssetTransport requires fetch: globalThis.fetch is not available"
    );
  }
  const doFetch = fetchImpl.bind(globalThis);

  function assetUrl(assetId: ContentAssetId): string {
    return `${baseUrl}${ASSETS_COLLECTION_PATH}/${encodeURIComponent(assetId)}`;
  }

  async function rawFetch(url: string, init: RequestInit): Promise<Response | "network-error"> {
    try {
      return await doFetch(url, init);
    } catch {
      return "network-error";
    }
  }

  function serverError(response: Response): { ok: false; reason: "server-error"; status: number } {
    return { ok: false, reason: "server-error", status: response.status };
  }

  function protocolError(response: Response): {
    ok: false;
    reason: "protocol-error";
    status: number;
  } {
    return { ok: false, reason: "protocol-error", status: response.status };
  }

  async function decodeAssetEnvelope(
    response: Response
  ): Promise<
    | { ok: true; id: ContentAssetId; mediaType: UploadedAssetMediaType; byteLength: number }
    | { ok: false; reason: "protocol-error"; status: number }
  > {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return protocolError(response);
    }
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as { asset?: unknown }).asset !== "object"
    ) {
      return protocolError(response);
    }
    const asset = (body as { asset: Record<string, unknown> }).asset;
    const { id, mediaType, byteLength } = asset;
    if (
      typeof id !== "string" ||
      typeof mediaType !== "string" ||
      !["image/png", "image/jpeg", "image/webp", "image/avif"].includes(mediaType) ||
      typeof byteLength !== "number" ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0
    ) {
      return protocolError(response);
    }
    return {
      ok: true,
      id,
      mediaType: mediaType as UploadedAssetMediaType,
      byteLength,
    };
  }

  return {
    async putAsset(record): Promise<PutAssetResult> {
      const response = await rawFetch(assetUrl(record.id), {
        method: "PUT",
        headers: { "Content-Type": record.mediaType },
        body: record.blob,
      });
      if (response === "network-error") {
        return { ok: false, reason: "network-error" };
      }
      if (response.status !== 200 && response.status !== 201) {
        if (response.status >= 500) {
          return serverError(response);
        }
        // 400/413/415/422 asset rejections violate the expected contract —
        // they mean the local pipeline and the server disagree.
        return protocolError(response);
      }
      const decoded = await decodeAssetEnvelope(response);
      if (!decoded.ok) {
        return decoded;
      }
      if (decoded.id !== record.id) {
        return protocolError(response);
      }
      return {
        ok: true,
        status: response.status === 201 ? "stored" : "existed",
        asset: {
          id: decoded.id,
          mediaType: decoded.mediaType,
          byteLength: decoded.byteLength,
        },
      };
    },

    async getAsset(assetId): Promise<GetAssetResult> {
      const response = await rawFetch(assetUrl(assetId), {
        method: "GET",
        headers: { Accept: "image/png, image/jpeg, image/webp, image/avif" },
      });
      if (response === "network-error") {
        return { ok: false, reason: "network-error" };
      }
      if (response.status === 404) {
        return { ok: false, reason: "not-found" };
      }
      if (response.status !== 200) {
        if (response.status >= 500) {
          return serverError(response);
        }
        return protocolError(response);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Never trust a 200: the bytes must hash back to the requested id.
      const verified = await verifyAssetBytes(assetId, bytes);
      if (!verified.ok) {
        return protocolError(response);
      }
      return {
        ok: true,
        blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: verified.mediaType }),
        mediaType: verified.mediaType,
      };
    },

    async headAsset(assetId): Promise<HeadAssetResult> {
      const response = await rawFetch(assetUrl(assetId), { method: "HEAD" });
      if (response === "network-error") {
        return { ok: false, reason: "network-error" };
      }
      if (response.status === 404) {
        return { ok: false, reason: "not-found" };
      }
      if (response.status === 200) {
        return { ok: true };
      }
      if (response.status >= 500) {
        return serverError(response);
      }
      return protocolError(response);
    },
  };
}
