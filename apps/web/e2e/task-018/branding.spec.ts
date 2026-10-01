import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

import { bootIntoWorkspace, failOnConsoleError, seedUniqueWorkspace } from "./helpers";
import { TWO_SECTIONS } from "../fixtures/seed";

/**
 * Task 018 branding integration: byte-exact favicon + logo served from the
 * standalone bundle, startup logo visible during boot, and no remote
 * asset/font requests anywhere.
 */

const ICON_SOURCE_HASH = "ad8ec5e402ee5ddb9f8a18463f22b7d4acc191f75fb05cb55dbe24456b67cb06";
const LOGO_SOURCE_HASH = "175cbf1e8d42e05d2e04f70390ad1a7307bc634df554e1a924ffbbe55bbfe419";

test.beforeEach(async ({ page }) => {
  failOnConsoleError(page);
});

test("the browser tab icon is the 64px PNG served with matching bytes", async ({ page, request }) => {
  await seedUniqueWorkspace(request, "brand-icon", TWO_SECTIONS);
  await page.goto("/");

  const iconLink = page.locator("link[rel='icon']");
  await expect(iconLink).toHaveCount(1, { timeout: 20_000 });
  const href = await iconLink.getAttribute("href");
  expect(href).toBeTruthy();

  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  const bytes = await response.body();
  // IHDR: 64×64.
  expect(bytes.readUInt32BE(16)).toBe(64);
  expect(bytes.readUInt32BE(20)).toBe(64);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(ICON_SOURCE_HASH);
});

test("the brand logo is served at 256px from the self-hosted bundle", async ({ request }) => {
  const response = await request.get("/brand/veladesk-logo.png");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  const bytes = await response.body();
  expect(bytes.readUInt32BE(16)).toBe(256);
  expect(bytes.readUInt32BE(20)).toBe(256);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(LOGO_SOURCE_HASH);
});

test("the startup path shows the logo while booting, then the desktop shows none", async ({
  page,
  request,
}) => {
  await seedUniqueWorkspace(request, "brand-boot", TWO_SECTIONS);

  // Delay the catalog request so the boot screen (and its logo) is
  // actually observable — no fake readiness delay in the product itself.
  await page.route("**/api/v1/workspaces", async (route) => {
    await page.waitForTimeout(600);
    await route.continue();
  });

  const remote: string[] = [];
  const localOrigin = "http://127.0.0.1:3131";
  page.on("request", (req) => {
    try {
      const url = new URL(req.url());
      if (url.origin !== localOrigin && url.protocol !== "data:") {
        remote.push(req.url());
      }
    } catch {
      // about:blank and friends are not remote asset requests.
    }
  });

  await page.goto("/");
  const bootLogo = page.locator(".vela-boot img[src='/brand/veladesk-logo.png']");
  await expect(bootLogo).toBeVisible({ timeout: 15_000 });

  await bootIntoWorkspace(page, "Desk brand-boot");
  await expect(page.locator(".vela-desktop img[src*='brand/']")).toHaveCount(0);

  // No CDN font/asset requests were introduced anywhere.
  expect(remote).toEqual([]);
});
