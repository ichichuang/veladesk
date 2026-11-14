import type { EngineeringCredentialStore } from "../engineering/auth-store";
import type { EngineeringSessionRegistry } from "../engineering/sessions";
import {
  hashEngineeringPassword,
  isValidNewEngineeringPassword,
  verifyEngineeringPassword,
} from "../engineering/password";
import { isRecord, parseJsonBody } from "./input";
import { errorResponse, jsonResponse } from "./response";

/**
 * HTTP handlers for Engineering mode (t181): the hidden session gate that
 * unlocks the desktop's editing surface.
 *
 * Routes (all thin Next adapters over these handlers):
 *   GET    /api/v1/engineering/session  — status probe (never refreshes)
 *   POST   /api/v1/engineering/session  — heartbeat (refreshes a live session)
 *   DELETE /api/v1/engineering/session  — explicit exit (revokes + clears cookie)
 *   POST   /api/v1/engineering/unlock   — password verification (sets cookie)
 *   POST   /api/v1/engineering/password — change password (needs a live session)
 *
 * The password is verified HERE, never in client JS; only the salted
 * scrypt hash is persisted (`engineering.json` in the data dir). Sessions
 * are random tokens in an httpOnly, SameSite=Strict session cookie.
 */

/** The Engineering-mode session cookie (httpOnly, SameSite=Strict, session-scoped). */
export const ENGINEERING_COOKIE_NAME = "veladesk_engineering";

/** Dependencies the handlers run against; tests inject fakes. */
export interface EngineeringHandlersInput {
  readonly credentials: EngineeringCredentialStore;
  readonly sessions: EngineeringSessionRegistry;
}

/** Extracts the engineering cookie token from a request, if present. */
export function engineeringTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (header === null || header.length === 0) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name === ENGINEERING_COOKIE_NAME) {
      const value = part.slice(separator + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

function sessionCookie(token: string): string {
  return `${ENGINEERING_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

function clearedSessionCookie(): string {
  return `${ENGINEERING_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** GET /api/v1/engineering/session — `{ active }`; never refreshes the session. */
export function handleEngineeringSessionStatus(
  input: EngineeringHandlersInput,
  request: Request,
): Response {
  const token = engineeringTokenFromRequest(request);
  const active = token !== null && input.sessions.isActiveSession(token, { touch: false });
  return jsonResponse({ active });
}

/** POST /api/v1/engineering/session — heartbeat: refreshes a live session. */
export function handleEngineeringSessionHeartbeat(
  input: EngineeringHandlersInput,
  request: Request,
): Response {
  const token = engineeringTokenFromRequest(request);
  if (token === null || !input.sessions.isActiveSession(token)) {
    return errorResponse(401, "engineering-session-required");
  }
  return jsonResponse({ active: true });
}

/** DELETE /api/v1/engineering/session — explicit exit. */
export function handleEngineeringLogout(
  input: EngineeringHandlersInput,
  request: Request,
): Response {
  const token = engineeringTokenFromRequest(request);
  if (token !== null) {
    input.sessions.revokeSession(token);
  }
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearedSessionCookie(), "Cache-Control": "no-store" },
  });
}

/** POST /api/v1/engineering/unlock — `{ password }` → session cookie. */
export async function handleEngineeringUnlock(
  input: EngineeringHandlersInput,
  request: Request,
): Promise<Response> {
  const cooldownSec = input.sessions.unlockCooldownRemainingSec();
  if (cooldownSec > 0) {
    return errorResponse(429, "engineering-unlock-cooldown", { retryAfterSec: cooldownSec });
  }
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }
  const password =
    isRecord(body.value) && typeof body.value.password === "string"
      ? body.value.password
      : undefined;
  if (password === undefined || password.length === 0 || password.length > 128) {
    return errorResponse(400, "invalid-request");
  }
  if (!verifyEngineeringPassword(password, input.credentials.load())) {
    // The attempt that engages the cooldown answers 429 itself (with the
    // remaining seconds) — the client can render the countdown at once.
    const engagedCooldownSec = input.sessions.noteUnlockFailure();
    if (engagedCooldownSec > 0) {
      return errorResponse(429, "engineering-unlock-cooldown", {
        retryAfterSec: engagedCooldownSec,
      });
    }
    return errorResponse(401, "engineering-password-wrong");
  }
  input.sessions.noteUnlockSuccess();
  const token = input.sessions.createSession();
  return jsonResponse({ active: true }, { headers: { "Set-Cookie": sessionCookie(token) } });
}

/**
 * POST /api/v1/engineering/password — `{ currentPassword, newPassword }`.
 * Requires a live engineering session; the current password is re-verified
 * before the new hash is stored.
 */
export async function handleEngineeringPasswordChange(
  input: EngineeringHandlersInput,
  request: Request,
): Promise<Response> {
  const token = engineeringTokenFromRequest(request);
  if (token === null || !input.sessions.isActiveSession(token)) {
    return errorResponse(401, "engineering-session-required");
  }
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }
  const currentPassword =
    isRecord(body.value) && typeof body.value.currentPassword === "string"
      ? body.value.currentPassword
      : undefined;
  const newPassword =
    isRecord(body.value) && typeof body.value.newPassword === "string"
      ? body.value.newPassword
      : undefined;
  if (currentPassword === undefined || newPassword === undefined) {
    return errorResponse(400, "invalid-request");
  }
  if (!verifyEngineeringPassword(currentPassword, input.credentials.load())) {
    return errorResponse(401, "engineering-password-wrong");
  }
  if (!isValidNewEngineeringPassword(newPassword)) {
    return errorResponse(422, "engineering-password-invalid");
  }
  input.credentials.save(hashEngineeringPassword(newPassword));
  return jsonResponse({ ok: true });
}
