import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { bootSeededDesktop, deleteSeededWorkspaces } from "./seed";

/**
 * Chris t81: (1) Hovering the section pill, the vertical wheel pages FAST —
 * each mouse detent is one section (no cooldown throttling), a trackpad's
 * continuous gesture still pages exactly once, chained notches engage at
 * the input rhythm (≤ ~150ms between steps) because a warm third
 * destination interrupts the running pair and a cold one prepares in
 * place — nothing waits out a 300ms settle and nothing is dropped. (2)
 * Switching from a scrollable section to a non-scrollable one never
 * carries the scrollbar across the transition: the leaving page's bar
 * dies with the switch's first frame (≤ ~50ms), the entering page shows a
 * bar only when it can really scroll.
 *
 * Evidence lands in artifacts/t81/ (frame JSON + screenshots).
 */

const evidence = resolve(__dirname, "../../../../artifacts/t81");
mkdirSync(evidence, { recursive: true });

/** The pill tests need the DESKTOP shell (the pill is desktop-only), so
 * they pin a desktop viewport regardless of the suite's default. */
const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;

test.afterEach(async ({ request }) => {
  await deleteSeededWorkspaces(request);
});

function activeSegment(page: Page) {
  return page.locator('.vela-pill__item[data-active="true"]');
}

async function hoverPillCenter(page: Page): Promise<void> {
  const pill = page.locator(".vela-pill");
  const box = (await pill.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

interface NavSample {
  readonly t: number;
  readonly active: string;
}

/**
 * Records the pill's active-segment text changes. Event-timed through a
 * MutationObserver (rAF sampling can starve on a busy first paint and miss
 * a ~100ms intermediate segment); runs until stopped/unbound at ~2s.
 */
async function startNavRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const samples: NavSample[] = [];
    const read = () =>
      document.querySelector('.vela-pill__item[data-active="true"]')?.textContent ??
      "<none>";
    const start = performance.now();
    let last = read();
    samples.push({ t: 0, active: last });
    const win = window as unknown as { __t81nav?: NavSample[] };
    win.__t81nav = samples;
    const observer = new MutationObserver(() => {
      const current = read();
      if (current !== last) {
        last = current;
        samples.push({ t: performance.now() - start, active: current });
      }
    });
    const pill = document.querySelector(".vela-pill");
    if (pill === null) throw new Error("pill not mounted");
    observer.observe(pill, { subtree: true, attributes: true, attributeFilter: ["data-active"] });
    setTimeout(() => observer.disconnect(), 2000);
  });
}

async function collectNavSamples(page: Page): Promise<NavSample[]> {
  return page.evaluate(
    () => (window as unknown as { __t81nav?: NavSample[] }).__t81nav ?? [],
  );
}

/** Dispatches `count` discrete mouse-detent wheels on the pill, one every `gapMs`. */
async function wheelNotches(
  page: Page,
  count: number,
  delta: number,
  gapMs: number,
): Promise<void> {
  await page.evaluate(
    ({ count, delta, gapMs }) => {
      const nav = document.querySelector(".vela-pill");
      if (nav === null) throw new Error("pill not mounted");
      const dispatch = (index: number) =>
        new Promise<void>((resolve) => {
          nav.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY: delta,
              deltaMode: 0,
            }),
          );
          if (index + 1 >= count) {
            resolve();
            return;
          }
          setTimeout(() => resolve(dispatch(index + 1)), gapMs);
        });
      return dispatch(0);
    },
    { count, delta, gapMs },
  );
}

/** Dispatches a trackpad-style continuous stream: `count` × `delta` at frame cadence. */
async function wheelStream(
  page: Page,
  count: number,
  delta: number,
): Promise<void> {
  await page.evaluate(
    ({ count, delta }) => {
      const nav = document.querySelector(".vela-pill");
      if (nav === null) throw new Error("pill not mounted");
      const dispatch = (index: number) =>
        new Promise<void>((resolve) => {
          nav.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY: delta,
              deltaMode: 0,
            }),
          );
          if (index + 1 >= count) {
            resolve();
            return;
          }
          setTimeout(() => resolve(dispatch(index + 1)), 16);
        });
      return dispatch(0);
    },
    { count, delta },
  );
}

test.describe("t81 pill hover wheel — fast discrete paging", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ ...DESKTOP_VIEWPORT });
    await bootSeededDesktop(page, page.request, { manySections: true });
  });

  test("three vertical detents page three sections, steps ≤ ~150ms apart, total < 1s", async ({
    page,
  }) => {
    await expect(activeSegment(page)).toHaveText(/前端开发/);
    await hoverPillCenter(page);
    await startNavRecorder(page);

    const startedAt = Date.now();
    await wheelNotches(page, 3, 120, 110);
    // Settled: the machine idles on the third destination (前端开发 →
    // AI 工具 → 设计灵感 → 扩展分区1) and its layer is the active one.
    await page.waitForFunction(
      () =>
        document.querySelector('.vela-section-viewport[data-section-transitioning="true"]') ===
          null &&
        document.querySelector('.vela-section-layer[data-phase="active"]')
          ?.getAttribute("data-page-id") === "sec-many-0",
      undefined,
      { timeout: 5_000 },
    );
    const settledAt = Date.now();

    await expect(activeSegment(page)).toHaveText(/扩展分区1/);
    const samples = await collectNavSamples(page);
    writeFileSync(
      resolve(evidence, "pill-nav-samples.json"),
      JSON.stringify(
        { startedAt, settledAt, totalMs: settledAt - startedAt, samples },
        null,
        2,
      ),
    );

    // THREE switches landed — the intermediate destinations were visited,
    // not swallowed by a pending slot (the pre-t81 behavior).
    expect(samples.map((sample) => sample.active)).toEqual([
      "前端开发",
      "AI 工具",
      "设计灵感",
      "扩展分区1",
    ]);
    // The steps follow the input rhythm, never a settle-gated 300ms ladder.
    const gaps = samples.slice(1).map((sample, index) => sample.t - samples[index]!.t);
    for (const gap of gaps) {
      expect(gap, `step gap ${gap}ms`).toBeLessThan(180);
    }
    // And the whole chain settles comfortably inside a second.
    expect(settledAt - startedAt).toBeLessThan(1000);
    await page.screenshot({ path: resolve(evidence, "pill-three-notches-settled.png") });
  });

  test("a trackpad-style continuous stream switches exactly ONE section, twice", async ({
    page,
  }) => {
    await hoverPillCenter(page);
    // 30 × 10px at a 16ms frame cadence = one sustained 300px gesture.
    await wheelStream(page, 30, 10);
    await page.waitForTimeout(250);
    await expect(activeSegment(page)).toHaveText(/AI 工具/);

    // A SECOND gesture (after real silence) pages again — still one step.
    await wheelStream(page, 30, 10);
    await page.waitForTimeout(250);
    await expect(activeSegment(page)).toHaveText(/设计灵感/);
  });

  test("an upward detent pages to the previous section", async ({ page }) => {
    await page.locator(".vela-pill__item", { hasText: "设计灵感" }).click();
    await expect(activeSegment(page)).toHaveText(/设计灵感/);
    await hoverPillCenter(page);
    await wheelNotches(page, 1, -120, 0);
    await page.waitForTimeout(200);
    await expect(activeSegment(page)).toHaveText(/AI 工具/);
  });

  test("wheel away from the pill never switches sections; Ctrl+wheel stays native", async ({
    page,
  }) => {
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 120);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(300);
    await expect(activeSegment(page)).toHaveText(/前端开发/);

    // Ctrl+wheel over the pill is browser zoom, never section navigation.
    await hoverPillCenter(page);
    await page.evaluate(() => {
      document
        .querySelector(".vela-pill")!
        .dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: 120,
            deltaMode: 0,
            ctrlKey: true,
          }),
        );
    });
    await page.waitForTimeout(250);
    await expect(activeSegment(page)).toHaveText(/前端开发/);
  });
});

interface BarFrame {
  readonly t: number;
  readonly transitionStarted: boolean;
  readonly visibleBars: {
    readonly page: string;
    readonly phase: string | null;
    readonly opacity: string;
    readonly inViewport: boolean;
  }[];
}

/**
 * Per-frame scrollbar visibility sampler: a bar is VISIBLE when its
 * computed opacity is non-zero, it is not visibility:hidden, and its box
 * intersects the viewport.
 */
async function startScrollbarRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames: BarFrame[] = [];
    const start = performance.now();
    const win = window as unknown as { __t81bars?: BarFrame[] };
    win.__t81bars = frames;
    // The switch's start marker: the active layer CHANGES (works under
    // reduced motion too, where no exit phase ever exists), or an exit
    // layer / transitioning viewport is observed.
    const initialActive = document
      .querySelector('.vela-section-layer[data-active-section="true"]')
      ?.getAttribute("data-page-id");
    function frame() {
      const visibleBars: BarFrame["visibleBars"] = [];
      for (const bar of Array.from(
        document.querySelectorAll<HTMLElement>(".vela-section-layer .os-scrollbar"),
      )) {
        const layer = bar.closest<HTMLElement>(".vela-section-layer");
        const style = getComputedStyle(bar);
        const rect = bar.getBoundingClientRect();
        const inViewport =
          rect.width > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth;
        const opacity = parseFloat(style.opacity || "1");
        if (opacity > 0.02 && style.visibility !== "hidden" && inViewport) {
          visibleBars.push({
            page: layer?.getAttribute("data-page-id") ?? "?",
            phase: layer?.getAttribute("data-phase") ?? null,
            opacity: style.opacity,
            inViewport,
          });
        }
      }
      const activeNow = document
        .querySelector('.vela-section-layer[data-active-section="true"]')
        ?.getAttribute("data-page-id");
      frames.push({
        t: performance.now() - start,
        transitionStarted:
          activeNow !== initialActive ||
          document.querySelector('.vela-section-layer[data-phase="exit"]') !== null ||
          document
            .querySelector(".vela-section-viewport")
            ?.getAttribute("data-section-transitioning") === "true",
        visibleBars,
      });
      if (performance.now() - start < 900) {
        requestAnimationFrame(frame);
      }
    }
    requestAnimationFrame(frame);
  });
}

async function collectScrollbarFrames(page: Page): Promise<BarFrame[]> {
  return page.evaluate(
    () => (window as unknown as { __t81bars?: BarFrame[] }).__t81bars ?? [],
  );
}

test.describe("t81 exit scrollbar never rides the transition", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ ...DESKTOP_VIEWPORT });
    await bootSeededDesktop(page, page.request, {});
  });

  /**
   * Makes the FIRST section genuinely scrollable and scrolls it, so its
   * accent scrollbar is visibly out (auto-hide "move" keeps it for ~1s).
   */
  async function makeActiveScrollableAndScroll(page: Page): Promise<void> {
    await page.evaluate(() => {
      const scroller = document.querySelector(
        '.vela-section-layer[data-active-section="true"] .vela-section-scroller',
      );
      if (scroller === null) throw new Error("active scroller not found");
      const spacer = document.createElement("div");
      spacer.style.height = "2500px";
      scroller.firstElementChild!.appendChild(spacer);
    });
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(450);
  }

  async function assertExitBarDiesAtSwitchStart(
    frames: BarFrame[],
    label: string,
  ): Promise<void> {
    writeFileSync(
      resolve(evidence, `scrollbar-frames-${label}.json`),
      JSON.stringify(frames, null, 2),
    );
    const firstTransitionFrame = frames.find((frame) => frame.transitionStarted);
    expect(firstTransitionFrame, "a transition was observed").toBeDefined();
    const t0 = firstTransitionFrame!.t;
    // Fixture sanity: the leaving section's bar WAS visible at (or just
    // before) the switch start — otherwise the test proves nothing.
    const beforeSwitch = frames.filter((frame) => frame.t <= t0 + 16);
    expect(
      beforeSwitch.some((frame) =>
        frame.visibleBars.some((bar) => bar.page === "sec-frontend"),
      ),
      "the scrollable section's bar was visible at switch start",
    ).toBe(true);
    // THE contract: from ~50ms after the switch starts, no scrollbar of
    // the leaving page is visible for the rest of the transition — it must
    // not ride the slide or linger at the edge until settle.
    const after = frames.filter((frame) => frame.t > t0 + 50);
    expect(after.length, "frames sampled past the 50ms mark").toBeGreaterThan(5);
    for (const frame of after) {
      const lingering = frame.visibleBars.filter((bar) => bar.page === "sec-frontend");
      expect(
        lingering,
        `frame @${Math.round(frame.t)}ms still shows the leaving bar`,
      ).toEqual([]);
    }
    // The entering section (AI 工具 — 3 tiles, nothing to scroll) never
    // shows a bar either, during or after the transition.
    for (const frame of after) {
      const entering = frame.visibleBars.filter((bar) => bar.page === "sec-ai");
      expect(entering, `frame @${Math.round(frame.t)}ms shows a bar on a non-scrollable section`).toEqual([]);
    }
  }

  test("scrollable → non-scrollable: the leaving bar dies at the switch's first frame", async ({
    page,
  }) => {
    await makeActiveScrollableAndScroll(page);
    await startScrollbarRecorder(page);
    await page.locator(".vela-pill__item", { hasText: "AI 工具" }).click();
    // Screenshot MID-slide (~halfway through the 300ms pair transition):
    // the outgoing 前端开发 page must be gliding out with NO scrollbar at
    // its edge (the exact frame of Chris's reference screenshots).
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(evidence, "scrollbar-mid-switch.png") });
    await page.waitForTimeout(800);
    const frames = await collectScrollbarFrames(page);
    await assertExitBarDiesAtSwitchStart(frames, "animated");
  });

  test("reduced motion: the same contract holds on the instant swap", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await makeActiveScrollableAndScroll(page);
    await startScrollbarRecorder(page);
    await page.locator(".vela-pill__item", { hasText: "AI 工具" }).click();
    await page.waitForTimeout(900);
    const frames = await collectScrollbarFrames(page);
    await assertExitBarDiesAtSwitchStart(frames, "reduced-motion");
  });
});
