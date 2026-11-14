import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createEngineeringCredentialStore } from "../engineering/auth-store";
import { createEngineeringSessionRegistry, ENGINEERING_MAX_FAILED_ATTEMPTS } from "../engineering/sessions";
import { hashEngineeringPassword, DEFAULT_ENGINEERING_PASSWORD } from "../engineering/password";
import type { EngineeringHandlersInput } from "./engineering-handlers";
import {
  ENGINEERING_COOKIE_NAME,
  handleEngineeringPasswordChange,
  handleEngineeringSessionHeartbeat,
  handleEngineeringSessionStatus,
  handleEngineeringUnlock,
  handleEngineeringLogout,
} from "./engineering-handlers";
import { requireEngineeringSession } from "./engineering-guard";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function trackedInput(): EngineeringHandlersInput {
  const dir = mkdtempSync(join(tmpdir(), "veladesk-eng-api-"));
  dirs.push(dir);
  return {
    credentials: createEngineeringCredentialStore(dir),
    sessions: createEngineeringSessionRegistry(),
  };
}

function jsonRequest(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/v1/engineering/x", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function unlock(input: EngineeringHandlersInput, password: string): Promise<Response> {
  return handleEngineeringUnlock(input, jsonRequest({ password }));
}

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

describe("engineering unlock handler", () => {
  it("accepts the default password and sets an httpOnly SameSite=Strict session cookie", async () => {
    const input = trackedInput();
    const response = await unlock(input, DEFAULT_ENGINEERING_PASSWORD);
    expect(response.status).toBe(200);
    const cookie = cookieOf(response);
    expect(cookie).toContain(`${ENGINEERING_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Max-Age"); // session cookie: browser close ends it
    expect(cookie).not.toContain("Expires");
  });

  it("refuses a wrong password with 401", async () => {
    const input = trackedInput();
    const response = await unlock(input, "999999");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "engineering-password-wrong" },
    });
  });

  it("accepts a stored custom password and rejects the default afterwards", async () => {
    const input = trackedInput();
    input.credentials.save(hashEngineeringPassword("135790"));
    expect((await unlock(input, "135790")).status).toBe(200);
    expect((await unlock(input, DEFAULT_ENGINEERING_PASSWORD)).status).toBe(401);
  });

  it("5 consecutive failures engage the server-side cooldown (429 + retryAfterSec)", async () => {
    const input = trackedInput();
    for (let attempt = 0; attempt < ENGINEERING_MAX_FAILED_ATTEMPTS - 1; attempt++) {
      expect((await unlock(input, "000000")).status).toBe(401);
    }
    const blocked = await unlock(input, "000000");
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: { code: string; retryAfterSec: number } };
    expect(body.error.code).toBe("engineering-unlock-cooldown");
    expect(body.error.retryAfterSec).toBeGreaterThan(0);
    // Even the CORRECT password is refused during the cooldown.
    expect((await unlock(input, DEFAULT_ENGINEERING_PASSWORD)).status).toBe(429);
  });

  it("rejects malformed bodies with 400", async () => {
    const input = trackedInput();
    const missing = await handleEngineeringUnlock(
      input,
      new Request("http://localhost/x", { method: "POST", body: "{}" }),
    );
    expect(missing.status).toBe(400);
  });
});

describe("engineering session handler", () => {
  it("status reports active only with a live session cookie", async () => {
    const input = trackedInput();
    const unlocked = await unlock(input, DEFAULT_ENGINEERING_PASSWORD);
    const cookie = cookieOf(unlocked).split(";")[0]!;

    const statusRequest = new Request("http://localhost/x", { headers: { cookie } });
    const active = await handleEngineeringSessionStatus(input, statusRequest);
    await expect(active.json()).resolves.toEqual({ active: true });

    const none = await handleEngineeringSessionStatus(input, new Request("http://localhost/x"));
    await expect(none.json()).resolves.toEqual({ active: false });
  });

  it("heartbeat refreshes a live session and 401s a dead one", async () => {
    let now = 0;
    const dir = mkdtempSync(join(tmpdir(), "veladesk-eng-api-"));
    dirs.push(dir);
    const input: EngineeringHandlersInput = {
      credentials: createEngineeringCredentialStore(dir),
      sessions: createEngineeringSessionRegistry(() => now),
    };
    const unlocked = await unlock(input, DEFAULT_ENGINEERING_PASSWORD);
    const cookie = cookieOf(unlocked).split(";")[0]!;
    const request = () => new Request("http://localhost/x", { method: "POST", headers: { cookie } });

    now += 29 * 60 * 1000;
    expect((await handleEngineeringSessionHeartbeat(input, request())).status).toBe(200);
    now += 29 * 60 * 1000; // Still alive ONLY because the heartbeat touched it.
    expect((await handleEngineeringSessionHeartbeat(input, request())).status).toBe(200);
  });

  it("logout revokes the session and clears the cookie", async () => {
    const input = trackedInput();
    const unlocked = await unlock(input, DEFAULT_ENGINEERING_PASSWORD);
    const cookie = cookieOf(unlocked).split(";")[0]!;

    const logout = await handleEngineeringLogout(
      input,
      new Request("http://localhost/x", { method: "DELETE", headers: { cookie } }),
    );
    expect(logout.status).toBe(204);
    expect(cookieOf(logout)).toContain("Max-Age=0");

    const status = await handleEngineeringSessionStatus(
      input,
      new Request("http://localhost/x", { headers: { cookie } }),
    );
    await expect(status.json()).resolves.toEqual({ active: false });
  });
});

describe("engineering password change handler", () => {
  it("requires a live session", async () => {
    const input = trackedInput();
    const response = await handleEngineeringPasswordChange(
      input,
      jsonRequest({ currentPassword: "123456", newPassword: "654321" }),
    );
    expect(response.status).toBe(401);
  });

  it("changes the password only with the correct current password", async () => {
    const input = trackedInput();
    const unlocked = await unlock(input, DEFAULT_ENGINEERING_PASSWORD);
    const cookie = cookieOf(unlocked).split(";")[0]!;

    const wrongCurrent = await handleEngineeringPasswordChange(
      input,
      jsonRequest({ currentPassword: "000000", newPassword: "654321" }, cookie),
    );
    expect(wrongCurrent.status).toBe(401);

    const invalid = await handleEngineeringPasswordChange(
      input,
      jsonRequest({ currentPassword: DEFAULT_ENGINEERING_PASSWORD, newPassword: "abc" }, cookie),
    );
    expect(invalid.status).toBe(422);

    const ok = await handleEngineeringPasswordChange(
      input,
      jsonRequest({ currentPassword: DEFAULT_ENGINEERING_PASSWORD, newPassword: "654321" }, cookie),
    );
    expect(ok.status).toBe(200);

    // The NEW password unlocks from now on; the old one no longer does.
    expect((await unlock(input, "654321")).status).toBe(200);
    expect((await unlock(input, DEFAULT_ENGINEERING_PASSWORD)).status).toBe(401);
  });
});

describe("requireEngineeringSession write guard", () => {
  it("blocks writes without a session (401 engineering-session-required)", async () => {
    const input = trackedInput();
    const denied = requireEngineeringSession(input, new Request("http://localhost/x", { method: "PUT" }));
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(401);
    await expect(denied!.json()).resolves.toEqual({
      error: { code: "engineering-session-required" },
    });
  });

  it("admits writes with a live session cookie", async () => {
    const input = trackedInput();
    const unlocked = await unlock(input, DEFAULT_ENGINEERING_PASSWORD);
    const cookie = cookieOf(unlocked).split(";")[0]!;
    const admitted = requireEngineeringSession(
      input,
      new Request("http://localhost/x", { method: "PUT", headers: { cookie } }),
    );
    expect(admitted).toBeNull();
  });
});
