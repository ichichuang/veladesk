import { handleIconSearch } from "../../../../../server/api/icon-handlers";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleIconSearch(request);
}
