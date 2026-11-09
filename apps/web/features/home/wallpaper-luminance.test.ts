// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WALLPAPER_BRIGHT_LUMINANCE_THRESHOLD,
  isWallpaperBright,
} from "./wallpaper-luminance";

/**
 * The brightness measurement behind the readability veil (P1): mean
 * relative luminance over a tiny downsample, cached per URL. jsdom has no
 * real rasterizer, so the canvas is stubbed with deterministic pixel
 * buffers — the contract under test is the THRESHOLD decision and the
 * cache, not the resampling.
 */

const brightUrl = "blob:bright";
const darkUrl = "blob:dark";

function stubImagePixels(pixelsBySrc: Record<string, Uint8ClampedArray>): void {
  vi.stubGlobal("Image", class {
    readonly decoding = "async";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      const pixels = pixelsBySrc[value];
      if (pixels === undefined) {
        queueMicrotask(() => this.onerror?.());
        return;
      }
      (globalThis as Record<string, unknown>).__luminancePixels = pixels;
      queueMicrotask(() => this.onload?.());
    }
  });
  const getContext = vi.fn(() => ({
    drawImage: () => {},
    getImageData: () => ({ data: (globalThis as Record<string, unknown>).__luminancePixels }),
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    getContext as never,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isWallpaperBright (P1 veil)", () => {
  it("classifies mean luminance against the threshold", async () => {
    stubImagePixels({
      [brightUrl]: new Uint8ClampedArray([255, 255, 255, 255]),
      [darkUrl]: new Uint8ClampedArray([10, 10, 10, 255]),
    });
    await expect(isWallpaperBright(brightUrl)).resolves.toBe(true);
    await expect(isWallpaperBright(darkUrl)).resolves.toBe(false);
  });

  it("measures each URL exactly once — the result is cached per URL", async () => {
    let loads = 0;
    vi.stubGlobal("Image", class {
      readonly decoding = "async";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        loads += 1;
        (globalThis as Record<string, unknown>).__luminancePixels =
          new Uint8ClampedArray([200, 200, 200, 255]);
        queueMicrotask(() => this.onload?.());
      }
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (() => ({
        drawImage: () => {},
        getImageData: () => ({ data: (globalThis as Record<string, unknown>).__luminancePixels }),
      })) as never,
    );
    await expect(isWallpaperBright("blob:cached")).resolves.toBe(true);
    await expect(isWallpaperBright("blob:cached")).resolves.toBe(true);
    expect(loads).toBe(1);
  });

  it("resolves false (never a veil) when the probe fails to load", async () => {
    stubImagePixels({});
    await expect(isWallpaperBright("blob:broken")).resolves.toBe(false);
  });

  it("keeps the threshold in the bright-image band", () => {
    expect(WALLPAPER_BRIGHT_LUMINANCE_THRESHOLD).toBeGreaterThanOrEqual(0.5);
    expect(WALLPAPER_BRIGHT_LUMINANCE_THRESHOLD).toBeLessThanOrEqual(0.8);
  });
});
