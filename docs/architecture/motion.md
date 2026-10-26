# 多工作区动效清单（第二轮）

所有新增 tween 均通过 `components/vd/gsap.ts` 使用 GSAP，唯一缓动为
`power2.out`，时长来自 `motion-tokens.ts`，没有增加依赖或时长档位。
手势（拖拽、缩放、吸附）不经过这些动画。

| 动效 | 触发时机 / 最终行为 | 时长档位 | reduced-motion |
| --- | --- | --- | --- |
| 1. 工作区子面板 | 指针意图延迟后、点击或键盘展开；透明度与横向 5px 位移，向左展开时反转；收起保留 inert 面板至淡出结束；最多 8 行错峰，每行间隔最多 20ms、错峰范围最多 120ms | popup 240ms；退场 hoverPress 160ms；行入场 hoverPress | 直接展示或移除，不启动 tween |
| 2. 当前状态与行工具 | 对勾保留同一 DOM，以透明度切换；悬停或键盘进入行时显示重命名/删除按钮；触屏持续显示工具 | controlState 220ms；工具 hoverPress 160ms | 对勾和工具直接落到目标透明度 |
| 3. 整屏切换与壁纸 | 旧桌面透明度下降、缩至 0.985；新桌面透明度上升、1.01 回到 1；新桌面完成绘制后启动；壁纸随两层交叉淡化，冷图片加载期间保留上一张已解析壁纸，图片可用后淡出覆盖层 | inspector 380ms（小于 sectionPage 且 ≤400ms）；冷壁纸 popup 240ms | 直接显示目标桌面和目标壁纸，不建立旧桌面或冷壁纸覆盖层 |
| 4. 首次桌面入场 | 每个工作区在本次 Home 生命周期首次绘制时播放，覆盖新增、示例及首次访问；测量分区入口和图标，仅动画视口内可见项，按上到下、左到右排序，图标从下方 8px 淡入；已有工作区切回不重播 | dialog 340ms + hoverPress 160ms 错峰，总长 ≤500ms | 不启动 tween，不测量入场图标，直接展示 |
| 5. 删除与重命名 | 消失的行保留至高度/透明度折叠完成，完成及卸载清除 height/overflow；删除当前工作区时先切至后备工作区并等待可见切换完成，再删除；桌面端行内输入淡入，保存/取消淡出，保存后的名称背景覆盖层淡出；触屏沿用重命名对话框 | 行折叠 controlState 220ms；输入 controlState 220ms / hoverPress 160ms；背景 dialog 340ms | 行直接移除，输入直接切换，名称直接更新，无闪动 |
| 6. 管理对话框与模板 | 新增、重命名、删除确认沿用共享 dialog surface；关闭保留到窗口退场完成，随后释放 presence 和恢复焦点；模板选中背景通过覆盖层透明度变化 | dialog 340ms，退出为既有 0.75 倍；模板 controlState 220ms | 同步关闭、释放 presence、恢复焦点；单选背景直接更新 |
| 7. Toast | 从下方 8px 淡入；7s 后或手动关闭时淡出并上移 4px；示例与管理反馈共享通知堆栈；消息保留各自的出入场节点，新增/移除后用独立定位槽的 transform 平滑补位 | popup 240ms（入场及堆栈补位）/ hoverPress 160ms；7s 是信息保留时间 | 同步显示/移除，仍保留 7s 阅读时间 |
| 8. 引导到桌面 | 引导卡片先用 hoverPress 淡出并上移 6px，随后新桌面入场；引导卡片初次出现和 loading 标签变化也使用 GSAP；本地创建成功后，离场按钮变为“示例工作区已就绪”并淡入，成功通知在桌面绘制后进入 | 卡片 popup 240ms；离场与 loading 标签 hoverPress 160ms；桌面 inspector 380ms | 卡片和桌面直接切换，loading 标签直接更新 |
| 9. 已有外观/设置动效 | 保留 inspector、tabContent、indicator 和分区导航的原有行为；共享 Dialog / AlertDialog 的 presence 由窗口退出完成释放，避免较短的遮罩退出提前卸载窗口；修复 reduced-motion 在子组件 layout effect 中同步释放时读取旧 open 状态的问题 | 原有档位 | 同步释放，无 tween |
| 10. 图标悬停与按下 | 复用原有 inner body 的 hover lift，桌面/快捷栏上浮 2px，按下缩至 0.98；亮度是静态 hover 样式，不 tween filter；编排模式保持手势直接响应 | hoverPress 160ms | 不位移/缩放，不启动 tween；静态亮度反馈保留 |

## 生命周期、输入与可访问性

- 仅动画 transform / opacity；删除行折叠是唯一 height 例外。名称和模板的背景变化通过覆盖层 opacity 实现，不插值背景色。
- 一次工作区切换只有一条 timeline。后一次切换先 kill 前一次；取消后的 completion 被防护，不得移除新的视觉层或修改新的 settled 标识。
- 旧桌面仅为一次 DOM 视觉快照，没有第二套 React 桌面、运行时、DnD 或监听器。快照 `inert`、`aria-hidden`、pointer-transparent，移除重复 id、菜单、对话框、portal 和 live region。
- 新桌面在过渡中保持可交互；运行时正在选择时只保留最后一个待选目标，不按动画时长锁住菜单。切换成功的 toast 使用 polite `aria-live`，中文提示“已切换到：xxx”。
- 工作区、图标入场、子菜单、输入、行折叠、toast、壁纸覆盖层和 hover 均有 kill / 清理路径；冷壁纸的 MutationObserver 随切换、偏好改变或卸载断开。
- 快照捕获和可见性测量只在 React 提交/导航边界执行，动画帧不进行 React 更新、DOM 查询或布局读取。

## 验证

`workspace-motion.test.tsx` 用 jsdom 和真实 GSAP 播放头验证终态，不依赖墙钟等待：
连续切换覆盖、过期 completion、样式清理、输入可用、可见图标/网格顺序、首次访问、行折叠、重命名、子菜单翻转/退场、toast 7s 生命周期与堆栈补位、冷壁纸、引导成功按钮、reduced-motion 和卸载。
既有对话框、子菜单、外观、设置、分区、移动端与工作区管理测试继续运行。

### 本轮执行结果（2026-10-26）

- `pnpm typecheck`：13 个包全部通过。
- `pnpm test:run`：2631 通过、10 失败、1 个既有平台条件跳过；未删除或跳过任何现有测试。
- 失败中的响应式桌面用例是 TASK.md 注明的 5s 超时；将其与本轮动效、管理、引导测试重跑，6 个文件、49 项全部通过。
- 剩余 9 项失败来自既有 `release-version.test.mjs` / `verify-release-archive.test.mjs` 工具测试，与上一轮基线一致：Node 子进程无输出、归档解包报告 `spawnSync tar EPERM`；单独重跑仍复现。全绿验收因此为 **BLOCKED（沙盒子进程限制）**，未改工具脚本、测试跳过条件或部署配置。
- 删除行开始折叠前取消其尚未结束的列表入场，避免两个 tween 同时写行透明度；有中断测试覆盖。
- 本轮只进行了 jsdom 验证，没有启动监听端口；实际视觉和 100+ 图标的帧率验收由用户完成。
