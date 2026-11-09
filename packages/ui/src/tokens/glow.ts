/**
 * Glow token constants (P1-ENG-1) — INTENTIONALLY AN EMPTY SLOT. No glow
 * token exists in the shipped token layer yet; the visual designer's token
 * draft (pending) fills this module. Until then: components must not
 * hard-code glow literals; the only related shipped values are the
 * `--vdu-shadow` / `--vdu-shadow-pop` elevation shadows, which stay in
 * tokens.css and are not duplicated here.
 */

/** Named glow bands. Empty until the designer draft is ratified. */
export const VD_GLOW = {} as const;

/** A named glow role in {@link VD_GLOW}. */
export type VdGlowRole = keyof typeof VD_GLOW;
