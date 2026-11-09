import { describe, expect, it } from "vitest";

import { VD_MOTION_AMBIENT, VD_MOTION_EASES, VD_MOTION_EASES_BEZIER, VD_MOTION_GRID_GUIDES } from "./motion";

/**
 * The bezier twins (P2): every GSAP ease role has a Motion-usable
 * cubic-bezier twin with the matching curve family, so a Motion surface
 * never has to write an ease literal.
 */

/** The bezier of each GSAP `powerN` curve this token module uses. */
const EXPECTED_TWINS: Readonly<Record<string, readonly number[]>> = {
  "power2.out": [0.33, 1, 0.68, 1],
  "power3.inOut": [0.76, 0, 0.24, 1],
  "power2.in": [0.32, 0, 0.67, 0],
  "sine.inOut": [0.37, 0, 0.63, 1],
};

describe("VD_MOTION_EASES_BEZIER", () => {
  it("has a bezier twin for every GSAP ease role", () => {
    for (const role of Object.keys(VD_MOTION_EASES) as (keyof typeof VD_MOTION_EASES)[]) {
      expect(VD_MOTION_EASES_BEZIER[role], `role ${role}`).toBeDefined();
    }
  });

  it("each twin matches the curve of its GSAP ease", () => {
    for (const role of Object.keys(VD_MOTION_EASES) as (keyof typeof VD_MOTION_EASES)[]) {
      const gsapName = VD_MOTION_EASES[role];
      expect(EXPECTED_TWINS[gsapName], `known twin for ${gsapName}`).toBeDefined();
      expect([...VD_MOTION_EASES_BEZIER[role]]).toEqual(EXPECTED_TWINS[gsapName]);
    }
  });

  it("every twin is a valid cubic-bezier (x in [0,1])", () => {
    for (const curve of Object.values(VD_MOTION_EASES_BEZIER)) {
      expect(curve).toHaveLength(4);
      expect(curve[0]).toBeGreaterThanOrEqual(0);
      expect(curve[0]).toBeLessThanOrEqual(1);
      expect(curve[2]).toBeGreaterThanOrEqual(0);
      expect(curve[2]).toBeLessThanOrEqual(1);
    }
  });

  it("linear is the identity curve", () => {
    expect([...VD_MOTION_EASES_BEZIER.linear]).toEqual([0, 0, 1, 1]);
  });
});

describe("ambient and grid-guide duration tokens (seconds)", () => {
  it("pins the ambient loop table in SECONDS", () => {
    expect(VD_MOTION_AMBIENT).toEqual({ drift: 30, bootDrift: 26, bootPulse: 1.6 });
  });

  it("pins the grid guides fade-in in SECONDS (140ms)", () => {
    expect(VD_MOTION_GRID_GUIDES.fadeIn).toBe(0.14);
  });

  it("stores seconds, never milliseconds", () => {
    // Every one-shot band stays under a second; loops under a minute.
    expect(VD_MOTION_GRID_GUIDES.fadeIn).toBeLessThan(1);
    for (const seconds of Object.values(VD_MOTION_AMBIENT)) {
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThan(60);
    }
  });

  it("keeps ambient loops on the drift ease", () => {
    expect(VD_MOTION_EASES.drift).toBe("sine.inOut");
  });
});
