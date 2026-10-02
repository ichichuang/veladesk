# VelaDesk 开发文档

面向要修改源码、参与开发或了解项目结构的开发者。
普通用户请看主 [README](../README.md)。

## 环境要求

- Node.js 24 LTS（版本以仓库根目录 `.nvmrc` 为准）
- pnpm（版本以根目录 `package.json` 的 `packageManager` 字段为准）

## 常用命令

```bash
pnpm install      # 安装依赖
pnpm dev          # 启动开发服务器
pnpm build        # 构建（含 Next.js standalone 产物）
pnpm typecheck    # 类型检查
pnpm lint         # ESLint
pnpm test:run     # 运行全部测试（一次性运行）
pnpm clean        # 清理构建产物与 node_modules
```

版本管理：

```bash
pnpm version:set 1.2.0   # 统一设置全部 manifest 的版本
pnpm version:check       # 校验 14 个 manifest 版本一致
```

## 版本只有一个来源

产品版本只写在根目录 `package.json` 的 `version` 里。
其他一切（各子包 manifest、Settings 显示、构建产物、发布归档、git tag、
GitHub Release）都从它派生，不要在别处手改版本号。

## 目录概览

VelaDesk 是一个 pnpm workspace 单仓库（monorepo）。

| 路径 | 说明 |
| --- | --- |
| `apps/web` | Next.js（App Router）Web 应用 |
| `packages/desktop-engine` | 桌面网格、布局、碰撞与选择逻辑 |
| `packages/canvas-engine` | 连续画布几何：矩形、吸附网格、缩放数学、历史 |
| `packages/domain` | 工作区、实体、页面、Dock 与文件夹的领域契约 |
| `packages/ui` | VelaDesk UI 适配层 |
| `packages/shared` | 共享类型与纯工具 |
| `packages/assets` | 内容寻址的图片资源管线 |
| `packages/icon-catalog` | 内置离线图标目录（Iconify 集合） |
| `packages/database` | SQLite 持久化（Drizzle 迁移） |
| `packages/local-store` | IndexedDB 工作副本、outbox 与本地优先同步状态 |
| `packages/sync` | HTTP 工作区同步与 outbox 协调 |
| `packages/client-runtime` | 浏览器工作区引导与本地优先会话运行时 |
| `docs/architecture` | 工程与架构文档 |

## 架构文档

工程决策与架构说明在 [docs/architecture](./architecture/) 目录，
按主题分文件（应用视觉体系、外观设置、资源管线、拖拽会话等）。

## 局域网开发（仅开发服务器）

要从局域网内另一台设备访问开发服务器
（例如 `http://10.100.50.74:3100`），需要把访问来源的主机名传给
Next.js，否则开发专用资源（HMR、字体）会被当作跨域拦截：

```bash
VELADESK_DEV_ALLOWED_ORIGINS=10.100.50.74 \
pnpm --filter @veladesk/web exec next dev \
  -H 0.0.0.0 \
  -p 3100
```

`VELADESK_DEV_ALLOWED_ORIGINS` 是逗号分隔的主机名列表，
只作用于 Next.js 开发服务器的来源允许清单，不是生产配置。
生产环境请使用程序包自带的启动脚本和 `VELADESK_HOST` / `VELADESK_PORT`。

## 参与开发

欢迎通过 issue 提交想法和反馈；提交代码前请确保
`pnpm typecheck`、`pnpm lint`、`pnpm test:run` 全部通过。
