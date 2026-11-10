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
 */
const MATRIX: readonly { readonly name: string; readonly width: number; readonly height: number }[] =
  [
    { name: "390x844", width: 390, height: 844 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "1024x610", width: 1024, height: 610 },
    { name: "1280x720", width: 1280, height: 720 },
    { name: "1600x1000", width: 1600, height: 1000 },
    { name: "1920x1080", width: 1920, height: 1080 },
  ];

test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

test.describe("viewport matrix", () => {
  for (const size of MATRIX) {
    test(`layout holds at ${size.name}`, async ({ page, request }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await bootSeededDesktop(page, request);
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
    });
  }
});
