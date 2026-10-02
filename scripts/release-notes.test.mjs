import { describe, expect, it } from "vitest";

import { renderReleaseNotes } from "./release-notes.mjs";

/**
 * Task 028 §18: the Chinese release-notes generator. The version drives
 * every archive filename — hardcoding any concrete version is the failure
 * mode these tests pin out.
 */

describe("renderReleaseNotes（中文 Release 说明生成器）", () => {
  it("按传入版本动态生成三个程序包文件名（1.2.3 不得来自硬编码）", () => {
    const notes = renderReleaseNotes({ version: "1.2.3", repository: "ichichuang/veladesk" });
    expect(notes).toContain("VelaDesk-v1.2.3-windows-x64.zip");
    expect(notes).toContain("VelaDesk-v1.2.3-linux-x64.tar.gz");
    expect(notes).toContain("VelaDesk-v1.2.3-macos-arm64.tar.gz");
    expect(notes).not.toContain("1.0.0");
  });

  it("换个版本，文件名跟着变（版本号唯一来源是入参）", () => {
    const notes = renderReleaseNotes({ version: "2.5.9", repository: "some-owner/some-repo" });
    expect(notes).toContain("VelaDesk-v2.5.9-windows-x64.zip");
    expect(notes).toContain("VelaDesk-v2.5.9-linux-x64.tar.gz");
    expect(notes).toContain("VelaDesk-v2.5.9-macos-arm64.tar.gz");
    expect(notes).toContain("https://github.com/some-owner/some-repo/releases/latest");
    expect(notes).not.toContain("1.2.3");
    expect(notes).not.toContain("ichichuang");
  });

  it("包含固定中文章节与关键事实", () => {
    const notes = renderReleaseNotes({ version: "1.2.3", repository: "ichichuang/veladesk" });
    for (const needle of [
      `# VelaDesk v1.2.3`,
      "## 下载",
      "## 运行",
      "## 手机访问",
      "## 校验",
      "## 说明",
      "Node.js 24 LTS",
      "start-veladesk.cmd",
      "./start-veladesk.sh",
      "http://127.0.0.1:3000",
      "SHA256SUMS.txt",
      "不要下载 GitHub 自动生成的 Source code",
      "详细方法请看项目 README",
    ]) {
      expect(notes).toContain(needle);
    }
  });

  it("拒绝非法版本号与非法仓库名", () => {
    expect(() => renderReleaseNotes({ version: "v1.0.0", repository: "a/b" })).toThrow(/invalid version/);
    expect(() => renderReleaseNotes({ version: "1.0.0-beta", repository: "a/b" })).toThrow(/invalid version/);
    expect(() => renderReleaseNotes({ version: "1.0.0", repository: "no-slash" })).toThrow(/invalid repository/);
    expect(() => renderReleaseNotes({ version: "1.0.0" })).toThrow(/invalid repository/);
  });
});
