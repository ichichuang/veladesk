/**
 * Smart App Recognition contract (task 020-A) — the serializable shape
 * the server recognizer returns and the Add-App form consumes.
 *
 * Pure data only: this module is imported by BOTH the server recognizer
 * (`server/app-recognition/*`) and client form state, so it must never
 * touch node builtins, the DOM or React. Recognition results are EPHEMERAL
 * Add-App form state — nothing here may leak into the persisted
 * WorkspaceSnapshot.
 */

/** How strongly the recognizer trusts its suggestion. */
export type RecognitionConfidence = "high" | "medium" | "low";

/** Where the suggested application name came from (weakest last). */
export type RecognitionNameSource =
  | "brand"
  | "application-name"
  | "og-site-name"
  | "manifest-short-name"
  | "manifest-name"
  | "title"
  | "hostname";

/**
 * The suggested icon. `catalog` reuses a bundled icon-catalog id; an
 * `embedded-image` carries bounded, magic-byte-validated image BYTES fetched
 * server-side (never a remote URL — the browser must not contact the target
 * site); `generated` falls back to derived initials.
 */
export type RecognitionIcon =
  | {
      readonly kind: "catalog";
      readonly iconKey: string;
      readonly displayName: string;
      readonly source: "brand";
    }
  | {
      readonly kind: "embedded-image";
      readonly mimeType: string;
      readonly base64: string;
      readonly source: "manifest" | "apple-touch-icon" | "favicon";
    }
  | {
      readonly kind: "generated";
      readonly source: "generated";
    };

export interface AppRecognitionResult {
  readonly normalizedUrl: string;
  readonly hostname: string;
  readonly name: string;
  readonly nameSource: RecognitionNameSource;
  readonly icon: RecognitionIcon;
  readonly confidence: RecognitionConfidence;
  readonly status: "recognized" | "partial";
}

/** Structured server error codes (HTTP `error.code`), kebab-case like the rest of the API. */
export type AppRecognitionErrorCode =
  | "invalid-url"
  | "unsupported-protocol"
  | "credentials-not-allowed"
  | "unsupported-port"
  | "unsafe-destination"
  | "recognition-failed";

/** The single endpoint the Add-App form may call for recognition. */
export const APP_RECOGNITION_API_PATH = "/api/v1/app-recognition";

/**
 * Maximum accepted URL length. The Add-App input already caps at 2048;
 * recognition enforces the same budget server-side.
 */
export const APP_RECOGNITION_MAX_URL_LENGTH = 2048;

/** Decode a raw JSON value into a recognition result; undefined when malformed. */
export function decodeAppRecognitionResult(value: unknown): AppRecognitionResult | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.normalizedUrl !== "string" ||
    typeof record.hostname !== "string" ||
    typeof record.name !== "string" ||
    typeof record.nameSource !== "string" ||
    typeof record.confidence !== "string" ||
    (record.status !== "recognized" && record.status !== "partial")
  ) {
    return undefined;
  }
  const icon = decodeRecognitionIcon(record.icon);
  if (icon === undefined) {
    return undefined;
  }
  return {
    normalizedUrl: record.normalizedUrl,
    hostname: record.hostname,
    name: record.name,
    nameSource: record.nameSource as RecognitionNameSource,
    icon,
    confidence: record.confidence as RecognitionConfidence,
    status: record.status,
  };
}

function decodeRecognitionIcon(value: unknown): RecognitionIcon | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "catalog") {
    if (typeof record.iconKey !== "string" || typeof record.displayName !== "string") {
      return undefined;
    }
    return { kind: "catalog", iconKey: record.iconKey, displayName: record.displayName, source: "brand" };
  }
  if (record.kind === "embedded-image") {
    if (typeof record.mimeType !== "string" || typeof record.base64 !== "string") {
      return undefined;
    }
    if (
      record.source !== "manifest" &&
      record.source !== "apple-touch-icon" &&
      record.source !== "favicon"
    ) {
      return undefined;
    }
    return { kind: "embedded-image", mimeType: record.mimeType, base64: record.base64, source: record.source };
  }
  if (record.kind === "generated") {
    return { kind: "generated", source: "generated" };
  }
  return undefined;
}
