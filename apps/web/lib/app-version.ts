/**
 * The VelaDesk product version as shown to users (task 025 §11).
 *
 * Single source chain: root package.json `version` → next.config.ts (which
 * injects NEXT_PUBLIC_VELADESK_VERSION at build time and overrides any
 * environment value) → this constant. Components import ONLY
 * `VELADESK_VERSION` — never `process.env.NEXT_PUBLIC_...` directly and
 * never a hand-written version string. The fallback covers non-Next
 * runtimes (unit tests) where nothing is injected.
 */
export const VELADESK_VERSION: string = process.env.NEXT_PUBLIC_VELADESK_VERSION ?? "0.0.0";
