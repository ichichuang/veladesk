import { getAssetRepository } from "../../../../../server/runtime";
import {
  handleGetAsset,
  handleHeadAsset,
  handlePutAsset,
} from "../../../../../server/api/asset-handlers";

export const runtime = "nodejs";

interface AssetRouteContext {
  params: Promise<{ assetId: string }>;
}

export async function PUT(request: Request, context: AssetRouteContext): Promise<Response> {
  const { assetId } = await context.params;
  return handlePutAsset(getAssetRepository(), request, assetId);
}

export async function GET(_request: Request, context: AssetRouteContext): Promise<Response> {
  const { assetId } = await context.params;
  return handleGetAsset(getAssetRepository(), assetId);
}

export async function HEAD(_request: Request, context: AssetRouteContext): Promise<Response> {
  const { assetId } = await context.params;
  return handleHeadAsset(getAssetRepository(), assetId);
}
