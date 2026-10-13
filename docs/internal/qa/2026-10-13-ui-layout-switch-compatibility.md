# 新旧 UI 切换兼容性核验

日期：2026-10-13。代码基线：`5d79b5e4`（此前 Islands 迁移提交）。状态：**当前不支持稳定的新旧 UI 切换**。本轮只核验兼容性，没有添加切换入口或修改产品源码。

## 结论

- 当前设置无 UI 布局切换项或布局偏好。`src/renderer/ui/ShellStyleScope.tsx:5` 将 APP_SHELL_LAYOUT 固定为 islands，主壳及所有新建 body portal 共用该常量。
- 旧主壳基础 CSS 仍在。手动将 main 的标记设为 legacy 后，侧栏/工作区圆角均从 Islands 圆角退回 0px，旧连续面板布局可渲染，设置可以打开。手动恢复 islands 后圆角恢复，运行错误数为 0。
- 仅修改主壳，颜色筛选 body portal 仍为 islands。即使手动把已存在的 scope 都改成 legacy，再打开形状筛选时，新建 scope 又从常量读出 islands。主题小弹窗同样固定为 islands。
- 页面完整 reload 后主壳恢复 islands。没有状态源、持久化或模式传播机制，因此 DOM 改动不能当作产品切换支持。
- 即使统一了布局标记，也不能据此宣称与旧 dev 像素一致：实验分支还有全局菜单亚克力、主题/投影等规则。它们需要逐项决定属于两套 UI 共用能力还是 Islands 专属；全局规则不应全部机械判为泄漏。

## 证据与四列可追溯

打开[截图册](evidence/2026-10-13-ui-switch/index.html)。使用后台隔离 Electron、独立 userData 和虚构空资源库；全部窗口保持隐藏，没有操作用户实例或真实库。手动 DOM 标记仅用于观察实际样式和新建 portal 行为，未修改源码。

| 需求条目 | 实现/缺口位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 有切换入口 | `AppSettingsPages.tsx` / `shell-preferences.ts` 无布局模式设置；ShellStyleScope.tsx:5 为常量 | 无产品切换路径，未运行切换套件 | 设置实际入口无该选项；源码核对 |
| 主壳可双向变换 | `App.tsx` 的 data-shell-layout；styles.css 基础 app-shell 和 Islands 覆盖 | 现场脚本读取 computed style，非持久化模式测试 | 图 01/02/07，workspace 16px → 0px → 16px |
| Portal 同步模式 | `ShellStyleScope.tsx:9` 与 createShellPortal | 现场脚本读取新建 scope 标记 | 图 03/05/06：旧 main + islands portal；不通过 |
| 重新启动保持选择 | 无布局偏好加载或持久化入口 | 完整 renderer reload，未做完整进程重启 | reload 恢复 islands；不通过，不冒充进程重启证据 |
| 模式隔离与平台 | 全局菜单/主题/投影规则需逐项归属 | 未执行全面回归 | Windows、packaged、所有控件/主题未验证 |

## 真正支持切换所需的改动

1. 建立一个受控布局模式状态及版本化偏好，主壳和全部 ShellStyleScope 都消费同一模式；切换必须即时更新已打开 portal，新建 portal 读取当前模式。
2. 在现有外观设置中加入旧 UI / Islands 选项，保持设置、caption 与确认框可用。
3. 审查新 UI 的全局样式作用范围，明确共享主题能力和布局专属外观；用旧 dev 固定提交作视觉基线。
4. 覆盖双向切换、打开弹层时切换、新建弹层、完整进程重启持久化及无效偏好回退；再检查实际主壳、筛选/排序、插件 dialog、主题小窗、确认框、查看器与明暗主题。

用户偏好问题已提出；本轮结论只报告当前支持状态，不把手动改 DOM 的能力写成已交付切换功能。

清理：隔离实例正常关闭并确认退出；本轮虚构库、userData 和临时目录已删除，保留 7 张截图。
