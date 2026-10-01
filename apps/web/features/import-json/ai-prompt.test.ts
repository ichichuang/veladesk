import { describe, expect, it } from "vitest";

import { buildImportAiPrompt } from "./ai-prompt";

describe("buildImportAiPrompt", () => {
  it("produces the full zh-CN prompt with the v1 contract", () => {
    const prompt = buildImportAiPrompt("zh-CN");
    expect(prompt).toContain("VelaDesk Import JSON v1");
    expect(prompt).toContain('"format": "veladesk-import"');
    expect(prompt).toContain('"version": 1');
    expect(prompt).toContain('"sections"');
    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"url"');
    expect(prompt).toContain('"icon": "auto"');
    expect(prompt).toContain("内部 ID");
    expect(prompt).toContain("JSON.parse");
    expect(prompt).toContain("其他");
    // JSON-only instruction comes first.
    expect(prompt.indexOf("只输出合法 JSON")).toBeGreaterThan(0);
    expect(prompt.indexOf("只输出合法 JSON")).toBeLessThan(prompt.indexOf("veladesk-import"));
  });

  it("produces the equivalent en-US prompt", () => {
    const prompt = buildImportAiPrompt("en-US");
    expect(prompt).toContain("VelaDesk Import JSON v1");
    expect(prompt).toContain('"format": "veladesk-import"');
    expect(prompt).toContain('"version": 1');
    expect(prompt).toContain("valid JSON only");
    expect(prompt).toContain("JSON.parse");
    expect(prompt).toContain("internal IDs");
  });

  it("forbids internal VelaDesk fields in both locales", () => {
    for (const locale of ["zh-CN", "en-US"] as const) {
      const prompt = buildImportAiPrompt(locale);
      expect(prompt).not.toContain("assetId");
      expect(prompt).not.toContain("grid");
    }
  });
});
