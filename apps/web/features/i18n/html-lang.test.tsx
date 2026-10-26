// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "../../app/layout";
import { UiLocaleProvider } from "./ui-locale-provider";
import { UI_LOCALE_STORAGE_KEY } from "./locale";
import { useI18n } from "./use-i18n";

function LanguageSwitch() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale("en-US")}>English</button><button onClick={() => setLocale("zh-CN")}>中文</button></>;
}
afterEach(cleanup);
it("ships a Chinese lang attribute in the SSR document", () => {
  expect(renderToStaticMarkup(<RootLayout><p>VelaDesk</p></RootLayout>)).toContain('<html lang="zh-CN"');
});
it("restores and synchronizes document language on client switches", () => {
  window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "en-US");
  const view = render(<UiLocaleProvider><LanguageSwitch /></UiLocaleProvider>);
  expect(document.documentElement.lang).toBe("en");
  fireEvent.click(view.getByText("中文"));
  expect(document.documentElement.lang).toBe("zh-CN");
  fireEvent.click(view.getByText("English"));
  expect(document.documentElement.lang).toBe("en");
  fireEvent.click(view.getByText("中文"));
  expect(document.documentElement.lang).toBe("zh-CN");
});
