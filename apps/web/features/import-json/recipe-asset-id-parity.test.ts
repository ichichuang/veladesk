/*
 * Cross-package parity (recipe A): the domain recipe validator carries a
 * COPY of the content asset id rule from packages/assets/src/core/id.ts
 * (domain does not depend on assets, nor assets on domain). apps/web
 * depends on both, so the two judgments are compared here on one sample
 * set — a drift in either copy fails this test.
 */
import { isContentAssetId } from "@veladesk/assets/core";
import { isRecipeAssetId, isRecipeWallpaperRef, RECIPE_CONTENT_ASSET_ID_PATTERN } from "@veladesk/domain";
import { describe, expect, it } from "vitest";

const HEX64 = "0123456789abcdef".repeat(4);

const VALID = [`asset-sha256-${HEX64}`, `asset-sha256-${"0".repeat(64)}`, `asset-sha256-${"f".repeat(64)}`];

const INVALID: readonly unknown[] = [
  "",
  "asset-sha256-",
  `asset-sha256-${HEX64.slice(1)}`,
  `asset-sha256-${HEX64}0`,
  `asset-sha256-${HEX64.toUpperCase()}`,
  `asset-sha256-${HEX64.slice(1)}g`,
  `ASSET-sha256-${HEX64}`,
  `asset-sha512-${HEX64}`,
  ` asset-sha256-${HEX64}`,
  `asset-sha256-${HEX64}\n`,
  `asset:asset-sha256-${HEX64}`,
  "asset-1",
  "asset-sha256-general",
  "sha256:abc",
  null,
  undefined,
  42,
  {},
];

describe("content asset id rule: domain recipe copy ≡ packages/assets", () => {
  it.each([...VALID, ...INVALID].map((sample) => [sample]))("agrees on %j", (sample) => {
    expect(isRecipeAssetId(sample)).toBe(isContentAssetId(sample));
  });

  it("accepts every valid sample and rejects every invalid one on both sides", () => {
    expect(VALID.every((id) => isRecipeAssetId(id) && isContentAssetId(id))).toBe(true);
    expect(INVALID.some((id) => isRecipeAssetId(id) || isContentAssetId(id))).toBe(false);
  });

  it("an asset: wallpaper ref is legal exactly when its id is a content asset id", () => {
    for (const sample of [...VALID, ...INVALID]) {
      if (typeof sample !== "string") continue;
      expect(isRecipeWallpaperRef(`asset:${sample}`)).toBe(isContentAssetId(sample));
    }
  });

  it("the copied pattern is the anchored, lowercase-hex, 64-digit rule", () => {
    expect(RECIPE_CONTENT_ASSET_ID_PATTERN.source).toBe("^asset-sha256-[0-9a-f]{64}$");
    expect(RECIPE_CONTENT_ASSET_ID_PATTERN.flags).toBe("");
  });
});
