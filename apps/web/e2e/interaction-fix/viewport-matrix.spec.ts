import { test, expect } from "@playwright/test";

import { ensureArtifactRoot } from "./helpers";
import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";

/**
 * Issue 3 (Chris t54): the Helm header (clock + search) must scale with
 * the viewport and NEVER squeeze or overlap the tile area. The matrix
 * walks Chris's window sizes plus phone width; each pass screenshots and
 * asserts: header ≤ ~30% of the viewport height, header clears the first
 * tile row, the tile scroller owns its scrolling, the dock never covers a
 * scrollable tile.
 *
 * Layout-fill (Helm r4): the matrix boots the RICH scene (favicon glyphs +
 * custom 2×2/2×1 tiles) and additionally asserts the fill contract —
 * the grid content bounding box is horizontally CENTERED in the available
 * area (the stage: everything left of the section rail, between the
 * scroller's own paddings) with left/right margins differing by at most
 * one cell, and the content rests at a stable point between the header
 * and the dock, never floating below the band's vertical center.
 */
const MATRIX: readonly { readonly name: string; readonly width: number; readonly height: number }[] =
  [
    { name: "390x844", width: 390, height: 844 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "1024x610", width: 1024, height: 610 },
    { name: "1280x720", width: 1280, height: 720 },
    { name: "1600x1000", width: 1600, height: 1000 },
    { name: "1920x1080", width: 1920, height: 1080 },
    { name: "2560x1440", width: 2560, height: 1440 },
  ];

interface GridGeometry {
  readonly stage: { readonly x: number; readonly right: number; readonly y: number; readonly bottom: number };
  readonly content: { readonly x: number; readonly right: number; readonly y: number; readonly bottom: number } | null;
  readonly cellPx: number;
}

/** The active layer's grid geometry: stage box, tile-content bbox, cell size. */
async function readGridGeometry(page: import("@playwright/test").Page): Promise<GridGeometry> {
  return page.evaluate(() => {
    // Scoped to the ACTIVE section layer: warm neighbors mount real grids
    // with the same classes, and a document-wide query could hit one.
    const stage = document.querySelector<HTMLElement>(
      '.vela-section-layer[data-active-section="true"] .vela-grid-stage'
    );
    if (stage === null) {
      throw new Error("active grid stage not found");
    }
    const stageRect = stage.getBoundingClientRect();
    const tiles = [...stage.querySelectorAll<HTMLElement>(".vela-grid-host [data-item-id]")];
    const boxes = tiles.map((tile) => tile.getBoundingClientRect());
    const content =
      boxes.length === 0
        ? null
        : {
            x: Math.min(...boxes.map((box) => box.x)),
            right: Math.max(...boxes.map((box) => box.x + box.width)),
            y: Math.min(...boxes.map((box) => box.y)),
            bottom: Math.max(...boxes.map((box) => box.y + box.height)),
          };
    const cellPx = Number.parseFloat(
      getComputedStyle(stage).getPropertyValue("--vd-grid-cell-size")
    );
    return {
      stage: { x: stageRect.x, right: stageRect.right, y: stageRect.y, bottom: stageRect.bottom },
      content,
      cellPx: Number.isFinite(cellPx) ? cellPx : 0,
    };
  });
}

test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

test.describe("viewport matrix", () => {
  for (const size of MATRIX) {
    test(`layout holds at ${size.name}`, async ({ page, request }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await bootSeededDesktop(page, request, { richScene: true });
      await page.waitForTimeout(600);
      const artifactRoot = ensureArtifactRoot();
      await page.screenshot({ path: `${artifactRoot}/viewport-${size.name}.png` });

      if (size.width <= 767) {
        // Phone width: the MOBILE shell owns the presentation.
        await expect(page.locator(".vela-mobile-shell")).toBeVisible();
        return;
      }

      const header = page.locator(".vela-helm-header");
      const headerBox = await header.boundingBox();
      expect(headerBox).not.toBeNull();
      // The whole header band stays a minority of the viewport height.
      expect(headerBox!.height).toBeLessThan(size.height * 0.3);

      // The clock itself scaled down with the viewport (fluid clamp): at
      // the shortest desktop size it is clearly below the 72px landmark.
      const clock = await page.locator(".vela-helm-clock__time").boundingBox();
      expect(clock).not.toBeNull();
      if (size.height <= 610) {
        expect(clock!.height).toBeLessThanOrEqual(52);
      }

      // The header never overlaps the first tile row: the reserved band
      // and the header share one token source.
      const firstTile = page.locator(".vela-grid-host [data-item-id]").first();
      const tileBox = await firstTile.boundingBox();
      expect(tileBox).not.toBeNull();
      expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(tileBox!.y + 1);

      // The tile scroller owns vertical scrolling: when content overflows
      // it can actually scroll, and the dock never eats it (tiles that
      // extend under the dock remain scrollable INTO view).
      const scroller = page.locator(".vela-section-scroller").first();
      const scrollable = await scroller.evaluate(
        (el) => el.scrollHeight > el.clientHeight + 2,
      );
      if (scrollable) {
        const scrolled = await scroller.evaluate((el) => {
          el.scrollTop = 120;
          return el.scrollTop;
        });
        expect(scrolled).toBeGreaterThan(0);
      }

      // The dock floats INSIDE the viewport, horizontally centered.
      const dock = page.locator(".vela-dock");
      if (await dock.count()) {
        const dockBox = await dock.boundingBox();
        expect(dockBox).not.toBeNull();
        expect(dockBox!.y).toBeGreaterThan(size.height * 0.5);
      }

      // --- Layout-fill: horizontal centering in the available area ------
      // The stage IS the available area (the scroller's padded content
      // box, left of the rail). The content bounding box centers in it by
      // its OCCUPIED width; one cell is the tolerance the shrink-wrapped
      // frame's rounding may ever cost.
      const geometry = await readGridGeometry(page);
      expect(geometry.content).not.toBeNull();
      expect(geometry.cellPx).toBeGreaterThan(0);
      const leftMargin = geometry.content!.x - geometry.stage.x;
      const rightMargin = geometry.stage.right - geometry.content!.right;
      expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(geometry.cellPx + 1.5);

      // --- Layout-fill: the stable vertical resting point ----------------
      // The content never floats below the band's center (the dawn band
      // and dock own the bottom quarter): the gap above the content is at
      // most the gap below it (plus the same single-cell rounding), and
      // scrolling content trivially top-aligns (its bottom gap runs
      // negative — floored at 0 for the comparison).
      const topGap = geometry.content!.y - geometry.stage.y;
      const bottomGap = Math.max(0, geometry.stage.bottom - geometry.content!.bottom);
      expect(topGap).toBeLessThanOrEqual(bottomGap + geometry.cellPx + 1.5);

      // --- Layout-fill: a SPARSE section centers by its real extent ------
      // AI 工具 stores 8 columns but occupies 3: its content must center
      // by those 3 columns, not hug the left of a full-width frame.
      await page.locator(".vela-rail__item", { hasText: "AI 工具" }).first().click();
      await expect(page.locator('.vela-rail__item[data-active="true"]')).toHaveText(/AI 工具/);
      await page.waitForTimeout(700);
      const sparse = await readGridGeometry(page);
      expect(sparse.content).not.toBeNull();
      const sparseLeft = sparse.content!.x - sparse.stage.x;
      const sparseRight = sparse.stage.right - sparse.content!.right;
      // A centered sparse block keeps real margins on BOTH sides (it no
      // longer hugs the left edge) within one cell of each other.
      expect(sparseLeft).toBeGreaterThan(sparse.cellPx * 0.5);
      expect(sparseRight).toBeGreaterThan(sparse.cellPx * 0.5);
      expect(Math.abs(sparseLeft - sparseRight)).toBeLessThanOrEqual(sparse.cellPx + 1.5);
      await page.screenshot({ path: `${artifactRoot}/viewport-${size.name}-sparse.png` });
    });
  }
});
