import { handleIconSearch } from "../../../../../server/api/icon-handlers";

// (touch: recompile this route's module graph so a workspace icon-catalog
//  edit — the F4a curated-list prune — is picked up by the running dev
//  server without a restart.)
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleIconSearch(request);
}
