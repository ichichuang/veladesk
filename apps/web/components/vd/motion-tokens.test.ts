import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { VD_MOTION, VD_MOTION_EASE, vdMotionDuration } from "./motion-tokens";

/**
 * The motion token contract (task 022, GSAP edition): one preset module
 * owns every GSAP duration (SECONDS), the easing is THE one canonical
 * curve with no overshoot, and no Motion-era import may re-enter the
 * shared component layer. The old JS↔CSS `--vd-motion-*` mirror contract
 * is retired — CSS no longer animates product surfaces (the token layer
 * keeps the custom properties defined for the static token bridge).
 */

const VD_DIR = new URL("./", import.meta.url);

const EXPECTED_SECONDS: Readonly<Record<keyof typeof VD_MOTION, number>> = {
  hoverPress: 0.16,
  controlState: 0.22,
  tooltip: 0.18,
  popup: 0.24,
  tabContent: 0.26,
  indicator: 0.28,
  dialog: 0.34,
  inspector: 0.38,
  sectionPage: 0.5,
};

describe("gsap motion preset contract (022)", () => {
  it("defines the exact canonical preset table in seconds", () => {
    expect(VD_MOTION).toEqual(EXPECTED_SECONDS);
  });

  it("resolves every preset through vdMotionDuration", () => {
    for (const preset of Object.keys(EXPECTED_SECONDS) as (keyof typeof VD_MOTION)[]) {
      expect(vdMotionDuration(preset)).toBe(EXPECTED_SECONDS[preset]);
    }
  });

  it("uses exactly one canonical non-overshoot easing", () => {
    expect(VD_MOTION_EASE).toBe("power2.out");
  });

  it("keeps animation ordering bands honest (press < control < popover < page)", () => {
    expect(VD_MOTION.hoverPress).toBeLessThan(VD_MOTION.controlState);
    expect(VD_MOTION.controlState).toBeLessThan(VD_MOTION.popup);
    expect(VD_MOTION.popup).toBeLessThan(VD_MOTION.indicator);
    expect(VD_MOTION.dialog).toBeLessThan(VD_MOTION.inspector);
    expect(VD_MOTION.inspector).toBeLessThan(VD_MOTION.sectionPage);
  });

  it("the shared component layer never imports a superseded animation engine", () => {
    // Ownership scan: components/vd must draw every tween from the shared
    // gsap entry — Motion/native drivers may not re-enter this layer.
    const files = ["gsap.ts", "motion-tokens.ts", "reduced-motion.ts", "presence.ts", "animated-surface.tsx", "press-feedback.tsx", "animated-indicator.tsx", "loading-indicator.tsx"];
    for (const file of files) {
      const source = readFileSync(new URL(file, VD_DIR), "utf8");
      expect(source, `${file} must not import motion`).not.toMatch(/from\s+["']motion/);
      expect(source, `${file} must not import framer-motion`).not.toMatch(/from\s+["']framer-motion/);
      if (file !== "gsap.ts") {
        expect(source, `${file} must import gsap via the shared entry`).not.toMatch(/from\s+["']gsap["']/);
        expect(source, `${file} must not import @gsap/react directly`).not.toMatch(/from\s+["']@gsap\/react["']/);
      }
    }
  });
});
