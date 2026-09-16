import { describe, expect, it } from "vitest";

import { DESKTOP_ENGINE_VERSION } from "./index";

describe("@veladesk/desktop-engine", () => {
  it("exposes DESKTOP_ENGINE_VERSION as the current package version", () => {
    expect(DESKTOP_ENGINE_VERSION).toBe("0.1.0");
  });
});
