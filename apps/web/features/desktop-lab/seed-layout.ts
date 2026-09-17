import type { PageLayout } from "@veladesk/desktop-engine";

/**
 * Interaction engineering fixture — NOT product default data.
 *
 * A 6 x 4 grid with four 1x1 apps and one 2x2 widget. The initial arrangement
 * is guaranteed to satisfy `validatePageLayout` with no issues.
 */
export const seedLayout: PageLayout = {
  id: "lab-desktop",
  grid: { columns: 6, rows: 4 },
  items: [
    { id: "app-a", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
    { id: "app-b", position: { column: 2, row: 0 }, span: { columns: 1, rows: 1 } },
    { id: "app-c", position: { column: 4, row: 0 }, span: { columns: 1, rows: 1 } },
    { id: "app-d", position: { column: 0, row: 2 }, span: { columns: 1, rows: 1 } },
    { id: "widget-a", position: { column: 2, row: 1 }, span: { columns: 2, rows: 2 } },
  ],
};

/** Text labels for the fixture items. No brand logos at this stage. */
export const itemLabels: Record<string, string> = {
  "app-a": "App A",
  "app-b": "App B",
  "app-c": "App C",
  "app-d": "App D",
  "widget-a": "Widget 2×2",
};
