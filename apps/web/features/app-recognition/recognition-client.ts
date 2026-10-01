/**
 * The recognition HTTP client (task 020-A §24, §52).
 *
 * The ONLY fetch the Add-App form ever issues: a POST to VelaDesk's own
 * recognition endpoint. It never fetches the target site, a detected
 * favicon URL, or any other remote origin — all target-site access
 * happens server-side behind the safe-public-fetch boundary.
 */

import {
  APP_RECOGNITION_API_PATH,
  decodeAppRecognitionResult,
  type AppRecognitionErrorCode,
  type AppRecognitionResult,
} from "./contract";

export type AppRecognitionRequestOutcome =
  | { readonly ok: true; readonly result: AppRecognitionResult }
  | { readonly ok: false; readonly code: AppRecognitionClientErrorCode };

/** Server codes plus the client-side transport failure. */
export type AppRecognitionClientErrorCode = AppRecognitionErrorCode | "network-error";

export type RecognitionSend = (
  url: string,
  signal: AbortSignal
) => Promise<AppRecognitionRequestOutcome>;

export function createRecognitionSender(
  fetchImpl: typeof fetch = (...args) => fetch(...args)
): RecognitionSend {
  return async (url, signal) => {
    let response: Response;
    try {
      response = await fetchImpl(APP_RECOGNITION_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ url }),
        signal,
      });
    } catch {
      // Aborted requests surface here too; the controller's sequence guard
      // discards them, so a single transport-failure code is enough.
      return { ok: false, code: "network-error" };
    }
    if (!response.ok) {
      return { ok: false, code: await decodeErrorCode(response) };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, code: "recognition-failed" };
    }
    const recognition = decodeAppRecognitionResult(
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).recognition
        : undefined
    );
    if (recognition === undefined) {
      return { ok: false, code: "recognition-failed" };
    }
    return { ok: true, result: recognition };
  };
}

async function decodeErrorCode(response: Response): Promise<AppRecognitionClientErrorCode> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    if (typeof body?.error?.code === "string" && body.error.code.length > 0) {
      return body.error.code as AppRecognitionClientErrorCode;
    }
  } catch {
    // fall through to the generic code
  }
  return "recognition-failed";
}
