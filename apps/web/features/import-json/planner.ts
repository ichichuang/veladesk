/**
 * The pure import planning layer (task 024 §31–§32, §59).
 *
 * A plan answers, for a given workspace snapshot + parsed document, which
 * sections are created/merged and which apps are created/skipped — with
 * structured warnings/errors. Planning performs ZERO workspace writes and
 * generates no ids: random ids exist only at apply-time, so preview counts
 * and material-change comparisons are deterministic.
 */

import type { DesktopPage, DesktopPageId, WorkspaceSnapshot } from "@veladesk/domain";
import { pageItemIds } from "@veladesk/domain";

import type { ImportIssue, VelaDeskImportDocumentV1 } from "./contract";
import { canonicalImportUrlKey, normalizeImportNameKey } from "./normalization";

export interface ImportAppPlan {
  readonly name: string;
  /** The stored URL form (Add App normalization already applied by the parser). */
  readonly url: string;
  readonly urlKey: string;
  readonly action: "create" | "skip-duplicate";
}

export interface ImportSectionPlan {
  readonly displayName: string;
  readonly nameKey: string;
  readonly action: "create" | "merge";
  /**
   * The merge target. Null for create actions, and null for merges the
   * planner refused to resolve (AMBIGUOUS_EXISTING_SECTION — the blocking
   * error disables the plan).
   */
  readonly targetPageId: DesktopPageId | null;
  readonly apps: readonly ImportAppPlan[];
}

export interface ImportPlanSummary {
  readonly inputSections: number;
  readonly createSections: number;
  readonly mergeSections: number;
  readonly inputApps: number;
  readonly createApps: number;
  readonly duplicateApps: number;
  readonly warningCount: number;
}

export interface ImportPlan {
  /**
   * The snapshot this plan was computed against. Snapshots are immutable,
   * so reference identity is the workspace "base revision" for the
   * concurrent-change check at confirm time (task 024 §36).
   */
  readonly baseWorkspace: WorkspaceSnapshot;
  readonly document: VelaDeskImportDocumentV1;
  readonly sections: readonly ImportSectionPlan[];
  readonly summary: ImportPlanSummary;
  readonly warnings: readonly ImportIssue[];
  readonly errors: readonly ImportIssue[];
}

/** An app row mid-planning: plan fields plus its source path for issues. */
interface PlannedAppRow {
  readonly name: string;
  readonly url: string;
  readonly urlKey: string;
  readonly path: string;
}

export function planImport(
  workspace: WorkspaceSnapshot,
  document: VelaDeskImportDocumentV1,
  parserWarnings: readonly ImportIssue[] = []
): ImportPlan {
  const warnings: ImportIssue[] = [...parserWarnings];
  const errors: ImportIssue[] = [];

  // Existing sections by canonical name key.
  const sectionsByKey = new Map<string, DesktopPage[]>();
  for (const page of workspace.pages) {
    const key = normalizeImportNameKey(page.name);
    const bucket = sectionsByKey.get(key);
    if (bucket === undefined) {
      sectionsByKey.set(key, [page]);
    } else {
      bucket.push(page);
    }
  }

  // Existing app URL index across the ENTIRE workspace: URL identity (not
  // name identity) decides duplication. The value carries the existing app
  // name (and owning section when placed on a page) for preview context.
  const pageNameByEntityId = new Map<string, string>();
  for (const page of workspace.pages) {
    for (const itemId of pageItemIds(page)) {
      if (!pageNameByEntityId.has(itemId)) {
        pageNameByEntityId.set(itemId, page.name);
      }
    }
  }
  const existingAppByKey = new Map<string, string>();
  for (const entity of workspace.entities) {
    if (entity.kind !== "app") {
      continue;
    }
    const key = canonicalImportUrlKey(entity.url);
    if (!existingAppByKey.has(key)) {
      const section = pageNameByEntityId.get(entity.id);
      existingAppByKey.set(key, section === undefined ? entity.name : `${entity.name} · ${section}`);
    }
  }

  // Pass 1 — fold duplicate sections inside the document: the first display
  // name wins, app lists merge in first-appearance order (task 024 §17).
  const folded: {
    readonly displayName: string;
    readonly nameKey: string;
    readonly sourceIndex: number;
    readonly apps: readonly PlannedAppRow[];
  }[] = [];
  const foldedIndexByKey = new Map<string, number>();
  let inputApps = 0;
  for (let index = 0; index < document.sections.length; index += 1) {
    const section = document.sections[index];
    if (section === undefined) {
      continue;
    }
    inputApps += section.apps.length;
    const nameKey = normalizeImportNameKey(section.name);
    const rows: PlannedAppRow[] = section.apps.map((app, appIndex) => ({
      name: app.name,
      url: app.url,
      urlKey: canonicalImportUrlKey(app.url),
      path: `sections[${index}].apps[${appIndex}]`,
    }));
    const existingIndex = foldedIndexByKey.get(nameKey);
    if (existingIndex !== undefined) {
      warnings.push({
        severity: "warning",
        code: "DUPLICATE_IMPORT_SECTION",
        path: `sections[${index}]`,
        value: folded[existingIndex]?.displayName,
      });
      const target = folded[existingIndex];
      if (target !== undefined) {
        folded[existingIndex] = { ...target, apps: [...target.apps, ...rows] };
      }
      continue;
    }
    folded.push({ displayName: section.name, nameKey, sourceIndex: index, apps: rows });
    foldedIndexByKey.set(nameKey, folded.length - 1);
  }

  // Pass 2 — resolve each section's action against the existing workspace.
  const resolvedSections = folded.map((section) => {
    const matches = sectionsByKey.get(section.nameKey);
    let action: "create" | "merge";
    let targetPageId: DesktopPageId | null = null;
    if (matches === undefined || matches.length === 0) {
      action = "create";
    } else if (matches.length === 1) {
      action = "merge";
      targetPageId = matches[0]!.id;
    } else {
      // More than one existing section shares the canonical name: refuse
      // to choose (task 024 §18). The blocking error disables the plan.
      action = "merge";
      errors.push({
        severity: "error",
        code: "AMBIGUOUS_EXISTING_SECTION",
        path: `sections[${section.sourceIndex}]`,
        value: section.displayName,
      });
    }
    return { section, action, targetPageId };
  });

  // Pass 3 — resolve app actions against the import-internal and workspace
  // URL indexes; first occurrence wins (task 024 §21–§23).
  const seenImportKeys = new Map<string, string>();
  let createApps = 0;
  let duplicateApps = 0;
  const sectionPlans: ImportSectionPlan[] = resolvedSections.map(({ section, action, targetPageId }) => {
    const apps: ImportAppPlan[] = section.apps.map((app) => {
      const existing = existingAppByKey.get(app.urlKey);
      if (existing !== undefined) {
        duplicateApps += 1;
        warnings.push({ severity: "warning", code: "DUPLICATE_WORKSPACE_APP", path: app.path, value: existing });
        return { name: app.name, url: app.url, urlKey: app.urlKey, action: "skip-duplicate" as const };
      }
      const firstOccurrence = seenImportKeys.get(app.urlKey);
      if (firstOccurrence !== undefined) {
        duplicateApps += 1;
        warnings.push({ severity: "warning", code: "DUPLICATE_IMPORT_APP", path: app.path, value: firstOccurrence });
        return { name: app.name, url: app.url, urlKey: app.urlKey, action: "skip-duplicate" as const };
      }
      createApps += 1;
      seenImportKeys.set(app.urlKey, `${section.displayName} / ${app.name}`);
      return { name: app.name, url: app.url, urlKey: app.urlKey, action: "create" as const };
    });
    return { displayName: section.displayName, nameKey: section.nameKey, action, targetPageId, apps };
  });

  return {
    baseWorkspace: workspace,
    document,
    sections: sectionPlans,
    summary: {
      inputSections: document.sections.length,
      createSections: sectionPlans.filter((section) => section.action === "create").length,
      mergeSections: sectionPlans.filter((section) => section.action === "merge" && section.targetPageId !== null).length,
      inputApps,
      createApps,
      duplicateApps,
      warningCount: warnings.length,
    },
    warnings,
    errors,
  };
}

export function importPlanIsBlocked(plan: ImportPlan): boolean {
  return plan.errors.length > 0;
}

export function importPlanIsNoOp(plan: ImportPlan): boolean {
  return !importPlanIsBlocked(plan) && plan.summary.createSections === 0 && plan.summary.createApps === 0;
}

/**
 * Whether two plans are semantically the same import for the user (task
 * 024 §37): compares section/app actions, targets, URLs and the error set —
 * never generated ids (planning makes none) or warning ordering.
 */
export function plansMateriallyEqual(a: ImportPlan, b: ImportPlan): boolean {
  if (
    a.summary.inputSections !== b.summary.inputSections ||
    a.summary.createSections !== b.summary.createSections ||
    a.summary.mergeSections !== b.summary.mergeSections ||
    a.summary.inputApps !== b.summary.inputApps ||
    a.summary.createApps !== b.summary.createApps ||
    a.summary.duplicateApps !== b.summary.duplicateApps
  ) {
    return false;
  }
  if (a.errors.length !== b.errors.length) {
    return false;
  }
  for (let index = 0; index < a.errors.length; index += 1) {
    if (a.errors[index]?.code !== b.errors[index]?.code || a.errors[index]?.path !== b.errors[index]?.path) {
      return false;
    }
  }
  if (a.sections.length !== b.sections.length) {
    return false;
  }
  for (let index = 0; index < a.sections.length; index += 1) {
    const left = a.sections[index];
    const right = b.sections[index];
    if (
      left === undefined ||
      right === undefined ||
      left.displayName !== right.displayName ||
      left.action !== right.action ||
      left.targetPageId !== right.targetPageId ||
      left.apps.length !== right.apps.length
    ) {
      return false;
    }
    for (let appIndex = 0; appIndex < left.apps.length; appIndex += 1) {
      const leftApp = left.apps[appIndex];
      const rightApp = right.apps[appIndex];
      if (
        leftApp === undefined ||
        rightApp === undefined ||
        leftApp.name !== rightApp.name ||
        leftApp.url !== rightApp.url ||
        leftApp.action !== rightApp.action
      ) {
        return false;
      }
    }
  }
  return true;
}
