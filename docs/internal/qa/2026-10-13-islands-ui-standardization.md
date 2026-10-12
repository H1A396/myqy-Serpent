# Islands UI 标准化：实现与截图核验

日期：2026-10-13。分支：`ui-concept-a`。基线：a94 `33f29c65c88df0631a1fb49aecf4e839ee0ff50a`。状态：19 组扫描项已落地，24 组画面对照；自动化证据不足，未标记 accepted 或人类验收通过。

## 前后截图

打开 [逐项对照册](evidence/2026-10-13-islands-ui/index.html)。[图片清单和 SHA-256](evidence/2026-10-13-islands-ui/manifest.json)记录原尺寸和基线。扫描说明见[审计报告](../reviews/2026-10-13-islands-ui-legacy-style-audit.md)。

- 修改前原始截图在产品改动前采集；插件对话框原图仍在淡入阶段，另补 a94 CSS 重放图。插件 Host 外框补图分配实际容器尺寸，并重放 a94 CSS；这些图明确标注为重放，不冒充历史源码实例。原图全部保留。
- 主壳、文件夹、通用设置、标签管理、改扩展名确认、主题小弹窗来自隔离 Electron 的真实入口。罕见插件/任务/进度/重新链接/3D/AI 控件通过真实 React 组件和虚构 props 挂载，验证 Host 外观，不证明完整后端旅程。插件 iframe 停留加载态，不包含第三方页面。
- 修改前多数 PNG 为 1440×900，修改后多数为 1400×900；设置均为 900×700；原生确认和桌面截图为 1382×768。未通过拉伸覆盖原图。
- 修改前原生 HTML tooltip 未被 PNG 捕获；修改后标准提示明确显示。两张 tooltip 图的背景选择状态不同，不能用其比较资产选择样式。
- 所有库名、文件名、资产内容、插件、任务与日志均为专门生成的虚构样例。未读取或截图用户资源库。

## 复用方案与范围

`ShellStyleScope` 使用同一 Islands 标记及既有级联，`display: contents` 不添加布局盒或 stacking context；避免把主题派生公式复制到第二套实现。Body portal 继承当前主题、圆角、投影及亚克力。对话框内菜单在测量时识别 trigger 所在 dialog，仅该菜单绕过背景 pointer lock，并在 backdrop 700 层按 DOM 顺序显示；caption 701 保持上层。

共享补充 CSS 使用主题 token 和现有类。文件夹保留口袋插画；标签管理保持管理控件语义；危险按钮保留危险语义。导入进度、冲突/失败决定框和拖放专属视觉按源码明确的暂留边界保留，其需要的 tooltip 仍统一。

10 处同步系统确认迁移到 renderer 受控异步确认：复用 CriticalConfirmationDialog/DialogShell；单活动请求，重复请求、取消、Escape、Host 卸载均返回 false；绑定旧库的操作在库身份变化时取消。Main critical 与 local 确认互斥；await 后检查资源库或编辑 session，避免执行过期动作。库切换 helper 的 7 个调用者同步改为 await。仅明确目的库的 opening pipeline 使用 scopeBound=false，第一笔切换完成后仍保留第二笔选择并进入既有 transition lock 队列；关闭、删除等旧库操作继续绑定身份。该排队边界仅代码复核，未运行竞态自动化。无跨进程协议、数据库或 worker 服务改动。

## 四列可追溯

实现位置为本次工作树行号；审计报告里的位置固定为 a94，不混用。截图为代表状态，不代表该项所有业务入口或平台通过。

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 01 文件夹卡片 | `src/renderer/ui/islands-surfaces.css:39` | 无自动化视觉用例 | 对照册 01；macOS 开发态样例，用户未验收 |
| 02 筛选/排序 portal | `src/renderer/PortaledPopover.tsx:52` | 未运行筛选/排序 E2E | 对照册 02；macOS 开发态样例，用户未验收 |
| 03 插件对话框 | `src/renderer/plugin-ui-dialog-host.tsx:8` | 未运行插件 E2E | 对照册 03；macOS 开发态样例，用户未验收 |
| 04 非导入进度 | `src/renderer/BlockingProgressOverlay.tsx:2` | 未运行进度 E2E | 对照册 04；macOS 开发态样例，用户未验收 |
| 05 信任提示 | `src/renderer/ui/islands-surfaces.css:63` | 未运行插件 E2E | 对照册 05；macOS 开发态样例，用户未验收 |
| 06 3D 子控件 | `src/renderer/3d-viewer/viewer-surface.css:43` | 未运行 3D E2E | 对照册 06；macOS 开发态样例，用户未验收 |
| 07 设置导航/卡片 | `src/renderer/ui/islands-surfaces.css:59` | 未运行设置 E2E | 对照册 07；macOS 开发态样例，用户未验收 |
| 08 社区详情/README | `src/renderer/ui/islands-surfaces.css:59` | README 样式共用；其业务路径未截图 | 对照册 08；macOS 开发态样例，用户未验收 |
| 09 插件 Host 外框 | `src/renderer/ui/islands-surfaces.css:59` | 未运行插件生命周期 E2E | 对照册 09；macOS 开发态样例，用户未验收 |
| 10 插件 tabs/toggle | `src/renderer/ui/islands-surfaces.css:98` | 未运行 widget 单测 | 对照册 10；macOS 开发态样例，用户未验收 |
| 11 通用 primary | `src/renderer/ui/islands-surfaces.css:15` | 无自动化视觉用例 | 对照册 11；macOS 开发态样例，用户未验收 |
| 12 管理标签 | `src/renderer/ui/islands-surfaces.css:110` | 未运行标签 E2E | 对照册 12；macOS 开发态样例，用户未验收 |
| 13 任务列表 | `src/renderer/MediaJobsDialog.tsx:150` | 未运行任务 E2E | 对照册 13；macOS 开发态样例，用户未验收 |
| 14 诊断日志 | `src/renderer/ui/islands-surfaces.css:59` | 未运行日志 E2E | 对照册 14；macOS 开发态样例，用户未验收 |
| 15 重新链接 | `src/renderer/ui/islands-surfaces.css:127` | 未运行重新链接 E2E | 对照册 15；macOS 开发态样例，用户未验收 |
| 16 AI/HDRI 菜单 | `src/renderer/AiConfigDialog.tsx:495` | 截图现场检查，非自动化套件 | 对照册 16；macOS 开发态样例，用户未验收 |
| 17 悬停提示 | `src/renderer/LibrarySwitcher.tsx:218` | 未运行 HoverTip 自动化用例 | 对照册 17；macOS 开发态样例，用户未验收 |
| 18 10 处确认 | `src/renderer/local-confirmation.tsx:26` | 已有 unit/E2E 已同步断言，未执行 | 对照册 18；macOS 开发态样例，用户未验收 |
| 19 主题小弹窗 | `src/renderer/theme/ThemeMiniDialog.tsx:60` | 截图现场检查，非自动化套件 | 对照册 19；macOS 开发态样例，用户未验收 |

## 现场核对与独立复核

- 使用本地开发服务器和隔离 userData 启动 Electron；所有可见操作限于虚构库。未启动第二个开发服务器或终止用户实例。
- 文件夹卡 computed border 为 0.5px；选择态使用 1px 选择 token，投影跟随现有 card shadow。
- 主题小窗 backdrop computed z-index 700、blur 4px。通过 Computer Use 点击“取消”，主题小窗关闭、设置仍保留；Escape 同样仅关闭最上层。桌面证据：[截图](evidence/2026-10-13-islands-ui/19-theme-modal-desktop-after.png)。
- 扩展名确认的取消和 Escape 保留编辑中的文件名，不执行重命名；确认执行后图片 complete 且 naturalWidth=512（缩略图）非零，随后按同一确认流程恢复样例名。
- 开启 `serpent-modal-open` 的现场状态下，AI menu computed z-index 700、pointer-events auto、blur 18px，elementFromPoint 命中菜单；点击第二个样例模型后菜单关闭。
- 完整 reload 后 renderer 运行错误数 0。修改 hook 时曾产生 HMR 的 hook 顺序警告，重载后不再出现；这些过程警告不冒充最终错误或测试结果。
- 一个 `gpt-6-luna` 独立做 Standards/Spec 复核；发现 modal 菜单可能低于 scrim 后修正，再复核无阻断。确认生命周期、caption 层级、portal 范围和 tooltip 可访问名称均复核；agent 未运行测试。

## 命令与限制

- `git diff --check`：通过。
- 修改文件 ESLint：无新增错误；App 两条 hooks dependency warning 位于未改动代码；ThemeMiniDialog refs during render 已移到 layout effect，相关定向 ESLint 通过。
- `npm run typecheck`：退出 2。未改动的 `src/main/linux-window-resize.ts` 有 6 处 minW/minH undefined 类型错误；未改动的 `tests/unit/islands-accent-budget.test.ts:17` 有 1 处 undefined 类型错误。本次修改未新增 renderer 类型错误；extension typecheck 因前置失败未执行。
- 更新既有 `sidebar-commands` 单测，以及插件管理、可信 Host、移除链接文件夹、资源库切换基准 E2E 的确认断言；未新增测试。
- 本轮用户要求截图，未要求运行自动化测试；依更高优先级指令，没有执行 unit/worker/E2E/library-availability/verify:mainline。异步确认和库切换相关回归仍缺自动化证据，不能据截图宣告功能全覆盖。Windows、打包版、所有亮暗主题/圆角档位未验证。
- 会话期间基线从 a93 进入 a94，已补扫新主题小弹窗并纳入实现。最后修改期间 HEAD 仍为 a94；未切分支、reset、stash 或建立 worktree；外来临时目录未触碰。

- 隐私扫描：扫描 2707 个被跟踪文件及本次新增文本，家目录/盘符/UNC/凭据模式相对 a94 的新增命中为 0；既有树中的路径模式命中仍含规则示例、fixture 与平台路径，未把粗模式扫描写成全仓隐私验收通过。52 张 PNG 均为虚构样例。
- 对照册检查：24 个 section、48 张对照图片全部完成加载，缺图 0。

- 最终自查保留原有切库排队语义：确认 helper 默认校验库身份；只有明确目的库的 opening pipeline 保留选择，调用者原有 transition lock/队列逻辑不被统一确认入口改写。

- 清理：对照册导航替换了隔离实例的 renderer，关闭回调等待未结束；正常 quit/TERM 未退出后，仅强制结束本次独占进程树。确认退出后删除本次 userData、虚构库、媒体和夹具目录；保留截图证据，未停止用户实例或开发服务器。
