/**
 * VelaDesk Import JSON v1 parser + schema validation (task 024 §11–§15,
 * §57).
 *
 * `JSON.parse` only — never eval/Function. Explicit expected properties
 * are read one by one; user JSON is never Object.assign'ed or deep-merged
 * into anything, so prototype-looking keys stay harmless unknown fields.
 * All issues are collected (errors block, warnings do not) with
 * human-readable JSON paths.
 */

import {
  IMPORT_FORMAT_IDENTITY,
  IMPORT_FORMAT_VERSION,
  IMPORT_MAX_APP_NAME_LENGTH,
  IMPORT_MAX_APPS,
  IMPORT_MAX_JSON_TEXT_LENGTH,
  IMPORT_MAX_SECTION_NAME_LENGTH,
  IMPORT_MAX_SECTIONS,
} from "./contract";
import type {
  ImportIssue,
  ImportIssueCode,
  VelaDeskImportAppV1,
  VelaDeskImportDocumentV1,
  VelaDeskImportSectionV1,
} from "./contract";
import { normalizeImportDisplayName, resolveImportAppUrl } from "./normalization";

export interface ParsedImportDocument {
  readonly document: VelaDeskImportDocumentV1;
  /** Parser warnings (unknown fields); never contains errors. */
  readonly issues: readonly ImportIssue[];
}

export type ParseImportResult =
  | { readonly ok: true; readonly parsed: ParsedImportDocument }
  | {
      readonly ok: false;
      readonly issues: readonly ImportIssue[];
      /**
       * Best-effort display names per input section index (for error
       * context like `AI → app 3`); undefined where unknown/unreadable.
       */
      readonly sectionNames: readonly (string | undefined)[];
    };

const ROOT_KNOWN_FIELDS = new Set(["format", "version", "sections"]);
const SECTION_KNOWN_FIELDS = new Set(["name", "apps"]);
const APP_KNOWN_FIELDS = new Set(["name", "url", "icon"]);

export function parseImportDocument(text: string): ParseImportResult {
  const issues: ImportIssue[] = [];
  const sectionNames: (string | undefined)[] = [];
  const error = (code: ImportIssueCode, path: string, value?: unknown): void => {
    issues.push({ severity: "error", code, path, value });
  };
  const warning = (code: ImportIssueCode, path: string, value?: unknown): void => {
    issues.push({ severity: "warning", code, path, value });
  };

  if (text.length > IMPORT_MAX_JSON_TEXT_LENGTH) {
    error("FILE_TOO_LARGE", "$");
    return { ok: false, issues, sectionNames };
  }

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (parseError) {
    error("INVALID_JSON", "$", parseError instanceof Error ? parseError.message : String(parseError));
    return { ok: false, issues, sectionNames };
  }

  if (!isRecord(root)) {
    error("INVALID_ROOT", "$");
    return { ok: false, issues, sectionNames };
  }

  if (root.format !== IMPORT_FORMAT_IDENTITY) {
    error("INVALID_FORMAT", "format", describeValue(root.format));
  }

  if (root.version !== IMPORT_FORMAT_VERSION) {
    // A future version is never best-effort parsed (task 024 §49).
    error("UNSUPPORTED_VERSION", "version", describeValue(root.version));
  }

  if (!Array.isArray(root.sections)) {
    error(Object.hasOwn(root, "sections") ? "INVALID_SECTIONS" : "MISSING_SECTIONS", "sections");
    // Nothing else is walkable without a sections array; still surface the
    // harmless-field warnings collected so far.
    collectUnknownFields(root, ROOT_KNOWN_FIELDS, "", warning);
    return { ok: false, issues, sectionNames };
  }

  const sections = root.sections;
  if (sections.length > IMPORT_MAX_SECTIONS) {
    error("TOO_MANY_SECTIONS", "sections", sections.length);
  }
  collectUnknownFields(root, ROOT_KNOWN_FIELDS, "", warning);

  const parsedSections: VelaDeskImportSectionV1[] = [];
  let inputApps = 0;

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const rawSection = sections[sectionIndex];
    const sectionPath = `sections[${sectionIndex}]`;
    if (!isRecord(rawSection)) {
      error("INVALID_SECTION", sectionPath);
      continue;
    }

    let name: string | null = null;
    if (typeof rawSection.name !== "string") {
      error("MISSING_SECTION_NAME", `${sectionPath}.name`);
    } else {
      const display = normalizeImportDisplayName(rawSection.name);
      if (display.length === 0 || display.length > IMPORT_MAX_SECTION_NAME_LENGTH) {
        error("INVALID_SECTION_NAME", `${sectionPath}.name`, rawSection.name);
      } else {
        name = display;
      }
    }

    const appsOut: VelaDeskImportAppV1[] = [];
    if (!Array.isArray(rawSection.apps)) {
      error(Object.hasOwn(rawSection, "apps") ? "INVALID_APPS" : "MISSING_APPS", `${sectionPath}.apps`);
    } else {
      for (let appIndex = 0; appIndex < rawSection.apps.length; appIndex += 1) {
        const rawApp = rawSection.apps[appIndex];
        const appPath = `${sectionPath}.apps[${appIndex}]`;
        inputApps += 1;
        if (!isRecord(rawApp)) {
          error("INVALID_APP", appPath);
          continue;
        }

        let appName: string | null = null;
        if (typeof rawApp.name !== "string") {
          error("MISSING_APP_NAME", `${appPath}.name`);
        } else {
          const display = normalizeImportDisplayName(rawApp.name);
          if (display.length === 0 || display.length > IMPORT_MAX_APP_NAME_LENGTH) {
            error("INVALID_APP_NAME", `${appPath}.name`, rawApp.name);
          } else {
            appName = display;
          }
        }

        let appUrl: string | null = null;
        if (typeof rawApp.url !== "string") {
          error("MISSING_APP_URL", `${appPath}.url`);
        } else {
          const resolved = resolveImportAppUrl(rawApp.url);
          if (!resolved.ok) {
            error("INVALID_APP_URL", `${appPath}.url`, rawApp.url);
          } else {
            appUrl = resolved.stored;
          }
        }

        if (Object.hasOwn(rawApp, "icon") && rawApp.icon !== "auto") {
          error("INVALID_ICON", `${appPath}.icon`, describeValue(rawApp.icon));
        }

        collectUnknownFields(rawApp, APP_KNOWN_FIELDS, appPath, warning);

        if (appName !== null && appUrl !== null) {
          appsOut.push({ name: appName, url: appUrl });
        }
      }
    }

    collectUnknownFields(rawSection, SECTION_KNOWN_FIELDS, sectionPath, warning);
    parsedSections.push({ name: name ?? "", apps: appsOut });
    sectionNames[sectionIndex] = name ?? undefined;
  }

  if (inputApps > IMPORT_MAX_APPS) {
    error("TOO_MANY_APPS", "sections", inputApps);
  }

  if (issues.some((issue) => issue.severity === "error")) {
    return { ok: false, issues, sectionNames };
  }
  return {
    ok: true,
    parsed: {
      document: { format: IMPORT_FORMAT_IDENTITY, version: IMPORT_FORMAT_VERSION, sections: parsedSections },
      issues: issues.filter((issue) => issue.severity === "warning"),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectUnknownFields(
  record: Record<string, unknown>,
  known: ReadonlySet<string>,
  pathPrefix: string,
  warn: (code: ImportIssueCode, path: string, value?: unknown) => void
): void {
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      warn("UNSUPPORTED_FIELD_IGNORED", pathPrefix === "" ? key : `${pathPrefix}.${key}`);
    }
  }
}

function describeValue(value: unknown): unknown {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
    ? value
    : Array.isArray(value)
      ? "array"
      : "object";
}
