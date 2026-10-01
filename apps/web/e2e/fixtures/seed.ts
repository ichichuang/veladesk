import type { APIRequestContext } from "@playwright/test";

/**
 * Task 018 deterministic workspace fixtures, seeded through the real HTTP
 * API (POST /api/v1/workspaces) before the page boots — the local-first
 * client then pulls the server catalog on first load.
 */

export interface SeedAppSpec {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

export interface SeedSectionSpec {
  readonly id: string;
  readonly name: string;
  readonly apps: readonly SeedAppSpec[];
}

/** A minimal valid v2 Grid snapshot with the given sections and apps. */
export function buildGridSnapshot(
  workspaceId: string,
  workspaceName: string,
  sections: readonly SeedSectionSpec[],
): Record<string, unknown> {
  const entities = sections.flatMap((section) =>
    section.apps.map((app) => ({
      kind: "app",
      id: app.id,
      name: app.name,
      url: app.url,
      icon: { kind: "generated", text: app.name.slice(0, 1).toUpperCase(), source: "auto" },
      openMode: "new-tab",
      tags: [],
    })),
  );
  return {
    id: workspaceId,
    name: workspaceName,
    pages: sections.map((section) => ({
      id: section.id,
      name: section.name,
      layout: {
        id: section.id,
        grid: { columns: 12, rows: 8 },
        items: [],
      },
      canvas: {
        version: 2,
        mode: "grid",
        columns: 12,
        items: section.apps.map((app, index) => ({
          id: app.id,
          column: (index % 6) * 2,
          row: Math.floor(index / 6) * 2,
          columnSpan: 1,
          rowSpan: 1,
        })),
      },
    })),
    entities,
    categories: [],
    dock: { items: [] },
    preferences: {
      defaultPageId: sections[0]!.id,
      layoutLocked: true,
    },
  };
}

/** Seeds one workspace and returns its id. */
export async function seedWorkspace(
  request: APIRequestContext,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const response = await request.post("/api/v1/workspaces", { data: { snapshot } });
  if (response.status() !== 201) {
    throw new Error(`seed failed (${response.status()}): ${await response.text()}`);
  }
  return String(snapshot.id);
}

/** Current server-side revision of a workspace. */
export async function fetchRevision(
  request: APIRequestContext,
  workspaceId: string,
): Promise<number> {
  const response = await request.get(`/api/v1/workspaces/${workspaceId}`);
  if (!response.ok()) {
    throw new Error(`revision fetch failed (${response.status()})`);
  }
  const body = (await response.json()) as { workspace: { revision: number } };
  return body.workspace.revision;
}

/** Two-section fixture: the minimum that still exercises navigation. */
export const TWO_SECTIONS: readonly SeedSectionSpec[] = [
  {
    id: "page-alpha",
    name: "Alpha",
    apps: [
      { id: "app-a1", name: "Gamma", url: "https://gamma.example" },
      { id: "app-a2", name: "Notion", url: "https://notion.example" },
    ],
  },
  {
    id: "page-beta",
    name: "Beta",
    apps: [{ id: "app-b1", name: "Figma", url: "https://figma.example" }],
  },
];

/** Thirty-section fixture: rail overflow + long-wheel-stream bounds. */
export function thirtySections(): SeedSectionSpec[] {
  return Array.from({ length: 30 }, (_, index) => ({
    id: `page-s${String(index).padStart(2, "0")}`,
    name: `Section ${String(index + 1).padStart(2, "0")}`,
    apps: [
      {
        id: `app-s${String(index).padStart(2, "0")}-1`,
        name: `App ${index + 1}A`,
        url: "https://example.com",
      },
    ],
  }));
}
