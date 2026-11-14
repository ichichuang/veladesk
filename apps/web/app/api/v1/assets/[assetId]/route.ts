import {
  getAssetRepository,
  getAssetUploadGuard,
  getEngineeringAuth,
} from "../../../../../server/runtime";
import {
  handleGetAsset,
  handleHeadAsset,
  handlePutAsset,
} from "../../../../../server/api/asset-handlers";
import { requireEngineeringSession } from "../../../../../server/api/engineering-guard";

export const runtime = "nodejs";

interface AssetRouteContext {
  params: Promise<{ assetId: string }>;
}

export async function PUT(request: Request, context: AssetRouteContext): Promise<Response> {
  // t181: uploads only happen while editing; Use mode gets no asset writes.
  const denied = requireEngineeringSession(getEngineeringAuth(), request);
  if (denied !== null) {
    return denied;
  }
  const { assetId } = await context.params;
  return handlePutAsset(getAssetRepository(), request, assetId, getAssetUploadGuard());
}

export async function GET(_request: Request, context: AssetRouteContext): Promise<Response> {
  const { assetId } = await context.params;
  return handleGetAsset(getAssetRepository(), assetId);
}

export async function HEAD(_request: Request, context: AssetRouteContext): Promise<Response> {
  const { assetId } = await context.params;
  return handleHeadAsset(getAssetRepository(), assetId);
}
