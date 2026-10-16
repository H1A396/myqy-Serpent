# Islands 用户反馈修订

## 需求与范围

基于 `09a1550f`，用户否定上一轮选择描边、标签筛选内部排序高亮、普通设置卡片填充与确认框布局；其余扫描结果继续有效。

| 需求 | 实现位置 | 自动化证据 | 视觉/平台证据 |
| --- | --- | --- | --- |
| 清晰选中描边 | `src/renderer/ui/islands-surfaces.css` 选中卡片规则；`ui/tokens.css` selection width | 本轮未运行测试 | 03 前后截图；文件夹生产组件，计算样式为 2px 强调色描边；资产卡片复用同一规则，未逐路截图 |
| 筛选内部排序低强调 | `ui/islands-surfaces.css` tag-management-sort | 本轮未运行测试 | 01 前后截图；生产 FilterTagPicker，虚构标签 |
| 普通面板不高亮 | `ui/islands-surfaces.css` settings/plugin/log/relink surfaces | 本轮未运行测试 | 02 前后截图；真实设置入口，普通卡片背景计算值透明；其他同类选择器未逐路截图 |
| 共用确认框紧凑布局 | `CriticalConfirmationDialog.tsx` footer；`ui/islands-surfaces.css` confirmation-dialog | 本轮未运行测试 | 04 前后截图；生产组件挂载，虚构扩展名确认提示；未覆盖完整操作旅程 |

## 实现与自查

- 选中描边使用既有 Islands 强调色及新增基础描边宽度 token，保留投影设置。
- 排序标准选项复用既有排序控件的中性 pressed wash。普通卡片保留边界与间距，背景透明；设置导航与真正选中的设置值仍有选中反馈。
- 确认按钮移入 DialogShell 的既有 footer 插槽；空内容区隐藏，footer 内按钮组不重复增加分隔线与间距。取消、默认动作和初始焦点标记沿用原实现。
- 原有扫描修正继续保留。新旧 UI 切换结论仍见独立兼容性记录，本轮不改变布局状态模型。
- 当次 `npx eslint src/renderer/CriticalConfirmationDialog.tsx`：通过，退出码 0。
- 当次 `git diff --check`：通过，退出码 0。
- 仅样式与布局调整，按本次范围未增加或运行自动化测试；没有声明功能验收通过。未执行 Windows、packaged、完整 Electron 操作回归及逐路深色主题截图。

## 截图与验收

[四组前后对照](evidence/2026-10-13-ui-refinement/index.html)。原始 PNG 尺寸与 SHA-256 见同目录 manifest。使用隐藏 Electron 实例、隔离配置和虚构空库；截图过程不使用真实资产。截图需要保留作为用户请求的交付证据，临时库与隔离应用已清理。

`ISLANDS-STYLE-01`、`ISLANDS-CONFIRM-01` 记为用户反馈未通过，修订待确认；没有自签人类验收通过。
