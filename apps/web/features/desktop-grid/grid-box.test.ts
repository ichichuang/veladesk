import { describe, expect, it } from "vitest";

import { calculateGridContentSize } from "./grid-box";

/**
 * CSS Grid tracks live in the content box: `getBoundingClientRect`
 * includes the viewport padding (and border), so feeding it to
 * `calculateGridPixelMetrics` systematically inflates every cell. These
 * tests pin the pure content-box conversion the measurement hook relies
 * on — client box minus computed paddings, validated for finite and
 * non-negative geometry.
 */

const NO_PADDING = {
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 0,
  paddingBottom: 0,
};

describe("calculateGridContentSize", () => {
  it("returns the client box unchanged without padding", () => {
    const size = calculateGridContentSize({
      clientWidth: 1200,
      clientHeight: 640,
      ...NO_PADDING,
    });
    expect(size).toEqual({ width: 1200, height: 640 });
  });

  it("subtracts the production viewport padding (34/34/30/30)", () => {
    const size = calculateGridContentSize({
      clientWidth: 1468,
      clientHeight: 710,
      paddingLeft: 34,
      paddingRight: 34,
      paddingTop: 30,
      paddingBottom: 30,
    });
    expect(size).toEqual({ width: 1400, height: 650 });
  });

  it("subtracts asymmetric padding per side", () => {
    const size = calculateGridContentSize({
      clientWidth: 500,
      clientHeight: 300,
      paddingLeft: 11,
      paddingRight: 29,
      paddingTop: 7,
      paddingBottom: 13,
    });
    expect(size).toEqual({ width: 460, height: 280 });
  });

  it("keeps fractional pixel precision", () => {
    const size = calculateGridContentSize({
      clientWidth: 1000.5,
      clientHeight: 500.25,
      paddingLeft: 34.25,
      paddingRight: 34.25,
      paddingTop: 30.5,
      paddingBottom: 30.5,
    });
    expect(size.width).toBeCloseTo(932, 10);
    expect(size.height).toBeCloseTo(439.25, 10);
  });

  it("rejects negative paddings", () => {
    expect(() =>
      calculateGridContentSize({
        clientWidth: 800,
        clientHeight: 600,
        paddingLeft: -4,
        paddingRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
      }),
    ).toThrow(RangeError);
  });

  it("rejects non-finite inputs", () => {
    expect(() =>
      calculateGridContentSize({
        clientWidth: Number.NaN,
        clientHeight: 600,
        ...NO_PADDING,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateGridContentSize({
        clientWidth: 800,
        clientHeight: Number.POSITIVE_INFINITY,
        ...NO_PADDING,
      }),
    ).toThrow(RangeError);
  });

  it("rejects padding that consumes the whole client box", () => {
    expect(() =>
      calculateGridContentSize({
        clientWidth: 60,
        clientHeight: 60,
        paddingLeft: 34,
        paddingRight: 34,
        paddingTop: 30,
        paddingBottom: 30,
      }),
    ).toThrow(RangeError);
  });

  it("rejects a non-positive client box", () => {
    expect(() =>
      calculateGridContentSize({
        clientWidth: 0,
        clientHeight: 400,
        ...NO_PADDING,
      }),
    ).toThrow(RangeError);
  });
});
