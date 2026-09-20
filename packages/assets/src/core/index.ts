/**
 * Public API of @veladesk/assets/core.
 *
 * Pure, dependency-free, identical in Node 24 and the browser. The server
 * imports ONLY this entry point — never ./browser.
 */

export { MAX_ASSET_BYTES } from "./types";
export type {
  ContentAssetId,
  PrepareAssetFailureReason,
  PrepareAssetResult,
  PreparedAsset,
  StoredAssetInfo,
  UploadedAssetMediaType,
  VerifyAssetFailureReason,
  VerifyAssetResult,
} from "./types";

export { detectUploadedImageMediaType } from "./media";

export {
  createContentAssetId,
  hashAssetBytes,
  isContentAssetId,
  prepareAssetBlob,
  storedAssetInfoFromBytes,
  verifyAssetBytes,
} from "./id";
