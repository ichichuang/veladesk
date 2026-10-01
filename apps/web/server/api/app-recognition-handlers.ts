/**
 * POST /api/v1/app-recognition — the Add-App recognition endpoint
 * (task 020-A §24).
 *
 * Same envelope conventions as the other v1 routes (`{ recognition }` on
 * success, `{ error: { code } }` on failure, `Cache-Control: no-store`).
 * This is NOT a generic proxy: it accepts exactly one `{ url }` field and
 * performs exactly one operation — recognition. There is nothing to
 * forward: no headers, no methods, no arbitrary bodies reach the remote
 * fetch (the recognizer builds its own minimal request). Like every other
 * route at this deployment stage, it runs trusted-LAN/same-origin with no
 * session — the same posture as the workspace and asset routes.
 */

import { APP_RECOGNITION_MAX_URL_LENGTH } from "../../features/app-recognition/contract";
import { recognizeAppUrl } from "../app-recognition/recognize-app-url";
import type { RecognizeAppUrlResult } from "../app-recognition/recognize-app-url";
import { isRecord, parseJsonBody } from "./input";
import { errorResponse, jsonResponse } from "./response";

export type RecognizeFn = (input: string) => Promise<RecognizeAppUrlResult>;

export async function handleAppRecognition(
  request: Request,
  recognize: RecognizeFn = recognizeAppUrl
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }
  if (
    !isRecord(body.value) ||
    typeof body.value.url !== "string" ||
    body.value.url.trim().length === 0 ||
    body.value.url.length > APP_RECOGNITION_MAX_URL_LENGTH
  ) {
    return errorResponse(400, "invalid-request");
  }

  const result = await recognize(body.value.url);
  if (result.ok) {
    return jsonResponse({ recognition: result.recognition });
  }
  switch (result.reason) {
    case "invalid":
      return errorResponse(400, "invalid-url");
    case "unsupported-protocol":
      return errorResponse(400, "unsupported-protocol");
    case "credentials-not-allowed":
      return errorResponse(400, "credentials-not-allowed");
    case "unsupported-port":
      return errorResponse(400, "unsupported-port");
    case "unsafe-host":
      return errorResponse(422, "unsafe-destination");
  }
}
