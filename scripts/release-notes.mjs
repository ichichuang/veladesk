#!/usr/bin/env node
/**
 * VelaDesk 中文 Release 说明生成器（task 028 §18–§19）。
 *
 * 输出一份简短的中文下载/运行说明，供 GitHub Release 正文使用：
 * Release 的读者是普通用户，正文只回答“下载哪个文件、怎么跑起来、
 * 校验怎么做、详细说明在哪”，不放开发者 changelog。
 *
 * 版本号是唯一动态输入：三个程序包文件名全部由版本号派生，
 * 绝不硬编码任何具体版本。
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isValidVersion } from "./version-lib.mjs";

/**
 * @param {object} input
 * @param {string} input.version 纯 SemVer 版本号（如 "1.2.3"）。
 * @param {string} input.repository 仓库全名（如 "ichichuang/veladesk"）。
 * @returns {string} Markdown 正文。
 */
export function renderReleaseNotes({ version, repository }) {
  if (!isValidVersion(version)) {
    throw new Error(`invalid version: ${JSON.stringify(version)} (plain SemVer like "1.2.3" required)`);
  }
  if (typeof repository !== "string" || repository.length === 0 || !repository.includes("/")) {
    throw new Error(`invalid repository: ${JSON.stringify(repository)} (expected "owner/name")`);
  }
  return `# VelaDesk v${version}

VelaDesk 是一个自己部署、自己整理的浏览器主页和网站导航桌面。

## 下载

下载地址：https://github.com/${repository}/releases/latest

Windows 64 位：
VelaDesk-v${version}-windows-x64.zip

Linux 64 位：
VelaDesk-v${version}-linux-x64.tar.gz

Mac Apple 芯片：
VelaDesk-v${version}-macos-arm64.tar.gz

不要下载 GitHub 自动生成的 Source code，它们是源码。

## 运行

需要 Node.js 24 LTS。

Windows：
start-veladesk.cmd

macOS / Linux：
./start-veladesk.sh

访问：
http://127.0.0.1:3000

## 手机访问

手机访问电脑上的 VelaDesk 需要开启局域网监听。
详细方法请看项目 README。

## 校验

需要校验下载文件时，请使用 SHA256SUMS.txt。

## 说明

完整使用、升级和数据目录说明请看 README。
`;
}

function main(argv) {
  const readFlag = (name) => {
    const index = argv.indexOf(name);
    return index !== -1 ? argv[index + 1] : undefined;
  };
  const version = readFlag("--version");
  const repository = readFlag("--repo");
  const out = readFlag("--out");
  if (version === undefined || repository === undefined || out === undefined) {
    console.error("usage: node scripts/release-notes.mjs --version <X.Y.Z> --repo <owner/name> --out <file>");
    process.exitCode = 1;
    return;
  }
  let notes;
  try {
    notes = renderReleaseNotes({ version, repository });
  } catch (error) {
    console.error(`release notes generation failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const outFile = path.resolve(out);
  writeFileSync(outFile, notes, "utf8");
  console.log(`Release notes written: ${outFile}`);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2));
}
