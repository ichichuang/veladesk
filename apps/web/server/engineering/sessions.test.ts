import { describe, expect, it } from "vitest";

import {
  createEngineeringSessionRegistry,
  ENGINEERING_FAILURE_COOLDOWN_MS,
  ENGINEERING_MAX_FAILED_ATTEMPTS,
} from "./sessions";

describe("engineering session registry", () => {
  it("issues tokens that are active and touch-refreshable", () => {
    let now = 1_000_000;
    const registry = createEngineeringSessionRegistry(() => now);
    const token = registry.createSession();
    expect(registry.isActiveSession(token)).toBe(true);

    // Touching advances the idle deadline.
    now += 10 * 60 * 1000;
    expect(registry.isActiveSession(token)).toBe(true);

    // 30 minutes of silence expires it.
    now += 31 * 60 * 1000;
    expect(registry.isActiveSession(token)).toBe(false);
  });

  it("a status probe never refreshes the idle deadline", () => {
    let now = 0;
    const registry = createEngineeringSessionRegistry(() => now);
    const token = registry.createSession();

    // Poll every minute WITHOUT touching: at the 30-minute mark it is gone.
    for (let minute = 0; minute < 31; minute++) {
      now += 60 * 1000;
      expect(registry.isActiveSession(token, { touch: false })).toBe(minute < 29);
    }
    expect(registry.isActiveSession(token)).toBe(false);
  });

  it("revoking ends exactly the matching session", () => {
    const registry = createEngineeringSessionRegistry();
    const token = registry.createSession();
    registry.revokeSession(token);
    expect(registry.isActiveSession(token)).toBe(false);
    registry.revokeSession("unknown-token"); // no-op, no throw
  });

  it("a new session supersedes the previous one (one per process)", () => {
    const registry = createEngineeringSessionRegistry();
    const first = registry.createSession();
    const second = registry.createSession();
    expect(registry.isActiveSession(first)).toBe(false);
    expect(registry.isActiveSession(second)).toBe(true);
  });

  it("engages the 30s cooldown after 5 consecutive failures", () => {
    let now = 0;
    const registry = createEngineeringSessionRegistry(() => now);
    for (let attempt = 0; attempt < ENGINEERING_MAX_FAILED_ATTEMPTS - 1; attempt++) {
      registry.noteUnlockFailure();
      expect(registry.unlockCooldownRemainingSec()).toBe(0);
    }
    registry.noteUnlockFailure();
    expect(registry.unlockCooldownRemainingSec()).toBe(
      Math.ceil(ENGINEERING_FAILURE_COOLDOWN_MS / 1000),
    );

    now += 29_000;
    expect(registry.unlockCooldownRemainingSec()).toBe(1);
    now += 1_000;
    expect(registry.unlockCooldownRemainingSec()).toBe(0);
  });

  it("a success resets the failure counter", () => {
    const registry = createEngineeringSessionRegistry();
    for (let attempt = 0; attempt < ENGINEERING_MAX_FAILED_ATTEMPTS - 1; attempt++) {
      registry.noteUnlockFailure();
    }
    registry.noteUnlockSuccess();
    registry.noteUnlockFailure();
    expect(registry.unlockCooldownRemainingSec()).toBe(0);
  });
});
