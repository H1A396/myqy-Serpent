# 外观开关与主题颜色绑定

基线：`a5a5472c`。用户要求新旧 UI 改为主题标题右侧的 toggle，自定义主题色不得带到其他主题，修改与主题绑定。

## 根因与修复

原 ThemeProvider 将所有主题叠加同一份 custom-theme 覆盖层，快速主题色也由全局 theme-accent 提供；选择 preset/user theme 未切换这些状态。现在新增按 preset ID / user theme ID 分开的颜色草稿；明暗模式仍共享主题身份，颜色分别保存在 light/dark 子项。快速强调色也绑定同一身份。

- `AppSettingsPages.tsx`：复用 Switch，在主题标题行、ThemeModePicker 左侧显示“新 UI”。开为新 UI，关为旧 UI。
- `theme-color-drafts.ts`：复用 customThemeSchema 校验，按主题保存覆盖层与快速色；限定字段、条数和读取大小。命名主题快照将快速色纳入其 light/dark 可携带颜色。
- `ThemeProvider.tsx`：按当前身份派生 overlay/accent，切换立即切换草稿；新建、保存和删除命名主题同步处理颜色。旧全局颜色只迁到首次载入时的当前主题，新格式存在后不再跨主题读取旧值。存储不可写时会话可用，重启保存未保证。
- `ui/islands-surfaces.css`：复用主题 token 与布局间距，开关组适用于两种布局。

| 需求 | 实现位置 | 自动化测试 | 实际/平台证据 |
| --- | --- | --- | --- |
| 新 UI toggle 位置与双向选择 | AppSettingsPages + Switch + shared layout CSS | 本轮未增加/运行 | macOS 隐藏 Electron 实际操作：关闭→legacy，打开→islands；01 截图 |
| 自定义颜色不跨主题 | ThemeProvider + theme-color-drafts | 本轮未增加/运行 | Serpent 强调色/文字为核对值；切 VS Code 得到其自身值；切回恢复；02/03 截图 |
| 快速色与重启持久化 | 同上 | 本轮未增加/运行 | Serpent 快速紫色不影响 VS Code；完整 app.close/重新 launch 后，Serpent 快速色和文字修改均生效 |
| 命名主题创建/保存/删除与旧偏好迁移 | 同上 | 本轮未增加/运行 | 实现者静态核对；本轮未逐路实际操作，不宣称已验证 |

## 当次证据

[位置与主题切换截图](evidence/2026-10-13-theme-color-binding/index.html)。在隔离配置和虚构库内，通过实际设置入口修改并切换。过程遇到开发页导航等待，重新载入后完成操作；未据超时得出应用功能通过结论。临时配置、库和本轮进程已清理；交付截图按用户此前要求保留。

- `npx eslint` 对三个变更 TS/TSX 文件：退出 0，无错误。
- `npx tsc --noEmit`：退出 2，仍为 linux-window-resize 六处及 islands-accent-budget 一处原有错误，无本轮文件错误。后续颜色快照 helper 由 ESLint 静态核对，本轮未重跑全仓类型检查。
- `git diff --check`：通过。
- 未增加/运行自动化测试；没有全套回归、Windows 或 packaged 证据。用户尚未验收；本轮是小规模设置接入和偏好隔离修复，由实现者自查。

验收清单更新 `UI-LAYOUT-01` 的入口与检查方式，并新增 `THEME-COLOR-BOUND-01`（自动化证据不足）。
