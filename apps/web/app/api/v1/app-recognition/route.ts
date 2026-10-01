import { handleAppRecognition } from "../../../../server/api/app-recognition-handlers";

export const runtime = "nodejs";

/**
 * POST /api/v1/app-recognition — smart Add-App recognition.
 *
 * DNS-pinned fetching requires the Node runtime; the route stays a thin
 * adapter (no decoding, no business logic) per the web-server layering
 * contract.
 */
export async function POST(request: Request): Promise<Response> {
  return handleAppRecognition(request);
}
