# Islands a94 UI 遗留样式扫描

日期：2026-10-13。状态：静态扫描完成；19 组已实施；24 组前后画面对照已归档。自动化证据不足，未 accepted。详见[实现与截图核验](../qa/2026-10-13-islands-ui-standardization.md)。

## 范围与判断口径

合并去重后共 **19 组残留/混合迁移/待确认项**，另列一批源码明确有意暂留的导入/拖放 UI。优先关注 portal 视觉契约、Tooltip 双源、无效变量、固定圆角与 a94 新 modal 的层级；不是把 19 组全部定性为视觉 bug。

- 当前实验分支：`ui-concept-a`，最终审计 HEAD `33f29c65c88df0631a1fb49aecf4e839ee0ff50a`（a94）。初扫固定于 a93 `21140d720264d9b1b79623d4f616fa4850e44aba`，随后对会话期间出现的 a94 增量再次派 Luna 复核。
- 旧 UI 对照：`origin/dev`，`6a9f84495e1b40d7cc28e345d2b9a8b1c085f632`。使用 `git show` / `git diff` 对照，没有切换分支。
- 先由一个 `gpt-6-luna` 梳理标准，再由三个 `gpt-6-luna` 分区扫描：主壳/浏览/Inspector/菜单；设置/主题/插件；弹窗/进度/查看器。主 agent 核对 DOM 边界、CSS 加载顺序、关键属性与重复发现；另补扫悬停提示和原生确认框。
- 文件库存覆盖 `src/renderer/` 的 **158 个 TSX + 7 个 CSS，共 165 个文件**；相关主题配置、圆角偏好、命令和 hooks 同时追踪。覆盖清单在文末。
- 以下发现为固定 a94 源码的迁移审计；随后已实施并做截图/计算样式核验，过程及范围见上述 QA。审计阶段未执行自动化测试。**“确认残留”指旧规则仍会命中/新规则不会命中的静态事实，不代表已确认视觉缺陷，也不代表所有状态经过人眼验收。**
- “混合/待设计确认”指仍使用 dev 的专属视觉，但不同用途可能允许不同外观。不能把所有 1px 边框、原生 HTML 标签、legacy token 或未改动文件都判为违规。
- 浏览器扩展、官网、开发原型及插件 iframe 自有页面不属于资源库桌面 Host UI 范围。插件由 Host 绘制的外框、菜单、字段和对话框在范围内。

## 当前实验标准

新标准的主要实现是 `styles.css:15406` 后的 Islands 覆盖和后续 a18–a94 的级联。不能仅看最初一段或把 dev 已有的 UI primitives 当作这次迁移的证据。

| 标准 | 当前有效证据 | 扫描时的影响 |
| --- | --- | --- |
| 三个浮岛及主题派生表面 | `App.tsx:12970`；`styles.css:15957`、`15999`、`17593`、`17972`、`18131` | 主壳有 `data-shell-layout="islands"`；最新自定义主题和壁纸还会改变表面 |
| 最新间距 | `styles.css:17336` | 外侧 3px、岛间 6px；最初的 12px 已被覆盖 |
| 轻边线和选择态 | `styles.css:17073`、`17228` | Islands hairline 0.5px；资产卡选择环为 1px accent；不把更早的 2px 声明作为终态 |
| 普通主次操作 | `styles.css:16643`、`17132` | 壳内普通主按钮 ink 填充、次按钮透明；create-dialog 控件按 8px × radius scale 收紧 |
| 标签轮廓 | `styles.css:16897`、`17468`、`18108` | a82 标签形状与 a93 圆角档位；不是 dev 圆形胶囊 |
| 圆角/阴影设置 | `radius-preferences.ts:138`；`styles.css:17409`、`17605` | 业务控件应消费圆角 token/scale；资产卡阴影跟随 elevation |
| 菜单亚克力 | `styles.css:18032` | a91 用全局选择器覆盖通用菜单，支持 body portal；不能因 portal 就把这些菜单误报 |
| 查看器专用浮层 | `styles.css:15213` | 已有共享 viewer chrome，媒体上需要独立可读性；不能要求它与主工具栏完全相同 |

加载顺序见 `main.tsx:35`：`styles.css` → `ui/tokens.css` → `ui/ui.css`。例如 `.ui-popover-surface` 的背景、阴影和基础边框由后加载的 `ui/ui.css:606` 提供，不能误写成 `styles.css:883` 的旧 pane 背景/旧阴影。

所有证据位置以下均相对 `src/renderer/`。

## 确认仍使用旧规则的入口

### UI-AUDIT-01：文件夹卡片

- **入口**：普通浏览、搜索结果里的文件夹卡片。`FolderCard.tsx:59` 输出 `CardSurface.folder-card`，浏览挂载见 `App.tsx:13919`；共享 CardSurface 只建立盒模型，不替换业务皮肤。
- **残留**：`styles.css:14941` 的完整 1px divider-soft 边框、raised/canvas 混合底色；`14953` 的选中态是 6% accent 填充加 1.5px 光环。Islands 后段只适配 `.asset-card`，没有 `.folder-card` 的对应覆盖。
- **新旧差别**：同一画布中的资产卡已有 Islands 边线、1px 选择边框和 elevation；文件夹卡还保持 dev 的选择光环与表面。
- **建议**：统一外框、选择态、焦点与阴影变量；保留文件夹口袋插画和语义，不能把文件夹直接改成图片卡。规则残留置信度高；插画自身不是问题。

### UI-AUDIT-02：筛选/排序弹层的 Islands 覆盖失效

- **根因**：`PortaledPopover.tsx:90` 将 PopoverSurface 挂到 `document.body`。`.app-shell[data-shell-layout="islands"]` 下的规则不匹配；`--island-*` 也定义在 shell 上，不能假定 body portal 已继承。
- **全部入口**：`DimensionFilterBar.tsx:692`、`724`、`774`、`834`、`902`、`1042` 六处筛选弹层，以及 `SortModeControl.tsx:223` 的排序弹层。
- **标签**：`FilterTagPicker.tsx:118` 的 `.filter-tag-chip.is-selected` 仍使用 dev 胶囊/选中态（`styles.css:2451`）；a82 轮廓 `17468`、a93 档位 `18108` 和 Islands 选中态 `17030` 都不能命中。Inspector 标签已迁移，过滤标签与它出现两套轮廓。
- **排序选中项**：`styles.css:1058` 的 accent-soft 仍生效；a75 的中性 pressed-wash 覆盖 `17164` 不匹配。
- **弹层/预设边线**：a72 对 `.dimension-filter-popover` 和 `.filter-preset-chip:not(.is-active)` 的轻边线覆盖 `17098` 不匹配。最终弹层背景/阴影仍由共享 PopoverSurface 提供，**不是整个弹层未标准化**。
- **颜色确认按钮**：颜色弹层 → `ColorFilterPopover.tsx:182` → `ColorDraftPicker.tsx:183`，还存在 UI-AUDIT-11 的 primary 类分叉。
- **建议**：复用 PortaledPopover 的统一视觉 variant，并向 portal 传递 Islands 标记及所需语义变量。不要只移除祖先条件而留下未定义的 island 变量，也不要把弹层挪回会裁剪它的容器。置信度高。

### UI-AUDIT-03：插件对话框的主次按钮

- **入口**：插件 widget 对话框与 iframe 对话框的 Host footer。`plugin-ui-dialog-host.tsx:193`、`280`。
- **边界**：Host 在 `App.tsx:12842`，位于 Islands main 之前；`plugin-ui-dialog-host.tsx:113` 又明确 portal 到 body。
- **残留**：两个 footer 的 `.primary-button` / `.secondary-button` 仍走全局 dev 样式（`styles.css:3898`、`15111`）：accent 主按钮、raised 次按钮，6px × scale 基础圆角。shell 的 ink 主按钮/透明次按钮 `16643` 及 create-dialog 8px 圆角 `17132` 均不匹配。
- **建议**：让 Host 对话框复用同一主次动作 variant；保持 iframe 以及插件业务内容的边界。不能因 DialogShell 已复用，就把 footer 当作已经迁移。置信度高。

### UI-AUDIT-04：打开/导入/删除/导出进度遮罩的按钮

- **入口**：`App.tsx:12845` 资源库加载、`12865` 导入、`12934` 删除、`12945` 导出；由 `BlockingProgressOverlay` 统一绘制。
- **残留**：`BlockingProgressOverlay.tsx:48`、`61` 的停止/取消按钮在 main 外，保留全局 raised 次按钮皮肤，没有壳内透明次按钮覆盖。
- **已经统一的部分**：DialogShell、Progress、进度结构及主题 token 都已共享。库身份切换的 `solidBackdrop` 是功能安全边界，不是样式漏改。
- **建议**：在共享 BlockingProgressOverlay 上统一动作样式，一次覆盖四种进度。导入相关仍受“Import/drop 暂留”说明约束，需先确认统一范围；不改变遮罩遮蔽旧库的语义。静态分叉置信度高，是否需要改外观待设计确认。

### UI-AUDIT-05：插件信任列表引用未定义的旧表面变量

- **入口**：`PluginTrustPromptDialog.tsx:49` 的信任源列表。
- **残留**：`styles.css:9832` 的 `.plugin-trust-prompt-list li` 使用固定 `0.5rem` 圆角；`9838` 背景引用 `var(--surface-elevated, var(--surface))`。这两个变量在 `src/` 中只有该处使用，没有定义，所以背景声明无效。
- **校正**：其中 `--border` **有定义**（`styles.css:93`、`212`，是 divider 别名），不能把三个变量都写成未定义。
- **建议**：改用共享 surface/radius token；保留权限与可信运行模式的语义强调。无效变量事实置信度高；实际可读性未做桌面核验。

### UI-AUDIT-06：3D 查看器子控件的固定圆角

- **入口**：3D 工具项、select、工具按钮、统计面板、状态动作、HDRI 触发器/缩略图/选项。
- **残留**：`3d-viewer/viewer-surface.css:58`、`79`、`103`、`128`、`204`、`242`、`270`、`304` 分别使用固定 7/6/7/10/8/6/5/4px，没有 radius token/scale；该 CSS 与 origin/dev 相同。
- **影响**：设置圆角档位时，这些子控件无法跟随 `radius-preferences.ts:138` 的统一变化。最外层 toolbar 有共享 viewer chrome 覆盖，不把它直接当作固定 10px 的最终计算样式。
- **建议**：统一子控件圆角 token，保持媒体画面及 3D 专用交互。固定半径置信度高；亮暗/档位下的实际观感未核验。

### UI-AUDIT-16：AI 模型列表与 HDRI 列表漏出 a91 菜单集合

- **入口**：`AiConfigDialog.tsx:490` 的 `.ai-config-model-picker-menu`；`3d-viewer/viewer-toolbar.tsx:97` 的 `.model-viewer-hdri-picker`。两者都 portal 到 body。
- **残留**：模型列表在 `styles.css:7466` 保留 pane 底色、1px divider、shadow-menu；HDRI 列表在 `3d-viewer/viewer-surface.css:274` 保留 raised 底色、固定阴影与圆角。都没有通用 `.ui-menu-surface` 类，也不在 `styles.css:18037` 的 a91 选择器集合中。
- **影响**：统一菜单亚克力设置不会统一这两个 Host 自绘 listbox，和常规菜单表现不同。
- **建议**：确认 listbox 是否纳入菜单亚克力，再复用共享 surface/列表控件。不能把“是 listbox”自动等同于“必需亚克力”；也不能写“所有菜单已迁移”。覆盖缺失置信度高，产品意图待确认；HDRI 固定圆角与 UI-AUDIT-06 同源，不重复计算子问题。

## 混合迁移与设计待确认

以下是仍保留 dev 专属样式的可达区域。没有明确的新视觉例外规范，因此保留完整清单；不将它们直接定性为功能 bug。

| ID | 用户入口/范围 | 仍生效的旧样式及证据 | 建议统一点/边界 |
| --- | --- | --- | --- |
| UI-AUDIT-07 | 应用设置导航与卡片；资源库设置各页 | `AppSettingsNavigation.tsx:61`；`LibrarySettingsDialog.tsx:403`；导航和卡片 `styles.css:7946`、`14856`、`14870`、`14892`。保留 accent 选中、完整 1px 分隔和 raised/pane 卡片；`:not(.library-settings-dialog)` 又让两套设置 polish 不一致 | 先明确设置页是否跟随 Islands 的中性导航、hairline、soft surfaces，再共享导航/card variant。主次按钮及 text-field 已有 Islands 覆盖，不报整页未迁移 |
| UI-AUDIT-08 | 设置 → 插件 → 社区列表、详情、README Host 容器 | `PluginCommunityDetailPage.tsx:98`；`styles.css:8355` 卡片保持旧混色底与完整边框；`8517`、`8588` README/表格 chrome 继续旧 divider/raised 样式 | 统一 Host 卡片与阅读容器；插件 README 的内容、强调和代码样式有独立用途 |
| UI-AUDIT-09 | 插件 workspace、Inspector 外框与动作、viewer overlay 展开面板 | `plugin-workspace-views.tsx:75`、`plugin-inspector-views.tsx:76`、`plugin-inspector-sections.tsx:128`、`plugin-viewer-overlays.tsx:91`；`styles.css:6227`、`6254`、`6312`、`6346` 保留 1px divider，展开面板有独立 18% 黑色阴影/blur | 外框改用统一 surface/hairline；浮层复用 popover/viewer chrome。iframe 内容不归 Host 统一；透明填满布局是有意的 |
| UI-AUDIT-10 | 插件 widget tabs 与 toggle；GitignorePreviewPanel 的同类控件 | `plugin-widget-renderer.tsx:196`、`319`；`styles.css:14314` accent 下划线 tabs；`14433` toggle 保留 raised 背景及固定 `0.35rem` 圆角 | 复用统一的 tabs/toggle 状态和圆角；不能只因为 select/Switch 已复用 primitive，就认整个 renderer 已统一。固定圆角事实明确，tabs 差异需要设计确认 |
| UI-AUDIT-11 | 外观 → 保存为主题/命名确认；颜色筛选 → 确认 | `theme/ThemeColorSettings.tsx:245`、`theme/ThemeMiniDialog.tsx:82` 与 `ColorDraftPicker.tsx:183` 使用 `Button variant="primary"` → `.ui-button--primary`；`ui/ui.css:62` 保留 accent fill。Islands `styles.css:16643` 只选择 `.primary-button` | 共用 UI Button 与旧业务按钮存在两套 primary 契约。显式 primary 可能是有意强调，应先定例外/variant，再统一；颜色弹层还有 UI-AUDIT-02 的祖先问题 |
| UI-AUDIT-12 | 侧栏 → 标签管理 → 标签选择 | `NavigationSidebar.tsx:2458`；`App.tsx:13906`；`styles.css:3590` 的 `.tag-management-chip` 保留 pane 背景、999px 胶囊、9% accent 填充和 2px 选择光环 | 大点击区域可保留；确认管理标签是否沿用 a82 的标签轮廓和统一选中态。管理 chip 与资产 tag 用途不同，不直接强制同尺寸 |
| UI-AUDIT-13 | 后台任务面板：媒体/AI/插件队列 | `MediaJobsDialog.tsx:149`、`220`、`360` 等内联 1px `var(--border)` 分隔、独立行距/grid；Islands 没有内容行覆盖 | 如需统一，抽任务列表行样式，复用分隔/间距。`--border` 已定义，不是无效颜色；密集队列有理由保留强分隔 |
| UI-AUDIT-14 | 应用日志列表 | `AppLogDialog.tsx:119`；`styles.css:6783`、`6791` 保留 1px divider、raised/pane 70/30 背景及旧行分隔 | 统一列表容器和普通行的 surface/hairline；错误行强调应保留语义 |
| UI-AUDIT-15 | 重新链接预览的统计与样本面板 | `RelinkPreview.tsx:61`；`styles.css:13370`、`13440` 保留旧 conflict-summary/examples 的 divider-soft、pane 表面及 4/8px × scale 圆角 | 确认是否复用 soft summary/read-only list variant；不能和“导入冲突有意暂留”混为一个结论 |

## 通用 UI 规范的补扫

### UI-AUDIT-17：原生 title 悬停提示与标准 Tooltip 混用

这项有明确的仓库标准，不只是 Islands 视觉意图的推断：`icon-action-attrs.ts:1` 说明 icon-only 控件应输出 `aria-label` + `data-hover-tip`，省略会与自定义提示冲突的原生 title；`Tooltip` 和 `HoverTipHost` 已提供统一延迟、主题与 portal。

下表列的是最终落到 DOM 的原生 title，或经组件 rest props 透传到 DOM 的 title。DialogShell/SettingsCard/Activity 的标题和 iframe 的可访问名称已排除。

| 文件与当前行 | 用户入口/对象 | 分类 |
| --- | --- | --- |
| `NavigationSidebar.tsx:192` | NavRow button 的 hoverTitle；覆盖普通导航和链接目录的状态/路径提示（调用处 `1923`） | 原生提示；NavRow 没有转成 data-hover-tip |
| `context-menu.tsx:630` | 禁用菜单项的 disabledReason | 原生提示；禁用原因需统一处理 |
| `LibrarySwitcher.tsx:249`、`356` | 移除资源库按钮、当前库 trigger | 原生提示 |
| `LibrarySwitcher.tsx:318` | 忘记最近资源库按钮 | **同时有 title 和 iconActionAttrs 的 data-hover-tip，两套提示源** |
| `FolderCard.tsx:74`、`167` | 文件夹卡片 button 和名称 strong | 两处原生完整名称提示 |
| `App.tsx:14223`、`14358`、`14371`、`14394`、`14523` | 缩略图失败、来源/回收站/缺失状态、截断文件名 | 状态说明和截断全文提示 |
| `BrowseLayoutPreview.tsx:42` | 浏览布局示例文件名 | 原生提示 |
| `InspectorPanel.tsx:568`、`1248`、`1309`、`1458`、`1492`、`1558`、`1589`、`1706` | 完整文件名、AI 标记、加标签、混合评分/喜欢、色卡、来源按钮 | 原生提示；色卡 role=button 还需补语义名 |
| `DimensionFilterBar.tsx:208`、`1213` | 维度按钮说明、清除筛选 chip | 原生提示 |
| `FilterTagPicker.tsx:124`、`136`、`163` | 移除标签、标签输入框、排序方向 | 原生提示 |
| `TagPickerMenu.tsx:230` | 标签菜单的 icon-only 按钮 | 原生提示 |
| `SearchHistoryPopover.tsx:46` | 完整历史查询 | 截断/重复文本提示 |
| `TagManagementWorkspace.tsx:271`、`392` | 排序方向、打开标签提示 | 原生提示 |
| `McpSettingsPage.tsx:46`、`317`、`327` | 名称编辑、复制/撤销凭据 | 原生提示；名称编辑的提示还为固定中文 |
| `PluginSettingsPage.tsx:922`、`925`、`930` | 安装 scope select/option 的作用域说明和禁用原因 | 原生 select/option 提示；跨平台展示需核验 |
| `plugin-host-settings-fields.tsx:199`、`224`、`256`、`289`、`321` | Switch/Select/字段 description | **withDescriptionTooltip (`160`) 包 Tooltip，子控件仍保留 title，重复提示源** |
| `plugin-widget-renderer.tsx:164` | 表格单元格全文 | 原生提示 |
| `PluginJobActivityBanner.tsx:63`、`77` | owner/handler 和错误详情 | 原生提示；Activity 自身 title 是可见标题，不计 |
| `AiConfigDialog.tsx:352`、`477` | 连接原因、模型选择 trigger | 原生提示 |
| `theme/ThemeAppearanceControls.tsx:167`、`193`、`206`、`274`、`312`；`theme/ThemeColorSettings.tsx:169` | 主题 profile、accent swatch、明暗模式 radio；a94 新增修改状态徽标和删除主题按钮 | 原生提示，与已有标签/可访问名称并存 |
| `3d-viewer/viewer-toolbar.tsx:200`、`211`、`223` | 复位、统计、全屏按钮 | 原生提示 |
| `FontViewerSurface.tsx:303`、`315`、`327` | B/I/U 格式按钮 | 原生提示；语言按钮已有标准 data-hover-tip |
| `PdfViewerSurface.tsx:598`、`608`、`616` | 缩小、放大、适配 | 原生提示；符号按钮需显式 aria-label，不能只删除 title |
| `MediaJobsDialog.tsx:186`、`324`、`380`、`383`、`389`、`397` | 错误码、owner/handler、进度详情 | 截断字段的原生全文提示 |
| `ImportSourceFailureDialog.tsx:69`、`ImportConflictDialogShell.tsx:91` | 冲突/失败示例全文 | 原生提示；属于导入暂留 UI 的子项 |
| `ScriptSandboxPreviewDialog.tsx:408` | 完整能力列表 | 原生提示 |

建议优先修复双提示与 icon-only 动作，再决定截断全文/重复可见文本是否需要提示；需要的提示复用 Tooltip/data-hover-tip。保留无障碍名称与禁用原因，不机械删除全部 title。文件/路径提示沿用现有产品可见范围；不把任何真实路径写入报告或证据。

静态属性置信度高；是否实际同时出现两个提示及各平台禁用控件的提示行为未做桌面核验。

### UI-AUDIT-18：十处原生 confirm 仍保留系统确认外观

a94 Renderer 有十处 `window.confirm` / `globalThis.confirm` / 全局 `confirm` 的可达调用，不能消费应用的 DialogShell 外观、主题和自定义按钮布局。

| 文件与当前行 | 用户动作 |
| --- | --- |
| `App.tsx:1938` | 有导入/导出/同步/写入活动时切换资源库 |
| `App.tsx:7787` | 删除含资产或子合集的普通合集 |
| `App.tsx:9488` | 链接文件夹转为托管文件夹 |
| `App.tsx:12108` | 批量清空 AI 内容 |
| `use-folder-delete-actions.ts:203` | 移除链接文件夹 |
| `useAssetRename.ts:225` | 重命名导致扩展名变化 |
| `commands/sidebar-commands.ts:376` | 删除智能合集 |
| `PluginSettingsPage.tsx:279` | 开启全局插件自动更新的风险确认 |
| `PluginSettingsPage.tsx:302` | 启用未信任的资源库插件 |
| `useBatchActions.ts`（补扫） | 托管资产复制到链接文件夹 |

未发现 renderer 的 alert/prompt 调用。CriticalConfirmationDialog 与 preload 的 `serpentCriticalConfirmation` 是独立异步机制，没有覆盖这些原生同步调用。

建议确认哪些操作统一到现有受控确认 Dialog；需要按业务动作调整同步返回/异步决定的时序，保留取消、忙碌状态和实际执行顺序。不能简单用异步 API 替换同步 confirm。原生机制残留置信度高，是否允许特定安全确认保留系统外观需设计确认。

### UI-AUDIT-19：a94 新主题小弹窗另建 backdrop 和层级

此项是在初扫结束后分支新增 a94 时发现，已补入当前基线，不属于 dev 遗留；它仍绕开了现有标准化 UI。

- **入口**：外观 → 保存为新主题 → 命名；主题网格 → 删除自定义主题。`theme/ThemeColorSettings.tsx:251`、`theme/ThemeAppearanceControls.tsx:217`。
- **实现**：`theme/ThemeMiniDialog.tsx:55` portal 到 body，外层只有 `.theme-mini-dialog-backdrop`（`58`），没有复用 `.dialog-backdrop`；内部虽然用 DialogShell，外部 scrim 重新实现。
- **确定差异**：`styles.css:18312` 的 backdrop 用 `z-index: 10000`，绕过命名 layer。统一 modal-backdrop 为 700、窗口 caption 为 701、notice 为 850、tooltip 为 900（`ui/tokens.css:198`）。新覆盖层会排在这些标准层之上；与“模态打开时窗口控制保持可点”的契约冲突风险明确，实际窗口点击未核验。
- **额外分叉**：小窗标题/正文固定 14px/12.5px，没有复用字号 token/scale；主确认用 UI Button，而 shell 普通 CTA 是另一套契约（UI-AUDIT-11）。
- **建议**：复用标准 backdrop 和受控 modal stack/layer，保留设置页之上的小窗顺序及独立 Esc 行为；统一字体与动作 variant。不要仅把 10000 换成任意较小整数。源码违反层级/复用标准的置信度高，视觉与窗口控制行为未做真实桌面验收。

## 明确有意暂留的导入/拖放 UI

`styles.css:15408` 明写 **Import/drop stays on-dev**。这批仍保留旧视觉，应列入后续迁移范围，但本次不按遗漏判定。

| 入口 | 边界与旧样式 | 说明 |
| --- | --- | --- |
| 导入进度 | `App.tsx:12865`；BlockingProgressOverlay | main 外，与 UI-AUDIT-04 同一共享进度组件 |
| 序列帧导入决定 | `App.tsx:12881`；`ImageSequenceImportDialog.tsx`；`styles.css:11508` | main 外，自定义帧范围/预览内容保留 |
| 同名冲突、内容重复 | `App.tsx:12900`、`12913`；`ImportConflictDialogShell.tsx`；`styles.css:13265` | main 外，完整 border/旧冲突卡片/摘要/列表及 CTA |
| 源文件导入失败决定 | `App.tsx:12925`；`ImportSourceFailureDialog.tsx` | main 外，继续旧冲突决定框 |
| 外部拖入提示 | `App.tsx:14688`；`styles.css:11248` | workspace 内的 accent 虚线和 wash 是有意的拖放提示，不归普通卡片选中样式 |
| 导航拖放目标 | `styles.css:2422` 及相关 nav-row 状态 | 区分可投放提示与普通 hover/selection，不直接按普通导航统一 |

`App.tsx:12879` 说明导入决定框必须在 `.app-shell` 外，以避开 isolation 并保持可点击。统一样式时应传播视觉契约，不能破坏这个交互边界。普通 `ImportDialog`、`ImportLibraryChooserDialog` 位于 main 内，其通用按钮已命中新覆盖，不能一起误报为 shell 外。

## 已覆盖与保留边界

- 主壳、导航行、workspace tabs/outline、主工具栏、面包屑/历史按钮、普通资产卡、masonry/justified caption、Inspector 通用布局与资产标签、空状态已有 Islands 覆盖。
- MainMenu、LibrarySwitcher、WorkspaceToolsOverflow、ContextMenu 及其子菜单已被 a91 全局 acrylic 集合覆盖。Sort/Dimension 弹层和 AI/HDRI 自绘列表不因此自动覆盖。
- 多数普通业务 Dialog 位于 `App.tsx:12969` 到 `15867` 的 main 内；通用 CTA、create-dialog 圆角/输入框已被新 CSS 覆盖。DialogShell 的通用 surface 由后加载 ui.css 提供。不能凭“文件与 dev 相同”把整个对话框判成旧 UI。
- 主题切换、自定义主题 12 字段、三浮岛 miniature、ElevationPad、背景与 a93 拖动时 backdrop 淡出已跟进实验 UI。
- AI/MCP/同步及 plugin-host settings fields 的标准输入、Select/Slider/Switch；descriptor/menu/widget select；插件任务 Feedback/Progress 已复用基础体系。复用基础体系不等于所有专属卡片/自绘控件已经迁移，详见上表。
- 图片/PDF/HTML/字体/ZIP/视频/音频/序列帧查看器有共享 viewer chrome。黑色媒体画面、棋盘、字体样张、HTML 内容与媒体专用 overlay 可有意不同。本次未确认其中额外的 Islands 外观缺口；3D 的固定子控件圆角与 HDRI 列表单列。
- 原生系统文件选择/外部应用打开、窗口 caption、窗口边缘 hitbox、主题预览缩略示意、插件 iframe 自有内容不作为资源库 Host 皮肤残留。应用内主动调用的原生 confirm 单列为 UI-AUDIT-18；a94 新主题 modal 自造 backdrop 单列为 UI-AUDIT-19。

## 建议处理顺序

1. 先确立共享的 **portal surface 与 CTA variant**，覆盖筛选/排序、插件 dialog、进度及 AI/HDRI 列表；把 body 与 shell 的视觉变量传播纳入同一方案。
2. 统一 a94 小弹窗的 backdrop/layer；清理确凿的无效表面变量、固定圆角、双悬停提示，以及文件夹卡的外框/选择契约。
3. 明确设置页、插件卡片/Host frame、任务/日志/统计列表、管理标签的允许差异，再按共享导航/card/list/control 迁移。
4. 导入/拖放作为明确暂留的一批单独安排；不拆散现有 isolation、安全遮罩和决定框顺序。原生 confirm 的迁移需要独立核对动作时序。

尚未实施、未创建修复工单、未更改功能验收状态。若后续实施，需要在当前构建上检查亮/暗主题、圆角档位、亚克力档位、键盘焦点及弹层可点击性；本报告不把它们写成已验证。

## 文件覆盖清单

以下路径均相对 `src/renderer/`。共享 `styles.css` 由各分区按关联选择器检查，主 agent 复核最终级联。

### 主壳/浏览/Inspector/菜单：48 个文件

```text
App.tsx, AppSettingsEntry.tsx, AssetCardMedia.tsx, AssetContextMenu.tsx,
BrowseLayoutPreview.tsx, CanvasToolbarControls.tsx, CollectionPickerMenu.tsx,
ColorDraftPicker.tsx, ColorFilterPopover.tsx, ColorSpacePickerMenu.tsx,
DimensionFilterBar.tsx, EntityAppearancePicker.tsx, FilterPresetChips.tsx,
FilterTagPicker.tsx, FolderCard.tsx, Icons.tsx, InspectorPanel.tsx,
LibrarySwitcher.tsx, MainMenu.tsx, NavigationSidebar.tsx, PortaledPopover.tsx,
ProxyPlaybackNotice.tsx, ScopeBreadcrumbs.tsx, ScopeHistoryButtons.tsx,
SearchHistoryPopover.tsx, SortModeControl.tsx, SyncCardStatusBadge.tsx,
TagManagementWorkspace.tsx, TagPickerMenu.tsx, TechnicalRangeFilter.tsx,
TextAssetPreviewTile.tsx, ViewerContextMenu.tsx, WindowEdgeResizeHandles.tsx,
WindowsWindowControls.tsx, WorkspaceNoticeBanner.tsx, WorkspaceTabOutline.tsx,
WorkspaceTabs.tsx, WorkspaceToolsOverflow.tsx, browse/virtual-browse-canvas.tsx,
context-menu.tsx, edit-text-context-menu.tsx, folder-inspector.tsx, hover-tip.tsx,
icon-action-button.tsx, justified-asset-rows.tsx, masonry-columns.tsx,
styles.css, workspace-tabs.css
```

### 设置/主题/插件：36 个 TSX

```text
AiConfigDialog.tsx, AppSettingsDialog.tsx, AppSettingsNavigation.tsx,
AppSettingsPages.tsx, AppearanceGlyph.tsx, ElevationPad.tsx,
LibrarySettingsDialog.tsx, McpSettingsPage.tsx, PluginCommunityDetailPage.tsx,
PluginCommunityPage.tsx, PluginJobActivityBanner.tsx, PluginReadmeView.tsx,
PluginSettingsPage.tsx, SyncSettingsPage.tsx, ai-config-number-input.tsx,
appearance-icon-paths.tsx, plugin-host-settings-fields.tsx,
plugin-iframe-view-host.tsx, plugin-inspector-sections.tsx,
plugin-inspector-views.tsx, plugin-settings-detail.tsx,
plugin-settings-pages.tsx, plugin-sidebar-views.tsx,
plugin-toolbar-contributions.tsx, plugin-ui-descriptor-renderer.tsx,
plugin-ui-dialog-host.tsx, plugin-viewer-actions.tsx,
plugin-viewer-overlays.tsx, plugin-widget-renderer.tsx,
plugin-widget-select.tsx, plugin-workspace-views.tsx,
theme/BackgroundImageControls.tsx, theme/ThemeAppearanceControls.tsx,
theme/ThemeColorSettings.tsx, theme/ThemeMiniDialog.tsx, theme/ThemeProvider.tsx
```

同时追踪 `theme/` 的配置与组合模块，包括 theme-profiles、theme-composition、custom-theme、user-themes、sample-theme-colors、background-preferences 及其偏好读取。

### 对话框/进度/查看器：55 个文件

```text
3d-viewer/viewer-surface.css, 3d-viewer/viewer-surface.tsx,
3d-viewer/viewer-toolbar.tsx, AboutDialog.tsx, AiConnectionFailureDialog.tsx,
AppLogDialog.tsx, AssetPreviewModal.tsx, AudioPlayerControls.tsx,
BlockingProgressOverlay.tsx, CollectionEditorDialog.tsx,
ContentDuplicateDialog.tsx, ConvertLinkedDialog.tsx, CreateDialog.tsx,
CriticalConfirmationDialog.tsx, DeleteProgressOverlay.tsx, ExportDialog.tsx,
FatalAlertDialog.tsx, FontViewerSurface.tsx, GifViewerPlayer.tsx,
GitignorePreviewPanel.tsx, HtmlViewerSurface.tsx, ImageSequenceDialog.tsx,
ImageSequenceImportDialog.tsx, ImageSequenceImportPreview.tsx,
ImageSequencePlayer.tsx, ImportConflictDialogShell.tsx, ImportDialog.tsx,
ImportLibraryChooserDialog.tsx, ImportProgressOverlay.tsx,
ImportSourceFailureDialog.tsx, LibraryChooserDialog.tsx,
LibraryLoadingOverlay.tsx, LibraryRecoveryDialog.tsx, LinkedRulesDialog.tsx,
MediaJobsDialog.tsx, MoveDialog.tsx, NameConflictDialog.tsx,
OpenSourceLicensesDialog.tsx, OpenSyncLibraryDialog.tsx, PdfViewerSurface.tsx,
PluginTrustPromptDialog.tsx, PluginUninstallDialog.tsx, RelinkPreview.tsx,
RenameDialog.tsx, RestoreDialog.tsx, ScriptSandboxPreviewDialog.tsx,
SequenceFrameCanvas.tsx, SmartCollectionSettingsDialog.tsx,
TextViewerControls.tsx, UndoMoveDialog.tsx, VideoPlaybackRateSelect.tsx,
VideoPlayerControls.tsx, ViewerVolumeControls.tsx, ZipArchiveViewer.tsx,
zoomable-preview-image.tsx
```

### 基础组件/主题供应/入口：26 个文件

```text
ElevationProvider.tsx, FontSizeProvider.tsx, InspectorCardFeelProvider.tsx,
MenuAcrylicProvider.tsx, RadiusProvider.tsx, harmonyos-sans-sc-stub.css,
harmonyos-sans-sc-windows.css, i18n/LocaleProvider.tsx,
inspector-card-feel-motion.tsx, main.tsx, ui/patterns/dialog.tsx,
ui/patterns/disclosure.tsx, ui/patterns/feedback.tsx, ui/patterns/menu.tsx,
ui/patterns/surfaces.tsx, ui/primitives/Button.tsx, ui/primitives/Field.tsx,
ui/primitives/Progress.tsx, ui/primitives/Select.tsx, ui/primitives/Slider.tsx,
ui/primitives/Switch.tsx, ui/primitives/TextField.tsx,
ui/primitives/Tooltip.tsx, ui/surfaces/index.tsx, ui/tokens.css, ui/ui.css
```

## 证据与限制

- 本次执行 `git pull --ff-only`，结果 already up to date；检查 ready / in_progress 工单，不改变状态。
- 使用 `git diff origin/dev...HEAD`、`git show origin/dev:<file>`、`rg` 和源码逐行读取固定基线、可达入口、选择器及引用；库存来自当前 renderer 文件枚举。
- 没有执行测试、构建、Computer Use 或截图；没有私有资源库数据进入本报告。
- 两个容易误报的位置已经更正：普通 dialog 多在 main 内；PopoverSurface 的背景/阴影来自后加载 ui.css。上文采用更正后的结论。
