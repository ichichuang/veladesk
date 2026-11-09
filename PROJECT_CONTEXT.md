# VelaDesk 项目上下文

- 仓库：https://github.com/ichichuang/veladesk（本地检出 /workspace/veladesk，ext 项目键 `veladesk`）
- 经核实默认分支：`main`；直接在 main 开发，不建分支/worktree。
- 项目：自托管浏览器起始页 / 网站导航桌面。pnpm + turbo monorepo，Next.js 16、React 19、HeroUI v3、GSAP；规划新增 Motion + Lenis。
- 负责人：Chris；总监·Veladesk 组织交付。验收由 Chris；未运行测试的交付物均注明。

## 当前目标
Phase 1「Vela Dawn」：视觉方向已拍板为 A「拂晓海图」；动效规格与令牌已定；正在实现按桌面壁纸（可分深浅色）与吸附/自由排版。

## 重要决策
- 2026-11-09：概念 The Helm；栈保留 HeroUI+GSAP，加 Motion+Lenis。
- 2026-11-09：视觉方向 A 拂晓海图；实验开关单一 `motion.experiments.helmMotion`。
- 2026-11-09：可选按桌面上传壁纸（可分 light/dark）；每桌面 snap|free 布局，磁贴可自定义大小位置。

## 活跃工作
- p1-layout-wallpaper（进行中）：RecipeV1 字段补 wallpaper{light,dark}/layoutMode/placement；壁纸上传；snap/free 布局。

## 已完成交付物
- 2271032 docs/redesign/CONCEPT.md
- d708a10 desktop-shell 三层拆分 + tokens 迁入 packages/ui + motion-spec 入仓
- 65281ce Dawn Chart 语义令牌 + RecipeV1 + helmMotion + 关键画面文档（未运行测试，验收归 Chris）
