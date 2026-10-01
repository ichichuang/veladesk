/**
 * The pure/in-memory apply layer (task 024 §38–§39, §60–§62).
 *
 * Builds the ENTIRE prospective workspace in memory by chaining the same
 * domain ops the dialogs use — `addPage` with the New Section construction
 * and `addAppToPage` with the Add App defaults — then hands the final
 * snapshot back for ONE stage/save. Each planned app is applied
 * sequentially to the accumulating snapshot so placement sees previous
 * imported apps; ids come only from the injected factory (deterministic in
 * tests, `createBrowserId` in production). The input snapshot is never
 * mutated.
 */

import type { AppIcon, DesktopPageId, WorkspaceSnapshot } from "@veladesk/domain";
import { addAppToPage, addPage } from "@veladesk/domain";
import type { WorkspaceEditResult } from "@veladesk/domain";

import { resolveBrandFromHostname } from "../app-recognition/brand-aliases";
import { generatedIconText } from "../home/generated-icon";
import type { ImportPlan } from "./planner";

/** Creates fresh entity/page ids at apply-time only. */
export type ImportIdFactory = (kind: "page" | "app") => string;

export type ApplyImportResult = WorkspaceEditResult;

/**
 * The onboarding grid (10×6) — the fallback snap lattice only used if the
 * workspace somehow has no pages; in practice `cannot-delete-last-page`
 * keeps at least one page around, and new sections copy an existing page's
 * grid the way SectionDialog does.
 */
const FALLBACK_GRID = { columns: 10, rows: 6 } as const;

export function applyImportPlan(
  workspace: WorkspaceSnapshot,
  plan: ImportPlan,
  idFactory: ImportIdFactory
): ApplyImportResult {
  if (plan.errors.length > 0) {
    // Programmer error, not a user-facing condition: the UI disables Import
    // for blocked plans. Fail loudly instead of inventing a fake edit reason.
    throw new Error("applyImportPlan received a blocked plan");
  }

  let current = workspace;
  const gridSource = current.pages[0]?.layout.grid ?? { ...FALLBACK_GRID };

  // 1. Create the required sections first, with the New Section defaults.
  const createdPageIds = new Map<string, DesktopPageId>();
  for (const section of plan.sections) {
    if (section.action !== "create") {
      continue;
    }
    const pageId = idFactory("page");
    const result = addPage(current, {
      id: pageId,
      name: section.displayName,
      layout: { id: pageId, grid: { ...gridSource }, items: [] },
      canvas: { version: 2, mode: "grid", columns: gridSource.columns, items: [] },
    });
    if (!result.ok) {
      return result;
    }
    current = result.workspace;
    createdPageIds.set(section.nameKey, pageId);
  }

  // 2. Create the apps sequentially so each placement sees the previous
  //    imported apps (task 024 §30) — no hardcodes, the shared placement
  //    engine owns geometry.
  for (const section of plan.sections) {
    const targetPageId =
      section.action === "merge" ? section.targetPageId : createdPageIds.get(section.nameKey) ?? null;
    if (targetPageId === null) {
      continue;
    }
    for (const app of section.apps) {
      if (app.action !== "create") {
        continue;
      }
      const result = addAppToPage(current, targetPageId, {
        kind: "app",
        id: idFactory("app"),
        name: app.name,
        url: app.url,
        icon: resolveImportAppIcon(app.name, app.url),
        openMode: "new-tab",
        tags: [],
      });
      if (!result.ok) {
        return result;
      }
      current = result.workspace;
    }
  }

  return { ok: true, workspace: current };
}

/**
 * Auto icon policy (task 024 §25–§26): the LOCAL brand catalog first —
 * zero network, works offline — then the shared generated-text helper.
 * Never a remote URL, never a second initials algorithm.
 */
export function resolveImportAppIcon(name: string, url: string): AppIcon {
  const brand = resolveBrandFromHostname(hostnameOf(url) ?? "");
  if (brand !== null) {
    return { kind: "iconify", icon: brand.iconKey };
  }
  return { kind: "generated", text: generatedIconText(name), source: "auto" };
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
