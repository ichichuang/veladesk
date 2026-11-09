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
- 下一步：配方导入接入布局/壁纸/主题；Orbits/Wake 原型（仍在 helmMotion 开关后）；Wake 光迹画布；移动端外壳纳入材质档/拂晓开场。

## 已完成交付物
- p2-dawn-scene（工作树，未提交）：桌面场景+外框 Dawn Chart 重皮肤（home-shell.css 旧 --vd-* 全部改指 packages/ui 语义令牌，零新增色值字面量；启动/引导屏同步拂晓化）；默认/预设场景常驻 Dawn 地平线光带+海图经纬线（自定义壁纸不渲染）；shell 双根 emit `data-vd-material`（glass/soft/clean 令牌档，跟随保存/预览的界面风格）；GSAP 拂晓开场（scene/use-dawn-intro.ts，≤300ms、可打断、每会话一次、bfcache/减弱动态直接静态）在 helmMotion 开关后，设置→通用新增「动效实验」；落点涟漪（Motion，220ms 描边）与减弱动态下 FLIP 120ms 交叉淡化；Lenis 接入 VdScrollArea（smooth 项：设置面板/启动器/图标选择器/文件夹浮层，减弱动态不启用）；desktop-item.tsx 拆出 use-item-resize.ts（517 行）、domain editing.ts 拆为 editing/{shared,entities,pages}；lenis@1.3.27 依赖。测试/类型/lint/构建全绿（root vitest 并行下 responsive-workspace-shell 为已知环境抖动，单跑通过）。
- 132b125 p1-layout-wallpaper：每个空间可选深/浅色分别上传壁纸（IndexedDB，配方只存引用，0.45s 交叉淡入，过亮加 6% 遮罩）；每空间自动吸附/自由排版，两套布局数据各自保留；磁贴自定义大小与位置；RecipeV1 原地迁移；settings-center 拆分为 567 行。
- 2271032 docs/redesign/CONCEPT.md
- d708a10 desktop-shell 三层拆分 + tokens 迁入 packages/ui + motion-spec 入仓
- 65281ce Dawn Chart 语义令牌 + RecipeV1 + helmMotion + 关键画面文档（未运行测试，验收归 Chris）
