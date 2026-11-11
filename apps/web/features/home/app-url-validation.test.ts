import { describe, expect, it } from "vitest";

import { isParseableAppUrl, looksLikeWebHost, validateAppUrlInput } from "./app-url-validation";

/** The persisted url of an accepted submission (fails the test when refused). */
function urlOf(input: string): string {
  const result = validateAppUrlInput(input);
  if (!result.ok) {
    throw new Error(`expected ${JSON.stringify(input)} to be valid (${result.reason})`);
  }
  return result.url;
}

describe("validateAppUrlInput (UX-04)", () => {
  it("auto-completes dotted hostnames to canonical https URLs", () => {
    expect(validateAppUrlInput("example.com")).toEqual({
      ok: true,
      url: "https://example.com/",
    });
    expect(validateAppUrlInput("  github.com/pricing  ")).toEqual({
      ok: true,
      url: "https://github.com/pricing",
    });
  });

  it("accepts localhost, IPs, ports, paths, queries and fragments", () => {
    expect(urlOf("localhost")).toBe("https://localhost/");
    expect(urlOf("localhost:3000/app")).toBe("https://localhost:3000/app");
    expect(urlOf("127.0.0.1")).toBe("https://127.0.0.1/");
    expect(urlOf("192.168.1.10:8080/admin?x=1#top")).toBe(
      "https://192.168.1.10:8080/admin?x=1#top",
    );
    expect(urlOf("[::1]:5173")).toBe("https://[::1]:5173/");
  });

  it("keeps scheme'd input verbatim, custom protocols included", () => {
    expect(urlOf("https://example.com")).toBe("https://example.com");
    expect(urlOf("obsidian://open?vault=notes")).toBe(
      "obsidian://open?vault=notes",
    );
    expect(urlOf("HTTP://EXAMPLE.COM/")).toBe("HTTP://EXAMPLE.COM/");
  });

  it("refuses free text that never looks like a destination", () => {
    expect(validateAppUrlInput("not-a-url")).toEqual({ ok: false, reason: "invalid" });
    expect(validateAppUrlInput("无效网址测试")).toEqual({ ok: false, reason: "invalid" });
    expect(validateAppUrlInput("中文文本")).toEqual({ ok: false, reason: "invalid" });
    expect(validateAppUrlInput("notes app")).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses Chinese hosts instead of punycoding them", () => {
    expect(validateAppUrlInput("百度.com")).toEqual({ ok: false, reason: "invalid" });
    expect(validateAppUrlInput("无效网址.测试")).toEqual({ ok: false, reason: "invalid" });
  });

  it("flags empty input separately (the existing 请输入网址。 arm)", () => {
    expect(validateAppUrlInput("")).toEqual({ ok: false, reason: "empty" });
    expect(validateAppUrlInput("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses broken scheme'd input", () => {
    expect(validateAppUrlInput("https://")).toEqual({ ok: false, reason: "invalid" });
    expect(validateAppUrlInput("http://[::1")).toEqual({ ok: false, reason: "invalid" });
    expect(validateAppUrlInput("https://exa mple.com")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("keeps host:port input out of the scheme arm (URL grammar quirk)", () => {
    expect(urlOf("example.com:8080")).toBe("https://example.com:8080/");
    expect(urlOf("192.168.0.1:8000/x")).toBe("https://192.168.0.1:8000/x");
  });
});

describe("looksLikeWebHost", () => {
  it("matches dotted hostnames, localhost and IP literals only", () => {
    expect(looksLikeWebHost("example.com")).toBe(true);
    expect(looksLikeWebHost("a.b.c.example.co.uk")).toBe(true);
    expect(looksLikeWebHost("localhost")).toBe(true);
    expect(looksLikeWebHost("10.0.0.2")).toBe(true);
    expect(looksLikeWebHost("[::1]")).toBe(true);
    expect(looksLikeWebHost("not-a-url")).toBe(false);
    expect(looksLikeWebHost("example")).toBe(false);
    expect(looksLikeWebHost("百度.com")).toBe(false);
    expect(looksLikeWebHost("")).toBe(false);
  });
});

describe("isParseableAppUrl (legacy data)", () => {
  it("accepts anything the URL constructor accepts", () => {
    expect(isParseableAppUrl("https://example.com/")).toBe(true);
    expect(isParseableAppUrl("obsidian://open")).toBe(true);
    expect(isParseableAppUrl("https://not-a-url/")).toBe(true);
  });

  it("refuses stored free text so the launch path can toast", () => {
    expect(isParseableAppUrl("无效网址测试")).toBe(false);
    expect(isParseableAppUrl("not a url")).toBe(false);
  });
});
