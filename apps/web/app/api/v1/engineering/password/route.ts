import { getEngineeringAuth } from "../../../../../server/runtime";
import { handleEngineeringPasswordChange } from "../../../../../server/api/engineering-handlers";

export const runtime = "nodejs";

/**
 * POST /api/v1/engineering/password — change the Engineering-mode password.
 * Requires a live engineering session; the current password is re-verified.
 */
export async function POST(request: Request): Promise<Response> {
  return handleEngineeringPasswordChange(getEngineeringAuth(), request);
}
