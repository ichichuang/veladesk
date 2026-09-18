import { describe, expect, it } from "vitest";

import { formatMessage } from "./format-message";

describe("formatMessage", () => {
  it("returns the template unchanged without parameters", () => {
    expect(formatMessage("Settings")).toBe("Settings");
    expect(formatMessage("设置", {})).toBe("设置");
  });

  it("interpolates a count parameter", () => {
    expect(formatMessage("{count} 项已选择", { count: 3 })).toBe("3 项已选择");
    expect(formatMessage("{count} selected", { count: 12 })).toBe("12 selected");
  });

  it("interpolates a name parameter", () => {
    expect(formatMessage("删除 {name}?", { name: "Alpha" })).toBe("删除 Alpha?");
  });

  it("interpolates several parameters and repeated ones", () => {
    expect(formatMessage("{a}-{b}-{a}", { a: "1", b: "2" })).toBe("1-2-1");
  });

  it("interpolates numeric values", () => {
    expect(formatMessage("HTTP {status}", { status: 503 })).toBe("HTTP 503");
  });

  it("leaves placeholders without a matching parameter literal", () => {
    // A missing value stays visible instead of silently deleting text.
    expect(formatMessage("{count} selected", {})).toBe("{count} selected");
  });

  it("does not treat non-placeholder braces as parameters", () => {
    expect(formatMessage("a { not-a-placeholder } b", { count: 1 })).toBe(
      "a { not-a-placeholder } b",
    );
  });
});
