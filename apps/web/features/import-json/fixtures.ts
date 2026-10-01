import type { DesktopPage, WorkspaceSnapshot } from "@veladesk/domain";
import { addAppToPage, addPage, createEmptyWorkspace } from "@veladesk/domain";

import type { ImportIdFactory } from "./apply-import";
import { canonicalImportUrlKey } from "./normalization";

/**
 * Shared fixtures for the import-json suites: a small deterministic
 * workspace builder plus a counter id factory, so planner/apply tests
 * never depend on randomness (task 024 §32).
 */

export function makeTestIdFactory(): ImportIdFactory {
  const counts = { page: 0, app: 0 };
  return (kind) => {
    counts[kind] += 1;
    return `${kind}-${counts[kind]}`;
  };
}

export function baseWorkspace(): WorkspaceSnapshot {
  return createEmptyWorkspace({
    workspaceId: "ws-import",
    workspaceName: "Import Fixture",
    pageId: "page-home",
    pageName: "Home",
    grid: { columns: 10, rows: 6 },
  });
}

/** Adds a section the way SectionDialog does (v2 grid canvas, empty). */
export function addSection(
  workspace: WorkspaceSnapshot,
  pageId: string,
  name: string,
): WorkspaceSnapshot {
  const gridSource = workspace.pages[0]?.layout.grid ?? { columns: 10, rows: 6 };
  const result = addPage(workspace, {
    id: pageId,
    name,
    layout: { id: pageId, grid: { ...gridSource }, items: [] },
    canvas: { version: 2, mode: "grid", columns: gridSource.columns, items: [] },
  });
  if (!result.ok) {
    throw new Error(`fixture addSection failed: ${result.reason}`);
  }
  return result.workspace;
}

/** Adds an app with the Add App defaults (icon omitted → generated auto). */
export function addApp(
  workspace: WorkspaceSnapshot,
  pageId: string,
  id: string,
  name: string,
  url: string,
): WorkspaceSnapshot {
  const result = addAppToPage(workspace, pageId, {
    kind: "app",
    id,
    name,
    url,
    icon: { kind: "generated", text: name.slice(0, 2).toUpperCase(), source: "auto" },
    openMode: "new-tab",
    tags: [],
  });
  if (!result.ok) {
    throw new Error(`fixture addApp failed: ${result.reason}`);
  }
  return result.workspace;
}

/** The office fixture from task 024 §59: existing "Office" with GitHub. */
export function officeWorkspace(): { workspace: WorkspaceSnapshot; officePageId: string } {
  let workspace = addSection(baseWorkspace(), "page-office", "Office");
  workspace = addApp(workspace, "page-office", "app-github", "GitHub", "https://github.com/");
  return { workspace, officePageId: "page-office" };
}

export function findPage(workspace: WorkspaceSnapshot, pageId: string): DesktopPage {
  const page = workspace.pages.find((candidate) => candidate.id === pageId);
  if (page === undefined) {
    throw new Error(`fixture page not found: ${pageId}`);
  }
  return page;
}

export const githubUrlKey = canonicalImportUrlKey("https://github.com/");
