import { engineeringTokenFromRequest, type EngineeringHandlersInput } from "./engineering-handlers";
import { errorResponse } from "./response";

/**
 * Server-side Engineering-mode write enforcement (t181).
 *
 * Every MUTATING route calls {@link requireEngineeringSession} before its
 * handler runs: without a live engineering session the write is refused
 * with 401 `engineering-session-required`. Reads stay open. A successful
 * check also refreshes the session's inactivity deadline (an active
 * editor never times out mid-edit).
 *
 * The one deliberate exception is documented in the route: the FIRST
 * workspace POST on an empty server stays open so a fresh self-hosted
 * install can finish onboarding in Use mode (see
 * `allowFirstWorkspaceBootstrap`).
 */

/**
 * Returns the 401 refusal when the request carries no live engineering
 * session, or null when the write may proceed.
 */
export function requireEngineeringSession(
  input: EngineeringHandlersInput,
  request: Request,
): Response | null {
  const token = engineeringTokenFromRequest(request);
  if (token === null || !input.sessions.isActiveSession(token)) {
    return errorResponse(401, "engineering-session-required");
  }
  return null;
}

/**
 * Whether a mutating request is the documented first-run exception:
 * workspace creation while the server still holds ZERO workspaces
 * (onboarding on a fresh install must keep working in Use mode).
 */
export function allowFirstWorkspaceBootstrap(repository: {
  listWorkspaces(): readonly unknown[];
}): boolean {
  return repository.listWorkspaces().length === 0;
}
