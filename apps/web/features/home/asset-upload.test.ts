import { describe, expect, it } from "vitest";

import { MAX_ASSET_BYTES } from "@veladesk/assets/core";

import { firstImageFile } from "./asset-upload";

/**
 * Pure selection logic of the upload pipeline. The decode/dimension path
 * (`prepareUploadedImage`) needs `createImageBitmap` and is exercised in
 * the browser matrix; the shared size/magic/hash validation is covered by
 * @veladesk/assets core tests.
 */

function fileWith(name: string, type: string): File {
  return new File([new Uint8Array([1])], name, { type });
}

describe("firstImageFile", () => {
  it("picks the first image file and skips non-images", () => {
    const png = fileWith("logo.png", "image/png");
    const jpeg = fileWith("photo.jpg", "image/jpeg");

    expect(firstImageFile([png, jpeg])).toBe(png);
    expect(firstImageFile([fileWith("notes.txt", "text/plain"), jpeg])).toBe(jpeg);
  });

  it("returns undefined when no image is present", () => {
    expect(firstImageFile([])).toBeUndefined();
    expect(firstImageFile([fileWith("page.html", "text/html")])).toBeUndefined();
  });
});

describe("upload budget constants", () => {
  it("mirrors the shared 4 MiB budget from the asset core", () => {
    expect(MAX_ASSET_BYTES).toBe(4 * 1024 * 1024);
  });
});
