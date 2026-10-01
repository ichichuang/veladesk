import { describe, expect, it } from "vitest";

import type { AppRecognitionResult } from "../../features/app-recognition/contract";
import type { RecognizeFn } from "./app-recognition-handlers";
import { handleAppRecognition } from "./app-recognition-handlers";

function recognitionResult(): AppRecognitionResult {
  return {
    normalizedUrl: "https://github.com/",
    hostname: "github.com",
    name: "GitHub",
    nameSource: "brand",
    icon: {
      kind: "catalog",
      iconKey: "simple-icons:github",
      displayName: "GitHub",
      source: "brand",
    },
    confidence: "high",
    status: "recognized",
  };
}

function post(body: unknown): Request {
  return new Request("http://local.veladesk/api/v1/app-recognition", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("handleAppRecognition", () => {
  it("returns the recognition envelope with no-store", async () => {
    const recognize: RecognizeFn = async () => ({
      ok: true,
      recognition: recognitionResult(),
    });
    const response = await handleAppRecognition(post({ url: "github.com" }), recognize);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ recognition: recognitionResult() });
  });

  it("rejects malformed bodies with 400 invalid-request", async () => {
    const recognize: RecognizeFn = async () => {
      throw new Error("must not be called");
    };
    expect((await handleAppRecognition(post({}), recognize)).status).toBe(400);
    expect((await handleAppRecognition(post({ url: 42 }), recognize)).status).toBe(400);
    expect((await handleAppRecognition(post({ url: "   " }), recognize)).status).toBe(400);
    expect((await handleAppRecognition(post({ url: `https://x.example/${"a".repeat(2100)}` }), recognize)).status).toBe(400);
    const invalidJson = await handleAppRecognition(post("{nope"), recognize);
    expect(invalidJson.status).toBe(400);
    expect(((await invalidJson.json()) as { error: { code: string } }).error.code).toBe("invalid-json");
  });

  it("maps recognizer failures to structured error codes", async () => {
    const cases: ReadonlyArray<[{ ok: false; reason: "invalid" | "unsupported-protocol" | "credentials-not-allowed" | "unsupported-port" | "unsafe-host" }, number, string]> = [
      [{ ok: false, reason: "invalid" }, 400, "invalid-url"],
      [{ ok: false, reason: "unsupported-protocol" }, 400, "unsupported-protocol"],
      [{ ok: false, reason: "credentials-not-allowed" }, 400, "credentials-not-allowed"],
      [{ ok: false, reason: "unsupported-port" }, 400, "unsupported-port"],
      [{ ok: false, reason: "unsafe-host" }, 422, "unsafe-destination"],
    ];
    for (const [failure, status, code] of cases) {
      const recognize: RecognizeFn = async () => failure;
      const response = await handleAppRecognition(post({ url: "https://x.example/" }), recognize);
      expect(response.status, code).toBe(status);
      expect(await response.json()).toEqual({ error: { code } });
    }
  });

  it("forwards the raw URL string to the recognizer (normalization is the recognizer's job)", async () => {
    let seen: string | undefined;
    const recognize: RecognizeFn = async (input) => {
      seen = input;
      return { ok: true, recognition: recognitionResult() };
    };
    await handleAppRecognition(post({ url: "  github.com  " }), recognize);
    expect(seen).toBe("  github.com  ");
  });
});
