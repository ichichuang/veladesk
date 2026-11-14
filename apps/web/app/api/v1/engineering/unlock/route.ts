import { getEngineeringAuth } from "../../../../../server/runtime";
import { handleEngineeringUnlock } from "../../../../../server/api/engineering-handlers";

export const runtime = "nodejs";

/** POST /api/v1/engineering/unlock — password verification → session cookie. */
export async function POST(request: Request): Promise<Response> {
  return handleEngineeringUnlock(getEngineeringAuth(), request);
}
