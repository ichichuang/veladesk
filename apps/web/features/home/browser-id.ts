/**
 * Browser identifier generation for local-first objects.
 *
 * Uses the platform CSPRNG via `crypto.randomUUID()` — never Math.random
 * or timestamps. Kept as an isolated helper so a future extension host can
 * reuse or replace it. Throws a clear error instead of silently degrading.
 */
export function createBrowserId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error(
      "VelaDesk needs crypto.randomUUID to generate identifiers; this browser does not provide it."
    );
  }
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}
