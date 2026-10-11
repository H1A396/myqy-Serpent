# 语义搜索结果渐进加载开发记录（2026-10-11）

## 旧行为与新行为

旧实现先按归一化向量的余弦相似度排序，再只保留与最高分相差不超过 0.02 的结果，并最多返回 100 项。这个分差没有经过标注查询校准，会丢掉仍可能相关的图片。新实现保留完整、稳定的相似度排名；首批只取得结果摘要，滚动到列表尾部时按原排名继续取下一批。语义搜索每批可选 25、50 或 100 张，默认 50。批次大小在查询开始时固定，修改设置只影响下一次查询。普通浏览仍按原有 100 张分页。

语义结果持有有序资产 ID 快照，后续分页只从快照取对应 ID 的摘要，不改走普通关键词搜索；完整布局仅随已加载批次扩展。搜索之后已删除的资产不会令空批次重复请求，首批全部失效时也会继续找下一批可用摘要。

这次没有改变向量模型、图片编码或相似度的先后顺序。用户反馈的“文字截图排在真实倒影图片前”仍未由标注样本证明根因，不能把渐进展示写成相关性提升。后续需在相同图片与查询上比较三档原始分数和排名，再决定是否需要重排或更换模型。实验报告以样本 ID 记录结果，避免把用户图片名称写入仓库。

## 验证

- 最终代码状态的定向测试：`embedding-test-index.test.ts`、`semantic-search-preferences.test.ts`、`browse-pagination.test.ts`、`browse-window-slots.test.ts` 共 4 files、52 passed。此前空批次修复后的分页测试单独 27 passed。
- `tsc --noEmit`：通过。定向 ESLint：0 errors；`App.tsx` 有两条原有 Hook 依赖警告。
- 最终代码状态的真实 Electron：`node scripts/run-e2e.mjs tests/e2e/asset-pagination.test.ts -g 'bottom-scroll appends'`，1 passed（25.6s），验证普通浏览的滚动追加未回归；不构成真实语义结果滚动验收。
- `node scripts/run-e2e.mjs tests/e2e/organization-search-trash.test.ts`：4 failed。失败分别为临时目录清理权限、拖拽卡片定位超时、弹窗中“取消”按钮定位不唯一、合集父子关系断言；未据此宣称搜索分页通过。
- 首轮 `npm run verify:mainline` 在空批次边界修复前启动：lint 0 errors/7 warnings、typecheck、extension verify、完整 `test:library-availability`（230 passed、1 skipped）通过；全量 `test` 在多个未修改范围内失败，门禁最终退出码 1。
- 最终代码状态第二轮 `npm run verify:mainline`：lint 0 errors/7 warnings、typecheck、extension verify、完整 `test:library-availability`（230 passed、1 skipped）通过。全量 `test` 再次报告格式分组、媒体与 Worker 测试失败，之后长时间没有输出；运行未自行结束，停止后退出码 1。第二轮没有完整测试汇总，不能记为全套完成或通过，也未进入后续门禁。

`EMBED-SEARCH-001` 和 `EMBED-MODEL-001` 已同步为新交互步骤，仍待用户在真实图片库中验收。packaged、macOS、真实语义搜索 Electron E2E 未验证。

失败的 Electron 用例曾尝试清理其自建临时目录，但删除被自动执行策略拒绝；测试追踪产物与辅助测试日志也未能全部清理。未尝试以其他命令绕过拒绝；残留只留在本地测试环境，不纳入版本控制。

## 排名分页布局回归（2026-10-11）

根因在分页 Hook 与虚拟浏览会话的布局缓存不一致：语义搜索没有 `sessionId`，因此不使用虚拟布局；`beginPage` 在 Hook 自己的 `layoutRef` 中建立首批排名布局，但不完整首屏对应的会话布局仍为空。`ensureVisibleRange` 和 `ensureVisibleIndices` 的已填充快速路径及取数后的同步点曾无条件用会话布局覆盖 Hook 布局。首屏可见范围上报触发快速路径后，第二批追加只剩自己的排名条目；实际 Canvas 布局解析器再把首批摘要作为额外项放在布局末尾，于是新批次显示在旧结果前面。

修复让这四处同步只刷新普通未排名布局。语义排名仍以完整 `rankedAssetIds` 快照为顺序依据，摘要缺失时只跳过缺失卡片；没有改动 App 内联逻辑、普通分页或 shuffle。请求过期路径也已核对：页面响应在应用前比较请求 generation；本次没有改变该保护。相似度同分按资产 ID 稳定打破的既有测试位于 `embedding-test-index.test.ts`，分页继续消费已排序的完整 ID 快照。

新增 Hook 集成回归通过 `resolveBrowseCanvasLayout` 检查实际 Canvas 解析结果。150 个排名 ID 分三批加载；每批 API 返回顺序与快照相反，修改时间也与相关性顺序相反，并在首、二批各放入一个缺失摘要。测试分别用 `ensureVisibleRange` 和 `ensureVisibleIndices` 取第三批，检查首批位置、锚点索引、完整排名顺序及已填充范围快速路径。临时移除保护条件时，定向测试按预期失败：第二批 50 个结果先于首批显示；恢复修复后通过。

- 修复前复现命令：`npx vitest run --config vitest.config.ts tests/unit/ranked-browse-pagination.integration.test.tsx`，2 tests failed；Canvas 布局中的 rank-050..rank-099 出现在 rank-000..rank-049 前。
- 修复后定向测试：`npx vitest run --config vitest.config.ts tests/unit/ranked-browse-pagination.integration.test.tsx tests/unit/browse-pagination.test.ts tests/unit/browse-window-slots.test.ts`，3 files / 42 passed。
- 定向 ESLint：`npx eslint src/renderer/use-browse-pagination.ts tests/unit/ranked-browse-pagination.integration.test.tsx`，通过；`npm run typecheck`，通过。
- 真实语义搜索 Electron 翻页和滚动锚点尚未验证，交由主 agent 集中执行；以上 Hook/Canvas 集成测试不替代真实应用验收。

主 agent 对最终修复状态复核：`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/ranked-browse-pagination.integration.test.tsx tests/unit/browse-pagination.test.ts tests/unit/browse-window-slots.test.ts tests/unit/embedding-test-index.test.ts tests/unit/semantic-search-preferences.test.ts`，5 files / 54 passed（729ms）。后台真实 Electron `node scripts/run-e2e.mjs tests/e2e/asset-pagination.test.ts -g 'bottom-scroll appends'`，1 passed（25.7s），仅证明普通浏览滚动追加未回归。独立审查核对修复仅涉及四个同步点，未修改相似度、普通浏览布局及 App；实际语义查询的 Electron 翻页、滚动像素锚点及桌面视觉验收仍未执行，需用户复测。Bug `Serpent-wadx1` 保持进行中等待用户确认，`EMBED-SEARCH-001` 保留人类验收不通过记录。

最终修复状态启动 `npm run verify:mainline`：lint 0 errors / 7 warnings、完整 typecheck、extension verify 通过；资源库可用性 9 files / 230 passed / 1 skipped（72.07s）。全量测试随后再次报告 format-filter-presets、folder-custom-cover、raw-metadata-admission、network-metadata-cache、model-pipeline、library-zip、library-export-import 失败；看到明确失败后主动停止，退出码 1，没有全量测试汇总，后续性能和全套 E2E 门禁未执行。不能记为完整通过；也没有对未修改范围做干净基线对照，因此不据此断言失败必然与本次无关。本次定向 E2E 生成的 45 字节测试状态文件删除被自动审批以 blocked by policy 拒绝，未绕过；文件留在忽略的测试产物目录。

## 语义搜索余弦分数诊断（2026-10-11）

语义结果卡片现在临时显示原始余弦相似度，保留四位小数，不换算成概率或百分比，也不截断负数或大于 1 的值。Main 将 `scoreEmbeddings` 已用于排序的分数随兼容保留的 `assetIds` 一并返回；协议拒绝非有限值、未知 ID 和重复 ID，Preload 明确透传分数。Renderer 按 `assetId` 关联整次排名快照，因此首屏与后续批次共用同一份分数。仅语义结果显示；普通页面、新查询、停用/切换语义模式、切换标签页或资源库时清除，公共卡片媒体容器包含缩略图失败和缺少预览的卡片。

检查图片失败路径没有找到足以解释“损坏图排得较前”的证据：索引编码失败会跳过对应资产；索引候选按可用状态、图片类型、支持的扩展名和文件存在性筛选，但没有先独立解码验证源图。新向量会归一化，缓存读取会校验模型配置、向量维数、有限数值及资源版本，但不会再次检查向量范数或归一化状态。因此缓存向量异常是待排查风险，不能据此认定这次高排名由缓存或损坏图片造成；缩略图/预览失败也不证明原始文件无法供模型读取。此改动只展示分数，没有改变模型、向量缓存或排名。

- 定向测试：`npx vitest run --config vitest.config.ts tests/unit/embedding-test-index.test.ts tests/unit/preload-library.test.ts tests/unit/semantic-search-scores.test.tsx`，最终 3 files / 19 passed。覆盖真实余弦计算、协议校验、Preload 分数透传、按资产 ID 映射、0/负数/大于 1 值、卡片标签和 tooltip，以及普通浏览/资源库/标签页边界。
- `npm run typecheck`：通过。`npx eslint src/main/embedding-test-index.ts src/main/library-request/embedding-models.ts src/preload/bridge/library.ts src/shared/protocol/responses.ts src/shared/library-api.ts src/renderer/semantic-search-scores.ts src/renderer/SemanticSearchScoreBadge.tsx src/renderer/App.tsx tests/unit/embedding-test-index.test.ts tests/unit/preload-library.test.ts tests/unit/semantic-search-scores.test.tsx`：0 errors、2 条 `App.tsx` Hook 依赖 warning（既有 AI job 和浏览布局依赖）。真实语义搜索 Electron 卡片、预览失败态和滚动追加尚未由实现者验证，交由主 agent 集中执行；不会据此记录为人工或桌面验收通过。

主 agent 最终检查：`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/embedding-test-index.test.ts tests/unit/preload-library.test.ts tests/unit/semantic-search-scores.test.tsx tests/unit/ranked-browse-pagination.integration.test.tsx tests/unit/browse-pagination.test.ts tests/unit/browse-window-slots.test.ts tests/unit/semantic-search-preferences.test.ts`，7 files / 66 passed（1.13s）；后台 `node scripts/run-e2e.mjs tests/e2e/asset-pagination.test.ts -g 'bottom-scroll appends'`，1 passed（25.6s）。代码审查核对 Main 分数到协议、Preload 和公共 renderAssetCard 的完整链路，确认资产 ID 映射、排名快照保留、跨库/跨标签页过滤与普通页面清除，样式复用既有 badge 与 Tooltip，未改余弦排名。此次小规模临时诊断按分级规则执行定向检查，不重复上轮已明确失败的全仓门禁；全仓未通过状态继续保留。真实语义结果的分数可见性、失败缩略图卡片、各布局视觉效果和多批次分数由用户复测，新增清单 `EMBED-SCORE-001` 待人类验收。重新启动应用后发起新语义查询才能取得新增的 Main/Preload 分数字段；旧的查询快照不补造分数。
