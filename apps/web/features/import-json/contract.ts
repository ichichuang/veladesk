/**
 * VelaDesk Import JSON v1 — public contract (task 024).
 *
 * This is the AI/human-friendly IMPORT format: sections (categories) +
 * application display names + URLs + an automatic icon choice. It is
 * deliberately independent from the internal WorkspaceSnapshot model so
 * the two can evolve separately. It is NOT a backup format and exposes no
 * internal ids, coordinates, geometry or asset references — VelaDesk
 * generates all of those at import time.
 */

export const IMPORT_FORMAT_IDENTITY = "veladesk-import";

export const IMPORT_FORMAT_VERSION = 1;

/**
 * v1 scale limits. The domain package imposes no entity-count or length
 * caps (names/urls only need to be non-blank), and no smaller project-level
 * text-import limit exists, so these defaults stand (task 024 §10):
 * existing stricter limits would win, none do.
 */
export const IMPORT_MAX_SECTIONS = 100;

export const IMPORT_MAX_APPS = 2000;

/** Hard byte ceiling for an uploaded JSON file (checked before reading). */
export const IMPORT_MAX_JSON_BYTES = 1024 * 1024; // 1 MiB

/** Character ceiling for pasted JSON text (paste-mode file-limit analogue). */
export const IMPORT_MAX_JSON_TEXT_LENGTH = 1024 * 1024;

/** Mirrors the New Section dialog's `maxLength`. */
export const IMPORT_MAX_SECTION_NAME_LENGTH = 80;

/** Mirrors the Add App dialog's `maxLength`. */
export const IMPORT_MAX_APP_NAME_LENGTH = 80;

/** Mirrors the Add App URL `maxLength` / APP_RECOGNITION_MAX_URL_LENGTH. */
export const IMPORT_MAX_URL_LENGTH = 2048;

// --- Issue model (task 024 §14) -------------------------------------------------
//
// Pure modules never return localized prose: they return structured issues
// and the UI maps codes onto zh-CN / en-US copy.

export type ImportIssueSeverity = "error" | "warning";

export type ImportIssueCode =
  | "INVALID_JSON"
  | "FILE_TOO_LARGE"
  | "INVALID_ROOT"
  | "INVALID_FORMAT"
  | "UNSUPPORTED_VERSION"
  | "MISSING_SECTIONS"
  | "INVALID_SECTIONS"
  | "TOO_MANY_SECTIONS"
  | "MISSING_SECTION_NAME"
  | "INVALID_SECTION_NAME"
  | "INVALID_SECTION"
  | "MISSING_APPS"
  | "INVALID_APPS"
  | "TOO_MANY_APPS"
  | "MISSING_APP_NAME"
  | "INVALID_APP_NAME"
  | "INVALID_APP"
  | "MISSING_APP_URL"
  | "INVALID_APP_URL"
  | "INVALID_ICON"
  | "UNSUPPORTED_FIELD_IGNORED"
  | "DUPLICATE_IMPORT_SECTION"
  | "DUPLICATE_IMPORT_APP"
  | "DUPLICATE_WORKSPACE_APP"
  | "AMBIGUOUS_EXISTING_SECTION";

export interface ImportIssue {
  readonly severity: ImportIssueSeverity;
  readonly code: ImportIssueCode;
  /** Human-readable JSON path, e.g. `sections[3].apps[2].url`. */
  readonly path: string;
  /** The offending value (or explanatory context) for the UI to render. */
  readonly value?: unknown;
}

// --- Public document shape (task 024 §3) ----------------------------------------

export interface VelaDeskImportDocumentV1 {
  readonly format: typeof IMPORT_FORMAT_IDENTITY;
  readonly version: typeof IMPORT_FORMAT_VERSION;
  readonly sections: readonly VelaDeskImportSectionV1[];
}

export interface VelaDeskImportSectionV1 {
  readonly name: string;
  readonly apps: readonly VelaDeskImportAppV1[];
}

export interface VelaDeskImportAppV1 {
  readonly name: string;
  readonly url: string;
  readonly icon?: "auto";
}
