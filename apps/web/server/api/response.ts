/**
 * HTTP response helpers for the workspace API.
 *
 * Handlers return standard `Response` objects (no Next-specific APIs) so
 * they run directly under Vitest; `route.ts` files are pure Next adapters.
 * Every JSON response is same-origin-only and carries `Cache-Control:
 * no-store`, because each request reads live SQLite state.
 */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

/**
 * Standard error envelope: `{ "error": { "code": "...", ... } }`.
 * Expected business/request failures never leak as HTML error bodies.
 */
export function errorResponse(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ error: { code, ...extra } }, { status });
}
