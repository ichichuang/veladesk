/**
 * Recipe (.deck.json) adoption at the import boundary (P1).
 *
 * A `vela.recipe` document handed to the Import JSON flow is migrated up
 * through the domain's pure `migrateRecipe`, distilled via `importRecipe`,
 * and re-entered as an ordinary Import JSON v1 document — so the whole
 * existing parse → plan → preview → confirm pipeline (limits, URL rules,
 * duplicate detection, one-revision write) applies unchanged. Theme and
 * motion travel on the payload for the caller; the P1 wiring imports
 * sections/apps only.
 *
 * Legacy `veladesk-import` documents keep their own direct path — the
 * domain function migrates them too, but the parser only routes documents
 * that declare the recipe format.
 */

import { importRecipe, migrateRecipe, RECIPE_FORMAT_IDENTITY } from "@veladesk/domain";
import type { RecipeV1 } from "@veladesk/domain";

import type { ImportIssue, VelaDeskImportDocumentV1 } from "./contract";
import { IMPORT_FORMAT_IDENTITY, IMPORT_FORMAT_VERSION } from "./contract";

export type AdoptRecipeResult =
  | { readonly kind: "not-a-recipe" }
  | { readonly kind: "adopted"; readonly document: VelaDeskImportDocumentV1; readonly notice: ImportIssue }
  | { readonly kind: "rejected"; readonly issues: readonly ImportIssue[] };

/** True when a parsed JSON root declares the recipe format. */
export function isRecipeDocument(root: unknown): root is Record<string, unknown> {
  return (
    typeof root === "object" &&
    root !== null &&
    !Array.isArray(root) &&
    (root as Record<string, unknown>).format === RECIPE_FORMAT_IDENTITY
  );
}

/**
 * Migrates + distills a recipe-shaped root into the Import JSON v1 shape.
 * Pure; returns `not-a-recipe` for anything the parser should handle
 * itself and structured issues for everything it must surface instead.
 */
export function adoptRecipeDocument(root: Record<string, unknown>): AdoptRecipeResult {
  const migrated = migrateRecipe(root);
  if (!migrated.ok) {
    const issues: ImportIssue[] =
      migrated.issue.type === "unsupported-version"
        ? [{ severity: "error", code: "UNSUPPORTED_VERSION", path: "version", value: migrated.issue.version }]
        : migrated.issue.type === "invalid-recipe"
          ? [{ severity: "error", code: "INVALID_FORMAT", path: migrated.issue.path }]
          : [{ severity: "error", code: "INVALID_FORMAT", path: "format" }];
    return { kind: "rejected", issues };
  }

  const payload = importRecipe(migrated.recipe satisfies RecipeV1);
  const document: VelaDeskImportDocumentV1 = {
    format: IMPORT_FORMAT_IDENTITY,
    version: IMPORT_FORMAT_VERSION,
    sections: payload.sections.map((section) => ({
      name: section.name,
      apps: section.apps.map((app) => ({ name: app.name, url: app.url })),
    })),
  };
  return {
    kind: "adopted",
    document,
    notice: { severity: "warning", code: "RECIPE_MIGRATED", path: "format" },
  };
}
