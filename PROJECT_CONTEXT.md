# VelaDesk 项目上下文

- 仓库：https://github.com/ichichuang/veladesk（本地检出 /workspace/veladesk，ext 项目键 `veladesk`）
- 经核实默认分支：`main`；直接在 main 开发，不建分支/worktree。
- 项目：自托管浏览器起始页 / 网站导航桌面。pnpm + turbo monorepo，Next.js 16、React 19、HeroUI v3、GSAP、Motion、Lenis。
- 负责人：Chris；总监·Veladesk 组织交付。验收由 Chris；未运行测试的交付物均注明。

## 当前目标
Phase 1「Vela Dawn」：视觉方向 A「拂晓海图」；按桌面壁纸与吸附/自由排版、Dawn 场景与开场、motion 令牌化均已交付；下一步见「活跃工作」。

## 重要决策
- 2026-11-09：概念 The Helm；栈保留 HeroUI+GSAP，加 Motion+Lenis。
- 2026-11-09：视觉方向 A 拂晓海图；实验开关单一 `motion.experiments.helmMotion`。
- 2026-11-09：可选按桌面上传壁纸（可分 light/dark）；每桌面 snap|free 布局，磁贴可自定义大小位置。
- 2026-11-09：Dawn 开场为 P1 正式动效、默认开启；`helmMotion` 只门控 Orbits/Wake。
- 2026-11-09：开发任务优先交 Free-AI，做不了再交 GLM 编程师（Chris 在 desk plan 群授权）。
- 2026-11-09：motion 只用令牌，不写 ease/时长字面量；分 GSAP 组 `VD_MOTION_EASES` 与贝塞尔组 `VD_MOTION_EASES_BEZIER`（供 Motion），两组角色双向一一对应（类型+测试约束）。
- 2026-11-09：断言顺序/时间先后的测试必须注入时钟（`now`），不依赖真实 `Date.now`。

## 活跃工作
- RecipeV1 导入接入布局、壁纸、主题。
- Orbits/Wake 原型（在 `helmMotion` 开关后，默认关）。
- 移动端外壳输出 `data-vd-material` 与 Dawn 图层。
- home-shell.css 拆分，顺带把样式表里写死的动效时长/缓动改为 CSS 变量。

## 已完成交付物
- 91b7b5f 测试：assets runtime 发件队列顺序用例注入递增时钟，补 queuedAt 相同时按 assetId 排序的用例（修偶发失败）。
- 667685e motion 令牌（三）：GSAP 组加 `linear: "none"`，两组角色双向对应；旋转周期 `VD_MOTION_AMBIENT.spin`、落点涟漪退场余量 `VD_MOTION_FLIP.dropRippleTail` 令牌化。
- c592e73 motion 令牌（二）：网格引导线淡入 `VD_MOTION_GRID_GUIDES`、环境循环 `VD_MOTION_AMBIENT` 与 `drift` 缓动令牌化。
- 149f2c8 motion 令牌（一）：新增 `VD_MOTION_EASES_BEZIER` 供 Motion 使用，涟漪与网格 FLIP 改用令牌；顺带修 responsive-workspace-shell 并发超时（预热懒加载模块）。
- 98920dc Dawn 开场默认开启（helmMotion 只管 Orbits/Wake），仅预设场景播放；涟漪缓动用令牌；补测试。
- 0cf2469 Dawn 场景：Dawn Chart 重皮肤、地平线光带、`data-vd-material` 材质档、GSAP 拂晓开场、吸附落点涟漪、Lenis 滚动区；拆分 desktop-item 与 domain editing。
- 132b125 p1-layout-wallpaper：每个空间可选深/浅色分别上传壁纸（IndexedDB，配方只存引用，0.45s 交叉淡入，过亮加 6% 遮罩）；每空间自动吸附/自由排版，两套布局数据各自保留；磁贴自定义大小与位置；RecipeV1 原地迁移；settings-center 拆分为 567 行。
- 2271032 docs/redesign/CONCEPT.md
- d708a10 desktop-shell 三层拆分 + tokens 迁入 packages/ui + motion-spec 入仓
- 65281ce Dawn Chart 语义令牌 + RecipeV1 + helmMotion + 关键画面文档（未运行测试，验收归 Chris）
