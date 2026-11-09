# VelaDesk 项目上下文

- 仓库：https://github.com/ichichuang/veladesk（本地检出 /workspace/veladesk，ext 项目键 `veladesk`）
- 经核实默认分支：`main`（2026-11-04 `git ls-remote --symref origin HEAD` 解析为 refs/heads/main）；直接在 main 开发，不建分支/worktree。
- 项目：自托管浏览器起始页 / 网站导航桌面。pnpm + turbo monorepo（apps、packages），Next.js 16、React 19、TypeScript、SQLite，Node 24。详见 README.md、docs/DEVELOPMENT.md。
- 负责人：Chris（所有者）；总监·Veladesk 负责组织交付。
- 设计偏好：选定 UI 组件库；固定应用布局、独立可滚动容器；架构级全局设计令牌；流畅优雅的动画。

## 当前目标
VelaDesk 重新设计（概念「The Helm 掌舵」）。概念稿：docs/redesign/CONCEPT.md（2026-11-09，视觉/动效/工程共同事实来源，含「团队已定原则」7 条）。Chris 已授权团队全权推进，视觉方向由总监在设计师候选方案中拍板。技术栈结论：保留 HeroUI v3 + GSAP，新增 Motion 与 Lenis（引擎分工、Lenis 边界等见概念稿原则）。第一阶段「Vela Dawn（拂晓）」：令牌迁入 packages/ui、desktop-shell.tsx 三层拆分（shell / tile-host / scene）、动效语言与首批高光时刻。

## 重要决策
- 2026-11-04：总监接手，登记 ext 项目键 veladesk。

## 活跃工作
- 2026-11-09 concept-doc-1：新增 docs/redesign/CONCEPT.md（重设计概念稿：愿景、团队已定原则、五个高光时刻、个性化与插件架构、工程约束、技术栈决策、四阶段路线图与 Phase 1「Vela Dawn」分角色交付物）。下一步：按 P1 直接启动——视觉（令牌表、拂晓美术方向，出候选方案供总监拍板）、动效（动效语言、分镜）、工程（desktop-shell 三层拆分、令牌迁入 packages/ui、性能基线）。

## 已完成交付物
无（接手前最新提交 e4e5652 data protection limits）。
