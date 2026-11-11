import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";
import { enterArrangeMode, setPlacementMode, visualBoxOf } from "./helpers";

const evidence = resolve(__dirname, "../../../../artifacts/t63");
mkdirSync(evidence, { recursive: true });
const surface = '.vela-section-layer[data-active-section="true"] .vela-section-scroller';
test.afterEach(async ({ request }) => deleteSeededWorkspaces(request));

test("custom scrollbar overflow, accent, fading and damped wheel", async ({ page, request }) => {
  await bootSeededDesktop(page, request);
  const scroller = page.locator(surface);
  const bar = scroller.locator('.os-scrollbar-vertical');
  await expect(bar).toHaveCount(1);
  expect(await scroller.evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe('none');
  await expect(bar).toHaveClass(/os-scrollbar-unusable/);
  await scroller.evaluate(el => {
    const spacer = document.createElement('div');
    spacer.style.height = '2500px';
    el.firstElementChild!.appendChild(spacer);
  });
  await expect(bar).not.toHaveClass(/os-scrollbar-unusable/);
  const colors = await scroller.evaluate(el => {
    const handle = el.querySelector('.os-scrollbar-handle')!;
    const before = getComputedStyle(handle).backgroundColor;
    (el.closest("[data-vd-ui]") as HTMLElement).style.setProperty('--vd-color-accent', 'rgb(240, 30, 90)');
    return { before, after: getComputedStyle(handle).backgroundColor, token: getComputedStyle(el).getPropertyValue('--vd-scrollbar-thumb') };
  });
  expect(colors.after).not.toBe(colors.before);
  expect(colors.token).toContain('240');
  await page.mouse.move(700, 400);
  await scroller.evaluate(el => {
    const samples: { t: number; y: number }[] = [];
    (window as unknown as { scrollSamples: typeof samples }).scrollSamples = samples;
    const start = performance.now();
    function frame() { samples.push({ t: performance.now() - start, y: el.scrollTop }); if (performance.now() - start < 850) requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  });
  await page.mouse.wheel(0, 100);
  await expect(bar).not.toHaveClass(/os-scrollbar-auto-hide-hidden/);
  await page.waitForTimeout(900);
  const samples = await page.evaluate(() => (window as unknown as { scrollSamples: { t: number; y: number }[] }).scrollSamples);
  writeFileSync(resolve(evidence, 'wheel-frames.json'), JSON.stringify({ colors, samples }, null, 2));
  expect(new Set(samples.map(s => s.y)).size).toBeGreaterThan(5);
  expect(samples.at(-1)!.y).toBeCloseTo(100, 0);
  expect(samples.filter(s => s.t > 600).every(s => Math.abs(s.y - 100) < 1)).toBe(true);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1080);
  await page.screenshot({ path: resolve(evidence, 'scrollbar-mid-fade.png') });
  await expect(bar).toHaveCSS('opacity', '0');
  const modeColors = await scroller.evaluate(el => {
    const root = el.closest('[data-vd-ui]') as HTMLElement;
    root.style.removeProperty('--vd-color-accent');
    root.setAttribute('data-vd-color-mode', 'dark');
    const dark = getComputedStyle(el.querySelector('.os-scrollbar-handle')!).backgroundColor;
    root.setAttribute('data-vd-color-mode', 'light');
    const light = getComputedStyle(el.querySelector('.os-scrollbar-handle')!).backgroundColor;
    root.setAttribute('data-vd-color-mode', 'dark');
    return { dark, light };
  });
  expect(modeColors.light).not.toBe(modeColors.dark);
  // The real overlay thumb and track remain interactive with Lenis enabled.
  const bounds = await scroller.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width - 4, 300);
  await expect(bar).toHaveCSS('opacity', '1');
  const thumb = bar.locator('.os-scrollbar-handle');
  const handle = await thumb.boundingBox();
  const beforeDrag = await scroller.evaluate(el => el.scrollTop);
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2 + 80, { steps: 12 });
  await page.mouse.up();
  expect(await scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(beforeDrag + 30);
  const beforeTrack = await scroller.evaluate(el => el.scrollTop);
  const trackBox = await bar.locator('.os-scrollbar-track').boundingBox();
  await page.mouse.click(trackBox!.x + trackBox!.width / 2, trackBox!.y + trackBox!.height - 20);
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(beforeTrack);

});

test("free tile follows beyond viewport, auto-scrolls and persists", async ({ page, request }) => {
  await bootSeededDesktop(page, request);
  await enterArrangeMode(page);
  await setPlacementMode(page, 'freeform');
  const scroller = page.locator(surface);
  const origin = await visualBoxOf(page, 'app-mdn');
  const x = origin.x + origin.width / 2;
  const y = origin.y + origin.height / 2;
  const edge = await scroller.boundingBox();
  const targetY = edge!.y + edge!.height - 12;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const frames = [];
  for (let i = 1; i <= 35; i++) {
    const py = y + (targetY - y) * i / 35;
    await page.mouse.move(x, py);
    await page.waitForTimeout(20);
    frames.push({ pointerY: py, box: await visualBoxOf(page, 'app-mdn'), scrollTop: await scroller.evaluate(el => el.scrollTop) });
  }
  await page.waitForTimeout(1000);
  const scrollTop = await scroller.evaluate(el => el.scrollTop);
  writeFileSync(resolve(evidence, 'free-drag-frames.json'), JSON.stringify({ origin, frames, scrollTop }, null, 2));
  for (const frame of frames.slice(7)) expect(Math.abs(frame.box.y + frame.box.height / 2 - frame.pointerY)).toBeLessThan(9);
  expect(scrollTop).toBeGreaterThan(100);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const contentY = await page.locator('[data-item-id="app-mdn"]').evaluate(el => (el as HTMLElement).offsetTop);
  expect(contentY).toBeGreaterThan(edge!.height);
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('[data-item-id="app-mdn"]')).toBeInViewport();
  await page.reload();
  await expect(page.locator('.vela-desktop')).toBeVisible();
  const restored = await page.locator('[data-item-id="app-mdn"]').evaluate(el => (el as HTMLElement).offsetTop);
  expect(restored).toBeCloseTo(contentY, 0);
});

test('grid grows and viewport evidence', async ({ page, request }) => {
  await bootSeededDesktop(page, request, { richScene: true });
  await enterArrangeMode(page);
  const box = await page.locator('[data-item-id="app-mdn"]').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, 690, { steps: 30 });
  await page.waitForTimeout(1200);
  await page.mouse.up();
  const scroller = page.locator(surface);
  expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  for (const [width, height] of [[390,844], [1024,610], [1440,900], [1920,1080]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(evidence, `viewport-${width}x${height}.png`) });
  }
});
