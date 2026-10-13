# 外观设置：新旧 UI 切换

## 产品决定

用户授权在外观中切换新旧 UI，默认新 UI；接受少数不兼容界面。此实现替代先前兼容性记录中“没有切换入口、重启固定 Islands”的结论；旧版本取证仍有效。

## 实现与复用

- `src/renderer/shell-layout-preferences.ts`：应用级 localStorage 偏好；缺失、无效、读失败回到 Islands，新建安装默认新 UI。写失败时本次会话继续切换，无法保证重启保存。
- `src/renderer/ui/use-shell-layout.ts`：统一外部状态订阅，主壳与独立 React Root 弹层均实时同步；同源窗口 storage 更新也同步。
- `App.tsx` 与 `ui/ShellStyleScope.tsx`：同一 hook 决定 data-shell-layout。
- `AppSettingsPages.tsx`：复用 SettingsCard、已有 radio 选项组和中英文目录；外观顶部为“界面样式 / 新 UI / 旧 UI”。
- 旧 UI 复用现存基础 CSS，并非回退到 dev 的完整历史代码。共用确认框、主题小弹窗和少数已迁移组件保留当前实现，属于用户允许的兼容差异。

| 需求 | 实现位置 | 自动化测试 | 实际证据 |
| --- | --- | --- | --- |
| 默认新 UI、外观选择 | preferences + AppearanceSettingsPage | 未增加/运行 | 隐藏 Electron 真实入口，新配置默认为 islands，点击旧 UI 后 legacy |
| 保存选择并重启恢复 | load/saveShellLayout | 未增加/运行 | 完整 app.close 后以同一隔离 userData 重新 launch，主壳为 legacy |
| 主壳与弹层同步 | useShellLayout + ShellStyleScope | 未增加/运行 | 标签弹层 scope 先为 legacy，切回新 UI 后为 islands；四张截图 |

[设置与弹层截图](evidence/2026-10-13-ui-layout-choice/index.html)。未使用真实资产或资源库。截图保留交付，隔离库、配置和本轮应用均清理。

## 当次检查与限制

- `npx eslint` 对本次 renderer 变更：0 errors，App.tsx 原有两项 hook warning。
- `npx tsc --noEmit`：退出 2；原有 linux-window-resize 六处 minW/minH 错误及 islands-accent-budget 测试一处可能 undefined；本轮文件无新增错误。
- `git diff --check`：通过。
- 本轮未增加或运行自动化测试；后台实际操作已覆盖双向切换、弹层同步与完整重启持久化。未验证 Windows、packaged、所有弹层及存储不可用场景。人类验收由用户决定。
- 小规模 renderer 偏好接入由实现者自查，无新增进程协议、资源库数据逻辑或行为迁移。
