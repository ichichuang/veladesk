import { describe, expect, it } from "vitest";

import { DEFAULT_UI_LOCALE } from "./locale";
import { enUS, zhCN, translate, type TranslationKey } from "./messages";

/**
 * Catalog contract: zh-CN is the default UI language and the key source of
 * truth; en-US must declare the exact same key set at compile time and is
 * re-verified here at test time, so a missing translation can never fall
 * back to English inside the Chinese UI.
 */

describe("message catalogs", () => {
  it("has identical key sets in both locales", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("leaves no entry blank in either catalog", () => {
    for (const [key, value] of Object.entries(zhCN)) {
      expect(value.length, `zhCN[${key}]`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(enUS)) {
      expect(value.length, `enUS[${key}]`).toBeGreaterThan(0);
    }
  });

  it("translates representative Chinese keys", () => {
    expect(zhCN["mode.view"]).toBe("查看");
    expect(zhCN["mode.arrange"]).toBe("整理");
    expect(zhCN["launcher.noMatches"]).toBe("没有匹配结果");
    expect(zhCN["launcher.kind.page"]).toBe("分区");
    expect(zhCN["menu.newSection"]).toBe("新建分区");
    expect(zhCN["onboarding.defaultWorkspaceName"]).toBe("我的 VelaDesk");
    expect(zhCN["onboarding.defaultPageName"]).toBe("主页");
  });

  it("translates representative English keys", () => {
    expect(enUS["mode.view"]).toBe("View");
    expect(enUS["mode.arrange"]).toBe("Arrange");
    expect(enUS["launcher.noMatches"]).toBe("No matches");
    expect(enUS["launcher.kind.page"]).toBe("Section");
    expect(enUS["menu.newSection"]).toBe("New Section");
    expect(enUS["onboarding.defaultWorkspaceName"]).toBe("My VelaDesk");
    expect(enUS["onboarding.defaultPageName"]).toBe("Home");
  });

  it("localizes every production launcher command label", () => {
    const commandKeys: readonly TranslationKey[] = [
      "launcher.command.addApp",
      "launcher.command.newSection",
      "launcher.command.openSettings",
      "launcher.command.switchToView",
      "launcher.command.switchToArrange",
      "launcher.command.syncNow",
      "launcher.command.refreshFromServer",
    ];
    for (const key of commandKeys) {
      expect(zhCN[key].length, `zhCN[${key}]`).toBeGreaterThan(0);
      expect(enUS[key].length, `enUS[${key}]`).toBeGreaterThan(0);
    }
    expect(zhCN["launcher.command.addApp"]).toBe("添加应用");
    expect(enUS["launcher.command.addApp"]).toBe("Add App");
    expect(zhCN["launcher.command.newSection"]).toBe("新建分区");
    expect(enUS["launcher.command.newSection"]).toBe("New Section");
  });

  it("translates with interpolation through translate()", () => {
    expect(translate("zh-CN", "dock.openApp", { name: "Mail" })).toBe("打开 Mail");
    expect(translate("en-US", "dock.openApp", { name: "Mail" })).toBe("Open Mail");
    expect(translate("zh-CN", "mode.view")).toBe("查看");
  });

  it("answers in the default locale for the default locale", () => {
    expect(DEFAULT_UI_LOCALE).toBe("zh-CN");
    expect(translate(DEFAULT_UI_LOCALE, "settings.title")).toBe("设置");
  });
});
