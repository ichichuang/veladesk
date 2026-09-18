import { describe, expect, it } from "vitest";

import { buildLocaleSwitchButtons } from "./locale-switch";

/**
 * The topbar 中/EN switch (014-E): one compact control, exactly one active
 * side, endonym glyphs that never change with the active locale.
 */
describe("buildLocaleSwitchButtons", () => {
  it("exposes both locales in a stable order with endonym labels", () => {
    const buttons = buildLocaleSwitchButtons("zh-CN");
    expect(buttons.map((button) => button.label)).toEqual(["中", "EN"]);
    expect(buttons.map((button) => button.locale)).toEqual(["zh-CN", "en-US"]);
  });

  it("presses exactly one side for each supported locale", () => {
    for (const locale of ["zh-CN", "en-US"] as const) {
      const pressed = buildLocaleSwitchButtons(locale).filter((button) => button.pressed);
      expect(pressed.length).toBe(1);
      expect(pressed[0]!.locale).toBe(locale);
    }
  });

  it("keeps labels identical regardless of the active locale", () => {
    expect(buildLocaleSwitchButtons("en-US").map((button) => button.label)).toEqual(
      buildLocaleSwitchButtons("zh-CN").map((button) => button.label)
    );
  });
});
