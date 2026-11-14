import { randomBytes } from "node:crypto";

/**
 * In-memory Engineering-mode session registry + unlock attempt limiter
 * (t181).
 *
 * Sessions are random 256-bit tokens handed out as an httpOnly,
 * SameSite=Strict SESSION cookie (no Max-Age: closing the browser ends
 * the session). The registry is process memory by design: the Next.js
 * standalone server is one process, a restart simply logs Engineering
 * mode out (the spec only requires surviving a browser reload), and
 * nothing secret ever needs to hit the disk.
 *
 * Inactivity: a session expires 30 minutes after its last activity
 * (`touch`). Activity is a successful unlock, an authenticated mutation,
 * or a client heartbeat — a status GET never refreshes it, so a polling
 * tab can never keep a forgotten session alive.
 *
 * Wrong-password cooldown: 5 consecutive failures lock unlocking for 30
 * seconds (server-side; the client mirrors the countdown cosmetically).
 * One successful unlock clears the counter.
 */

/** Engineering sessions expire after this much inactivity. */
export const ENGINEERING_SESSION_IDLE_MS = 30 * 60 * 1000;

/** Consecutive wrong passwords before the cooldown engages. */
export const ENGINEERING_MAX_FAILED_ATTEMPTS = 5;

/** The cooldown length once engaged. */
export const ENGINEERING_FAILURE_COOLDOWN_MS = 30 * 1000;

/** Injectable clock (tests); ms since epoch. */
export type Now = () => number;

export interface EngineeringSessionRecord {
  readonly token: string;
  readonly lastActivityMs: number;
}

/**
 * The registry. All methods are synchronous — the registry lives in
 * process memory, so there is nothing to await.
 */
export interface EngineeringSessionRegistry {
  /**
   * Issues a new session (and revokes any previous one — one Engineering
   * session per process; the desktop is a single-user surface).
   * @returns the new session token.
   */
  createSession(): string;
  /**
   * Whether the token is a live session. `touch: true` (the default)
   * refreshes its inactivity deadline; status probes pass `touch: false`.
   */
  isActiveSession(token: string, options?: { readonly touch?: boolean }): boolean;
  /** Ends the session (explicit exit). Unknown tokens are a no-op. */
  revokeSession(token: string): void;
  /** Seconds until a new unlock attempt is admitted (0 = now). */
  unlockCooldownRemainingSec(now?: number): number;
  /** Records a wrong-password attempt; returns the cooldown this attempt
   * engaged (seconds; 0 while attempts remain). */
  noteUnlockFailure(): number;
  /** Records a successful unlock (clears the failure counter). */
  noteUnlockSuccess(): void;
}

export function createEngineeringSessionRegistry(now: Now = Date.now): EngineeringSessionRegistry {
  let session: EngineeringSessionRecord | null = null;
  let failedAttempts = 0;
  let cooldownUntilMs = 0;

  return {
    createSession() {
      const token = randomBytes(32).toString("base64url");
      session = { token, lastActivityMs: now() };
      return token;
    },
    isActiveSession(token, options) {
      if (session === null || session.token !== token) {
        return false;
      }
      const current = now();
      if (current - session.lastActivityMs >= ENGINEERING_SESSION_IDLE_MS) {
        session = null;
        return false;
      }
      if (options?.touch !== false) {
        session = { token: session.token, lastActivityMs: current };
      }
      return true;
    },
    revokeSession(token) {
      if (session !== null && session.token === token) {
        session = null;
      }
    },
    unlockCooldownRemainingSec(at) {
      const current = at ?? now();
      if (current < cooldownUntilMs) {
        return Math.ceil((cooldownUntilMs - current) / 1000);
      }
      return 0;
    },
    noteUnlockFailure() {
      failedAttempts += 1;
      if (failedAttempts >= ENGINEERING_MAX_FAILED_ATTEMPTS) {
        cooldownUntilMs = now() + ENGINEERING_FAILURE_COOLDOWN_MS;
        failedAttempts = 0;
        return Math.ceil(ENGINEERING_FAILURE_COOLDOWN_MS / 1000);
      }
      return 0;
    },
    noteUnlockSuccess() {
      failedAttempts = 0;
      cooldownUntilMs = 0;
    },
  };
}
