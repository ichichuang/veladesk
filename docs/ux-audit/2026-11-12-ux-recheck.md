# Veladesk UX 复测报告（2026-11-12，修复后只测不改）

- 基线：`main` @ `fce2e35`（UX-01..13 三批修复全部落地之后），**本次全新生产构建**（`apps/web` 下 `next build`，构建时间 2026-11-12 约 11:00，standalone 目录先删后建，排除过期产物），`apps/web/scripts/e2e-standalone-server.mjs`（每次探测独立临时数据目录）。
- 方法：Playwright 真实浏览器操作（点击、右键、键盘、滚轮、鼠标拖拽、CDP 真实触摸、文件上传、路由拦截断网、截图像素取样），每个结论都有可重放的探测脚本与数据文件支撑。探测脚本：`artifacts/ux-recheck/probes/*.mjs`；截图：`artifacts/ux-recheck/shots/`；原始数据：`artifacts/ux-recheck/data/*.json`。
- 覆盖：PC 1440×900（主）、1920×1080、1280×720（烟囱）；手机 390×844、375×667（`hasTouch`+`isMobile`，pane 内目标一律 CDP 真实触摸）。深色/浅色、`prefers-reduced-motion: reduce` 各覆盖关键项。
- 方法材料说明：任务指定的 `/home/box/shared-skills/INDEX.md` 与 impeccable skill 在本机不存在（`/home/box/shared-skills/` 整个目录缺失），本次按原审计的方法框架独立执行。
- 环境备忘：本机 headless Chromium（chrome-headless-shell 1248）在 CSS 解析层丢弃 `-webkit-backdrop-filter`，所有玻璃模糊在本报告截图中不可见——以构建产物 CSS 文本 + 实机观感为准，不作为缺陷计（与 b1 报告一致）。

## 总体结论

**整体体验：9 / 10**（11-11 审计为 7 / 10）。原 13 条问题中 **12 条判定已修复**、1 条（UX-03）确认为当时过期构建导致的误报、行为本身一直在线；本次复测**未发现任何一条已修复项回归**。两个 P1（文件夹浮层、自定义壁纸黑屏）在深/浅/减弱动态与刷新持久化各路径下均实测通过；移动端从纯只读 shell 补齐了完整的编辑路径且对话框在 390/375 两档均不破版。剩余扣分点：headless 下 t77 滚动阻尼 e2e 在负载波动时仍会假失败（环境问题、隔离重跑即绿，与基线行为一致）、移动端长按菜单在极端场景的 8px 判定兜底语义（b3 已知）、以及若干轻微观感项（见"新发现"）。

**与 11-11 审计对比：UX-01、02、04、05、06、07、08、09、10、11、12、13 已修复；UX-03 判"无法复现（当时为过期构建），行为正常"。**

## 复测结果表（UX-01..13）

| 编号 | 结论 | 证据摘要 | 截图 / 数据 |
|---|---|---|---|
| UX-01 文件夹浮层 | **已修复** | 3 个子项 rect 两两不同（如 dark-1440：x=447/558/669，等宽 102.8px 网格）、全部在视口内；面板背景 `oklch(0.22 0.03 255 / 0.62)` + 1px 描边，遮罩 40%；面板顶部 elementFromPoint 命中面板自身（背后磁贴不再透出）；Esc 关闭；深色 1440/1920/1280、浅色工作区（面板 `oklch(1 0 0 / 0.78)`）、减弱动态、手机端（mobile-folder-sheet 另有面板，含 3 子项）全部通过 | `ux01-*.png`（7 张）、`data/ux01-results.json`、`data/ux01-light-ws-desktop.json`、`data/ux01-mobile-folder-sheet.json`；构建 CSS 含 `-webkit-backdrop-filter:blur(var(--vd-blur-panel))`（`data/ux01-css-panel-inner.json`） |
| UX-02 自定义背景 | **已修复** | 64×64 棋盘 PNG 上传→保存：`img.naturalWidth=64`、canvas 取样中心亮度 540（非黑）、无 `ERR_FILE_NOT_FOUND`、无 pageerror；刷新后仍在（持久化 asset 的新 object URL、同内容）；浅色、减弱动态同契约；取消路径回退原 chart 壁纸无黑屏 | `ux02-*.png`（11 张）、`data/ux02-results.json` |
| UX-03 ⌘K | **无法复现（11-11 报告为过期构建所致），行为正常** | 全新构建：body 焦点 Ctrl+K 开、再按关（toggle）、Meta+K 开、磁贴焦点开、右键菜单关闭后开、键入 "git" 只滤出 GitHub、Enter 新标签打开 github.com、Esc 关——全部通过，零控制台错误 | `ux03-ctrlk-open.png`、`ux03-filtered-git.png`、`data/ux03-results.json` |
| UX-04 网址校验 | **已修复** | `not-a-url` / `无效网址测试` / `例子.测试` 均被拒，内联错误「请输入有效的网址，例如 example.com。」（role=alert）且对话框不关；`example.com` 通过且 API 落库 `https://example.com/`；编辑对话框同一门禁；坏网址磁贴点击出 toast「「打不开的网址」的网址无法打开，请编辑后重试。」、无新标签、不跳转 | `ux04-*.png`（6 张）、`data/ux04-05-06-results.json` |
| UX-05 aria-disabled | **已修复** | 11 个 `.vela-item` 全部无 `aria-disabled`、无 `aria-roledescription`；普通 click（无 force）可点开新标签；focus+Enter 可打开 | `ux05-tiles.png`、`data/ux04-05-06-results.json` |
| UX-06 对话框一致性 | **已修复** | 添加=「名称→网址」，编辑=「名称→网址→打开方式」，标签文案与占位符一致（`vela-add-app-name/url` vs `vela-edit-app-name/url`） | `ux06-edit-dialog.png`、`data/ux04-05-06-results.json`（ux06 字段 dump） |
| UX-07 设置草稿+保存 | **已修复** | 点浅色→桌面 `data-vd-color-mode` 仍 dark、壁纸仍 chart；点薄雾→桌面仍 chart；保存→light+mist 同时生效；二次会话改深色+chart 后取消→桌面保持已保存 light+mist；面板底部出现「有未保存的更改」条 | `ux07-draft-light.png`（面板浅色、身后桌面深色）、`ux07-after-save.png`、`ux07-after-cancel.png`、`data/ux07-results.json` |
| UX-08 空分区引导 | **已修复** | 空分区显示虚线占位「这个分区还没有应用」+「添加应用」按钮；点击打开添加对话框（目标=当前分区）；添加后占位消失、磁贴出现；手机端空分区同样有「添加应用」（83×106 / 87×64px） | `ux08-empty-section.png`、`ux08-after-add.png`、`ux12-*-empty-add*.png`、`data/ux08-09-results.json` |
| UX-09 删除 toast+撤销 | **已修复** | 删除→toast「已删除「GitHub」」+「撤销」；撤销后磁贴原位恢复（dx=0, dy=0），Dock 固定恢复（截图可见 GitHub+Figma 图标）；不撤销等 7.5s→toast 消失→刷新确认真删 | `ux09-delete-toast.png`、`ux09-undo-restored.png`、`data/ux08-09-results.json` |
| UX-10 浅色磁贴边界 | **已修复** | 浅色（chart 壁纸）下每张磁贴有清晰细描边；可见磁贴左缘像素亮度剖面 [背景≈0.67 → 边界 0.134 → 磁贴底≈0.89]，边界 vs 背景 3.89:1、vs 磁贴底 5.16:1（均 ≥3:1）；手机浅色同样有边界 | `ux10-light-tiles-1440.png`、`ux10-mobile-light-390.png`、`data/ux10-results.json`、`data/ux10-pixel-visible-tile.json` |
| UX-11 离线启动态 | **已修复** | 有本地数据断网启动→直接进桌面（无引导 funnel）+ 右下 toast「当前离线，正在使用本地数据。」；离线改名生效后左下徽标「离线 · 本地数据可用」（13px、accent 描边、32px 高、title/aria-label 完整）；解除拦截点击徽标→同步成功徽标消失、改名保留；冷启动断网→「无法连接服务器」+「重新加载」按钮，无新手引导 | `ux11-offline-boot.png`、`ux11-offline-badge.png`、`ux11-badge-cleared.png`、`ux11-cold-offline.png`、`data/ux11-results.json`、`data/ux11-badge-lifecycle.json` |
| UX-12 手机编辑路径 | **已修复** | CDP 真实触摸：长按（探针 800ms；b3 用例的 450ms 临界值在回归中绿）弹底部菜单（编辑/移到分区…/删除，行高 52px）；按住横移 >8px 菜单不弹且滑动切换分区（开发→文件夹）；轻点仍新标签打开；「菜单」抽屉含「添加应用」「管理分区」（行高 48px）；编辑对话框含 b1 网址门禁（移动端内联报错同文案）；移到分区生效；删除→撤销→原位恢复；管理分区 新建/上移排序/删除（确认框「删除分区？」）全部生效；空分区添加按钮可开对话框；390×844 与 375×667 所有对话框完整落在视口内、保存按钮可见 | `ux12-*.png`（31 张）、`data/ux12a-results.json`、`data/ux12b-results.json`、`data/ux12c-results.json`、`data/ux12d-results.json` |
| UX-13 44 磁贴滚动 | **已修复（基线可复现，本次数字不劣于基线）** | 复用 b3 UX-13 用例重采：1440×900 frames 84 / p50 83.3ms / p95 100.1 / max 150.1 / 长任务 0（基线 63 / 100.1 / 216.7 / 249.9 / 0）；1280×720 frames 97 / p50 66.7 / p95 83.4 / max 150 / 0（基线 93 / 66.7 / 133.4 / 150 / 0）。headless 无 GPU，仅供对比，无阈值 | `data/perf-recheck-summary.json`、`data/perf-recheck-latest.json` |

## 仍在或新发现的问题清单（只列实测复现的）

本次复测**没有发现 P0/P1 级问题**。以下为 P2/P3 的轻微项，全部实测复现：

| 编号 | 严重度 | 分类 | 平台 | 复现步骤 | 实际表现 | 期望表现 | 截图 | 可能代码位置（只指出，未改动） |
|---|---|---|---|---|---|---|---|---|
| R-01 | P3 | 测试环境 | PC（CI/e2e） | 满负载下跑 interaction-fix 全量（1440×900，workers=1） | 4 例失败：t77 滚动阻尼、drag-settle「grid cancel (Escape) glides home」、ux-b1 UX-04、ux-b3 UX-12 drawer @375；全部在隔离重跑中通过（见回归汇总） | 全量与隔离结果一致 | `artifacts/interaction-fix/test-results/*`（trace） | 时序敏感用例（t77/t81 链、drag settle）在本机负载波动下阈值临界——已知环境模式（b3 报告已述 t77；本次新增观察：drag-settle 与 ux-b1/ux-b3 各 1 例同样只在满负载下偶发） |
| R-02 | P3 | 交互边界 | 手机 | 长按期间缓慢拖动 ≤8px 后停住 | 菜单仍会弹出（8px 内极慢拖动触发菜单）；长按期间移动 >8px 则不弹并正常切换分区（已实测）；「菜单弹出后再移动关闭」为 b3 报告声称的兜底，本次未单独复测该后半段 | 与 iOS 惯例一致，影响极小；如实记录 | `ux12-390-longpress-menu.png`、`ux12-390-swipe-no-menu.png` | `mobile/use-mobile-long-press.ts`（b3 残留风险 3） |
| R-03 | P3 | 观感 | PC | headless 截图中观察所有玻璃面（pill、dock、对话框、文件夹浮层） | 无模糊（构建 CSS 只有 `-webkit-backdrop-filter`，本机 headless shell 解析时丢弃）；实机不受影响 | —（环境限制，不计缺陷） | 所有截图 | 本机 chrome-headless-shell 1248 的 CSS 解析行为 |

没有其他新发现。原审计"测过且没问题"部分本次抽查（时钟走秒、分区胶囊点击/滚轮、键盘 Tab+焦点环、←/→ 切分区、右键菜单体系、Dock 悬停、整理模式拖拽+Ctrl+Z、设置打开关闭、1920/1280 无横向溢出、离线本地编辑）全部保持正常（见下）。

## 真实用户旅程复测（fce2e35 构建）

探测 `probes/r14-journey.mjs` + `probes/r15-journey-fixups.mjs`（v1 中 4 个步骤为探测脚本自身选择器错误，v2 修正后全部重测），1440×900 深色主路径 + 1920/1280 烟囱：

1. 首次打开→单一工作区时**直达桌面**（选择器仅在多工作区出现，与已知行为一致）→进桌面：✅
2. 时钟走秒：翻轮 reel transform 1.6s 内变化（末位 -7em→-9em）：✅
3. 分区切换（胶囊点击、悬停滚轮逐格 开发→文件夹、←/→ 切分区）：✅
4. 键盘：Tab 顺序合理（搜索框→分区→磁贴→Dock）、焦点环 2px：✅
5. 整理模式：桌面右键「整理桌面」进入、磁贴拖拽位移 262px、Ctrl+Z 原位还原（<3px）：✅
6. Dock 悬停 tooltip（「GitHub」）：✅
7. ⌘K 打开设置→Esc 关闭→桌面 color-scheme 不变：✅
8. 桌面右键菜单（添加应用/新建分区/搜索…/整理桌面/工作区›/设置…）与磁贴右键菜单（打开/编辑/编辑外观…/移到分区…/固定到程序坞/删除）内容完整：✅
9. 会话中断网：本地改名生效+离线徽标出现：✅
10. 1920×1080 / 1280×720：无横向溢出、布局无破版：✅

结果数据：`data/journey-results.json`、`data/journey-fixups.json`、`data/clock-reels.json`；截图 `journey-*.png`。

## interaction-fix 全量回归

环境：`PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright`（1248→1243 符号链接），workers=1，`reuseExistingServer: false`。**没有并行跑 vitest**（避免 CPU 争抢假失败；本次也未跑 vitest，e2e 为准）。

| 视口 | 全量结果 | 失败项 | 隔离重跑 |
|---|---|---|---|
| 1440×900 | **79 passed / 4 failed**（9.8 min） | t77 滚动阻尼；drag-settle grid cancel；ux-b1 UX-04；ux-b3 UX-12 drawer @375 | drag-settle+ux-b1 合跑 12/12 绿；t77+ux-b3 合跑 23/24（t77 再失败）；t77 单测隔离（空载）**绿**（3.9s） |
| 390×844 | **52 passed / 0 failed / 31 skipped**（5.6 min，桌面专属面按既有设计跳过） | 无 | — |

失败定性：**均为负载波动下的时序假失败，非本次引入**——t77 为 b3 报告已记载的同签名环境 flake（本次在空载隔离下通过）；其余三项在隔离重跑全部通过，且 b1/b3 报告记录了同类"满并行偶发、隔离稳定"模式。唯一保留意见：t77 在"合跑"负载下失败概率偏高（本会话 2/3 次），建议后续给该用例的 settle 容差做环境标定或加 retry。

## 测过且没有问题的部分（本次抽查）

- 时钟走秒、分区胶囊（点击/滚轮/←→、长名截断）、磁贴右键菜单全集、Dock 悬停与固定（撤销后恢复）、整理模式拖拽+Ctrl+Z、设置打开关闭不改桌面、⌘K 全状态、Esc 逐层关闭、1920/1280 无破版、浅色整档（磁贴边界/浮层/壁纸/设置预览）、减弱动态（浮层、壁纸、移动端 hold 不缩放——b3 用例在回归中绿）、手机端轻点/横滑切分区/竖向内容/抽屉/管理分区/对话框不破版、离线三态（有数据启动/冷启动/会话中）、删除撤销原位恢复、空分区双端引导。

## 因环境限制未能测试的部分（与 11-11 审计相同口径）

1. 真机与真实软键盘；2. 读屏器实际朗读（仅 DOM/ARIA 层）；3. 性能不代表真机（headless 无 GPU，UX-13 仅基线对比）；4. 24 MiB 上传临界值、非图片文件；5. 桌面拖 A 到 B 成组手势（浮层展示路径已覆盖）；6. 多标签页同步冲突。
7. **任务材料缺失**：`/home/box/shared-skills/INDEX.md` 与 impeccable skill 不存在于本机（`/home/box/` 下无 shared-skills 目录），未能按其方法校准，改为沿用原审计方法框架。

## 主观建议（推测性，非实测缺陷）

- t77 及其它时序敏感 e2e 建议引入按机器负载标定的容差或 retry=1（仅对已知环境 flake 用例），避免每次全量都需人工隔离重跑。
- 移动端长按 8px 判定与菜单弹出后的移动兜底，可在菜单弹出后把阈值降为 0（任何移动即关闭），语义更干净。
- headless CI 若需断言玻璃材质，建议统一走"构建 CSS 文本断言"（本次 UX-01 即如此），避免 computed style 全部读 none 的误导。

---
*报告生成：2026-11-12；探测脚本可重放：`PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright node artifacts/ux-recheck/probes/<probe>.mjs`（依赖 `apps/web/.next/standalone` 为 2026-11-12 fce2e35 全新构建）。*
