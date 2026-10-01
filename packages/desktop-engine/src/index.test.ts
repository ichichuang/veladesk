import { describe, expect, it } from "vitest";

import { createGridDefinition, isValidGridDefinition } from "./index";

describe("@veladesk/desktop-engine public surface", () => {
  it("still exports the grid definition contract", () => {
    // The package version itself is NOT hand-maintained here anymore: the
    // single VelaDesk version source is the root package.json (task 025).
    expect(isValidGridDefinition(createGridDefinition(10, 6))).toBe(true);
  });
});
