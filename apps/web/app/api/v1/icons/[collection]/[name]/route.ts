import { handleIconSvg } from "../../../../../../server/api/icon-handlers";

export const runtime = "nodejs";

interface IconRouteContext {
  params: Promise<{ collection: string; name: string }>;
}

export async function GET(_request: Request, context: IconRouteContext): Promise<Response> {
  const { collection, name } = await context.params;
  return handleIconSvg(collection, name);
}
