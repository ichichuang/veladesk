import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Task 028: the main README is a Chinese guide for ordinary users. These
 * static contract tests pin the sections and facts it must answer (what is
 * it / what can it do / which file to download / how to run / mobile / data
 * / upgrade / troubleshooting) and the English developer-README content
 * that must stay out (it moved to docs/DEVELOPMENT.md).
 */

const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");

describe("README — 中文用户指南目录与关键事实 (task 028 §3/§17)", () => {
  it("主标题与固定章节全部在位", () => {
    expect(readme).toMatch(/^# VelaDesk\s*$/m);
    for (const section of [
      "## VelaDesk 是什么",
      "## 能做什么",
      "## 下载",
      "## 运行前准备",
      "## Windows 使用方法",
      "## macOS 使用方法",
      "## Linux 使用方法",
      "## 手机访问电脑上的 VelaDesk",
      "## 数据保存在哪里",
      "## 升级",
      "## 常见问题",
      "## 开发者",
      "## 开源协议",
    ]) {
      expect(readme).toContain(section);
    }
  });

  it("关键事实：环境、地址、环境变量、下载入口、架构名", () => {
    expect(readme).toContain("Node.js 24 LTS");
    expect(readme).toContain("127.0.0.1:3000");
    expect(readme).toContain("VELADESK_HOST");
    expect(readme).toContain("VELADESK_PORT");
    expect(readme).toContain("releases/latest");
    expect(readme).toContain("windows-x64");
    expect(readme).toContain("linux-x64");
    expect(readme).toContain("macos-arm64");
    expect(readme).toContain("Source code");
  });

  it("数据目录表格覆盖三个平台", () => {
    expect(readme).toContain("%LOCALAPPDATA%\\VelaDesk");
    expect(readme).toContain("~/Library/Application Support/VelaDesk");
    expect(readme).toContain("${XDG_DATA_HOME:-$HOME/.local/share}/veladesk");
  });

  it("未提供的架构写明，不误导用户", () => {
    expect(readme).toContain("Intel Mac 正式包");
    expect(readme).toContain("Windows ARM 正式包");
    expect(readme).toContain("Linux ARM 正式包");
  });

  it("开发者内容指到 docs/DEVELOPMENT.md", () => {
    expect(readme).toContain("docs/DEVELOPMENT.md");
  });
});

describe("README — 旧英文开发者内容必须清除 (task 028 §17)", () => {
  it("不再包含英文产品介绍与内部实现说明", () => {
    for (const forbidden of [
      "Build your browser home, your way",
      "Highlights",
      "VelaDesk is in early development",
      "Internal packages",
      "Contributions are welcome once the codebase lands",
    ]) {
      expect(readme).not.toContain(forbidden);
    }
  });
});
