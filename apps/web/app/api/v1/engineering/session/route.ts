import { getEngineeringAuth } from "../../../../../server/runtime";
import {
  handleEngineeringSessionHeartbeat,
  handleEngineeringSessionStatus,
  handleEngineeringLogout,
} from "../../../../../server/api/engineering-handlers";

export const runtime = "nodejs";

/**
 * /api/v1/engineering/session — the Engineering-mode session probe.
 *
 * GET never refreshes the session (a polling tab cannot keep a forgotten
 * session alive); POST is the client heartbeat; DELETE is the explicit
 * exit. Route stays a thin adapter per the web-server layering contract.
 */
export async function GET(request: Request): Promise<Response> {
  return handleEngineeringSessionStatus(getEngineeringAuth(), request);
}

export async function POST(request: Request): Promise<Response> {
  return handleEngineeringSessionHeartbeat(getEngineeringAuth(), request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleEngineeringLogout(getEngineeringAuth(), request);
}
