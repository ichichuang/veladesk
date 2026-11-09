/**
 * Recipe (.deck.json) file helpers — the export side of the P1 recipe
 * structure. The document itself comes from the domain's pure
 * `exportRecipe`; this module owns the client-only download and the
 * filename policy. No workspace write ever happens here.
 */

import { exportRecipe, RECIPE_FILE_EXTENSION } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import { VELADESK_VERSION } from "../../lib/app-version";

const RECIPE_BLOB_TYPE = "application/json;charset=utf-8";

/** Filesystem-safe base for a deck filename (fallback: `veladesk`). */
function deckFilenameBase(workspaceName: string): string {
  const slug = workspaceName
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  return slug.length > 0 ? slug.slice(0, 60) : "veladesk";
}

/** The canonical download filename of a workspace's deck. */
export function deckFilename(workspaceName: string): string {
  return `${deckFilenameBase(workspaceName)}${RECIPE_FILE_EXTENSION}`;
}

/**
 * Client-only helper: serializes the workspace's public recipe and
 * downloads it as a UTF-8 `.deck.json` file through a temporary object
 * URL. The clock is read HERE so the domain function stays pure.
 */
export function downloadWorkspaceRecipe(workspace: WorkspaceSnapshot): void {
  const recipe = exportRecipe(workspace, {
    createdAt: new Date().toISOString(),
    appMinVersion: VELADESK_VERSION,
  });
  const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: RECIPE_BLOB_TYPE });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = deckFilename(workspace.name);
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
}
