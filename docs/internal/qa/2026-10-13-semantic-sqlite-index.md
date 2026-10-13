# 正式语义索引 QA

日期：2026-10-13。工单 Serpent-424d7b。状态：实现已落地，整体验收受阻，不能标记 accepted。
基线 dev `b9604ac0`；Luna 负责实现，主 agent 独立监督、审查和最终门禁。

## 接入前基线

- Node 24.15.0。
- `npm run large-library:generate -- --output 隔离临时目录 --assets 20000`：首次失败，产品内置 FFmpeg 不提供测试视频所需的 lavfi 输入。未改产品二进制或夹具断言。
- 为夹具生成单独设置 `SERPENT_FFMPEG_PATH` 指向本机具备该能力的 FFmpeg，再执行同一生成命令及 `--reset`：1 file / 1 test passed，106.13s。20,000 混合媒体资产，实际可解码图片、视频及其他格式；临时磁盘占用约 33GiB，最终验收后清理。
- `npm run test:perf:large-library -- 隔离临时目录`：1 file failed，2 tests passed / 1 failed，10.20s。此时新索引尚未接入，不能归因于本轮功能，也不能写作全基线通过。

| 项目 | 实测 |
| --- | --- |
| 打开库 | 7.6ms |
| 普通浏览 | 16.1ms |
| 文件夹切换 | 0.5ms |
| 合集切换 / 递归切换 | 6.9ms / 66.6ms |
| 普通搜索 | 22.6ms |
| 布局 | 148.4ms |
| Inspector | 0.2ms |
| 完整打开对账 | 1707.8ms |
| 对账时 viewer p50 / p95 / max | 0.6ms / 0.9ms / 6.2ms，59 样本 |
| 对账时事件循环 lag p95 / max | 1.2ms / 98.1ms |

失败位于 `tests/worker/large-library-performance.test.ts:373`：缓存命中为 true，但 7 次 cached browse 的主浏览 SQL 数均为 2，断言要求 0；remote p95 为 20.2ms，cached p95 为 19.0ms。需定位当前缓存路径与追踪规则，尚未修复。删除刷新本来未在此基线执行，不将其计为通过。以上全部是 Worker 接缝基线，不是语义搜索端到端或真实 Electron 首屏数据。

## 早期集成资源库底线

`npm run test:library-availability`：9 files / 231 tests passed，43.50s；native 预检确认 Electron ABI 与 FTS5 可用。此轮发生在 Worker 接缝与媒体准备仍在实施时，仅证明当时核心库路径的回归结果，最终集成状态仍需重跑，不能据此宣称语义功能已通过。

## 首轮万资产检索测量（实现者执行，非最终验收）

显式启用 `SERPENT_RUN_SEMANTIC_PERF=1` 的 `semantic-index-performance` 定向测试：10,000 个真实文本文件和资产条目，预计算的受控 768 维向量，sqlite-vec 原生 cosine 可用；包含实际 Worker handler 的范围筛选、来源版本读取与排名，排除 provider 推理、Main IPC 和 UI。实现者报告正确性测试通过。

- 写入后的首次查询：475.95ms。此时连接和文件缓存已有预热，不称为进程冷启动。
- 8 次热态查询：p50 422.55ms，p95 / max 592.47ms。
- 五千资产文件夹筛选：163.33ms。

500ms 目标尚未稳定达到，不能标为性能通过。已要求分段测量候选筛选、来源投影、原生排名和排序，减少重复分页查询，并继续测常用高维、真实调度、完整进程重启及端到端首屏。

随后复用完整范围 `idsOnly` 接缝，减少重复计数和排序。实现者报告同一万资产 / 768 维基准第二轮：首次 191.77ms，候选 ID 15.81ms、来源投影 96.52ms、原生向量扫描 63.92ms、分数排序 13.82ms；8 次热态 p50 133.24ms、p95 / max 170.44ms，五千资产筛选 64.21ms。该轮检索层低于 500ms；尚未证明高维、重启、调度并发或完整应用端到端目标。第一次未达标记录保留以说明实际优化过程。

## 高维检索复测（实现者执行，非最终验收）

同一有界基准加入 4096 维 API 常见高维，并使用实际文件 stat 的尺寸和时间作为目录版本，避免夹具在真实对账时失效。sqlite-vec 原生 cosine 可用。

| 维度 | 写入后首次 | 热态 p50 | 热态 p95 / max | 热态样本 | 五千资产文件夹 |
| --- | --- | --- | --- | --- | --- |
| 768 | 156.51ms | 111.66ms | 137.52ms | 8 | 53.28ms |
| 4096 | 205.16ms | 197.87ms | 205.24ms | 8 | 100.42ms |

768 维首次查询候选 / 来源投影 / 原生排名 / 排序分别为 12.08 / 76.92 / 53.39 / 12.72ms。仅关闭并重新打开 sidecar 会话后的首次查询为 110.54ms，仍是同一进程，不能当作 Worker 进程重启或应用冷启动。

以上均为受控预计算向量的 Worker 检索。当前两种维度的检索测量低于 500ms；完整 provider、IPC、界面与真实进程重启目标仍未验证。强过滤测试需同时核验候选身份和精确分数，不以数量一致代替成员正确性。

## 完整验收队列

最终状态已在下方“最终集成复测”四列追踪表中更新；上文保留方案实施期间的阶段性数据。

本报告由主 agent 维护。未完成证据不登记为待人类验收，用户既有验收结论不被自动改写。

## 最终集成复测（2026-10-13）

主 agent 在实现完成后运行最终门禁。独立审查 agent 未完成最终复核，因此本报告不等同于独立 Spec/Standards 通过；整体结论为部分完成，工单保持开放。

| 需求 | 实现位置 | 自动化证据（当次命令与结果） | 人工/平台证据 |
| --- | --- | --- | --- |
| Worker SQLite 持久化、检索与应用完整重启 | `src/worker/semantic-index-store.ts`、`src/worker/handlers/semantic-index.ts`、`src/main/embedding-http-index.ts` | `SERPENT_E2E_HIDE_WINDOW=1 npm run test:e2e` 中 `semantic-sqlite-lifecycle.test.ts` 通过：Electron 全退出/重启后索引仍为 2/2 ready，重启后搜索成功且没有再次请求整库嵌入；全套 E2E 总体未通过（83 passed、20 failed、4 skipped，共 107 条） | E2E 截图：[重启后搜索](evidence/2026-10-13-semantic-sqlite/restarted-search.png)。Computer Use 前台验收尚未执行；packaged 与 Windows 未执行 |
| 旧 JSON 缓存核验与迁移 | `src/worker/legacy-semantic-cache.ts`、`src/worker/handlers/semantic-index.ts` | 旧缓存有界解析、损坏尾部回滚、profile/revision/dimension 校验由定向单测覆盖；真实旧缓存迁移后再完整重启清理尚无 E2E 证据 | 未人工点验 |
| 过滤、找相似、取消与排名 | `src/worker/handlers/semantic-index.ts`、`src/worker/semantic-index-store.ts` | Worker 定向测试覆盖候选分页、过滤成员、取消交错、找相似和 native/fallback cosine；语义 E2E 的过滤与找相似通过 | 真实用户图库与模型质量未人工验收 |
| 永久删除清理一致性（含超过 100k 候选） | `src/worker/handlers/semantic-index.ts` | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/semantic-index-handler.test.ts --reporter=dot`：5/5 passed；含 100,001 个候选的完整分页和两份清理队列验证 | 未涉及人工操作 |
| 一万资产检索性能 | `tests/worker/semantic-index-performance.test.ts` | `SERPENT_RUN_SEMANTIC_PERF=1 node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/semantic-index-performance.test.ts --reporter=verbose`：1/1 passed。10k/768D 首次 96.35ms、热态 p95 105.10ms、5k 范围 46.93ms；10k/4096D 首次 147.27ms、热态 p95 148.97ms、5k 范围 78.65ms | 仅预计算向量、Worker handler 范围筛选与排名；不含 query embedding、IPC、UI、进程冷启动，不代表端到端 500ms 达标 |
| 普通搜索和 20k 大库基线 | `tests/worker/search-performance.test.ts`、`tests/worker/large-library-performance.test.ts` | `npm run test:perf:search`：5/5 passed。`npm run test:perf:large-library -- 隔离的 mixed-20k 夹具`：3 项中 2 passed / 1 failed；20k 普通搜索 16.9ms、资源库对账 1101.1ms。失败是 metadata-cache 断言仍看到 7 次缓存浏览 SQL 各 2 条，期望 0 条；接入前基线也在同一断言失败（Serpent-38b190），本轮没有归因或放宽该断言 | 使用合成本机临时数据，最终已清理；非用户资源库 |
| 核心资源库可用性 | Worker schema/open/recovery | `SERPENT_E2E_HIDE_WINDOW=1 npm run verify:mainline` 中 `npm run test:library-availability`：9 files / 231 tests passed | packaged 与 Windows 未执行 |
| 类型、规范与完整主线门禁 | 当前 dev 树 | 同一 `verify:mainline` 中 lint 为 0 errors / 7 React hook warnings，typecheck 和 `extension:verify` 通过；`npm run test` 为 11 files failed、703 passed、18 skipped（5760 tests 中 17 failed） | Windows 未执行 |

完整 E2E 命令 `SERPENT_E2E_HIDE_WINDOW=1 npm run test:e2e` 共 107 项，83 passed、20 failed、4 skipped，用时约 11 分钟。失败分布在导入、分页、重命名、浏览偏好、合集层级、菜单、确认弹窗、文件夹菜单、视频预览、导航背景、组织元数据、回收站批量操作、shell navigation 与 workspace tabs；新增语义 SQLite 生命周期测试本身通过。没有建立这些失败相对当前 dev 基线的归因。`npm run test` 的 17 个失败涉及 model pipeline、network metadata cache、raw metadata admission、real media bundle、video/exr、格式预设、导入错误、open-recent、媒体包平台校验、主题 token 和 workspace tabs；同样不作归因。

最终阻断项：`npm run test`、完整 E2E 与 20k 基线均未整体通过；查询 embedding + Worker + IPC/渲染的完整 500ms 链路尚未测量；独立最终审查、Computer Use、packaged/macOS 与 Windows 证据未完成。因此不关闭 Serpent-424d7b，不登记待人类验收，不声明规格完整或性能达标。

## 合并远端更新后的推送前复验（2026-10-13）

合并 `origin/dev` 后，`SERPENT_E2E_HIDE_WINDOW=1 npm run verify:mainline` 的 lint、typecheck、extension verify 和资源库可用性阶段均通过；`npm run test` 随后报告 19 项失败、5,730 项通过、28 项跳过，门禁因此未运行后续通用性能套件和全量 E2E。该次失败包含一个新合并文件夹封面路径对可选 `revision_artifacts.status` 列的硬引用；改为按现存列构造封面查询后，`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/lenient-folder-panel.test.ts --reporter=verbose` 为 2/2 通过。全量单测未在此最后一处修正后重跑，剩余失败数不作当前精确结论。

同一复验发现 v58 文件夹封面迁移在较新列已存在、迁移记录回退的历史兼容场景会重复添加 `cover_asset_id`。迁移现先读取表结构；资源库底线重跑 `npm run test:library-availability` 为 9 files / 233 tests passed。合并进来的文件夹封面选择器也修正了 effect 内同步设置 loading 的 lint 错误；最终 `npm run lint` 为 0 errors / 7 warnings，`npm run typecheck` 通过。

语义检索直接 Worker 基准复跑：`SERPENT_RUN_SEMANTIC_PERF=1 node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/semantic-index-performance.test.ts --reporter=verbose`，1/1 通过。10,000 条、768D 首次 101.86ms，热态 p95 109.80ms，5,000 条筛选 46.57ms；4096D 首次 146.05ms，热态 p95 163.16ms，筛选 80.37ms。计时仍排除 provider 推理、IPC、UI 和进程冷启动。

语义全应用退出/重启 E2E：`SERPENT_E2E_HIDE_WINDOW=1 node scripts/run-e2e.mjs tests/e2e/semantic-sqlite-lifecycle.test.ts`，1/1 通过。全量 `verify:mainline` 在单测失败处提前停止，通用 `test:perf:search`、全量 E2E、packaged 与 Windows 本轮没有执行；独立最终审查和 Computer Use 仍未完成。

## 向量准备失败与后台任务显示（2026-10-13）

| 需求条目 | 实现位置 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| 缩略图/内容准备、模型编码或向量写入失败后，找相似停止轮询并明确提示失败 | `src/worker/handlers/semantic-index.ts`、`src/worker/semantic-index-store.ts`、`src/main/embedding-http-index.ts`、`src/main/embedding-test-index.ts`、`src/renderer/App.tsx` | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/embedding-http-index.test.ts tests/worker/semantic-index-store.test.ts tests/worker/semantic-index-handler.test.ts tests/unit/find-similar.test.ts tests/unit/semantic-work.test.ts`：5 files / 39 tests passed。覆盖 ready 预览文件缺失、HTTP indexer 准备阶段失败分类、过期重试时间可重新领取，以及相似查询终态 `failed`。 | 隔离 Electron 合成测试通过；真实 MP4/GIF provider 推理和人工验收尚未执行。 |
| 将向量生成计入后台任务，并在完成但存在失败项时保留状态 | `src/renderer/semantic-index-copy.ts`、`src/renderer/MediaJobsDialog.tsx`、语义 SQLite `embedding_jobs` | `SERPENT_E2E_HIDE_WINDOW=1 node scripts/run-e2e.mjs tests/e2e/semantic-sqlite-lifecycle.test.ts`：1/1 passed。受控 provider 失败后后台任务仍显示失败数量；找相似给出失败提示；完整应用退出/重启后其他向量仍复用。`npm run test:library-availability`：9 files / 233 tests passed；`npm run typecheck` 通过；相关文件 ESLint 0 errors。 | 使用隔离 userData、合成资源库与本地受控服务。真实图库、MP4/GIF 及 Computer Use 未执行。 |

历史“121 项未编码”的实际原因无法从现有记录反推出：旧实现把 Worker 准备错误与 provider 错误都记成 `provider`，未保存单项错误文本。没有 ready 预览的资产会被目标筛选排除，不会触发编码失败；ready artifact 的磁盘文件若缺失、损坏、不可读或超出输入限制，则会在准备阶段失败。新运行会区分准备、provider 和向量存储阶段，以便后续定位。当前 E2E 覆盖受控 provider 失败；真实 121 项尚未按新分类重新处理，故不能声称已查明每一项的根因。

## 模型输入能力与找相似菜单补充（2026-10-13）

| 需求条目 | 实现位置（file:line） | 自动化测试（test:line） | 人工/平台证据 |
| --- | --- | --- | --- |
| 按模型和 HTTP 适配器实际请求通道判断输入能力 | `src/shared/embedding/modalities.ts:9,36`、`src/main/embedding-llama-session.ts:180,213`、`src/shared/embedding/http-service.ts:155` | `tests/unit/find-similar.test.ts:13`：本地实际输入为 image/audio/text；OpenAI 适配器仅 text；llama.cpp 与 DashScope 实际 text/image。定向命令共 4 files / 77 passed | [EmbeddingGemma 2 模型卡](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2?hl=en)列出 text/image/video/audio。Serpent 当前视频通过 ready poster 作为 image 输入，不是原生视频请求。HTTP provider 的真实多模态质量尚未人工验收 |
| MP4 通过 ready poster 走 image 编码，菜单与 Worker 使用相同来源规则 | `src/worker/library-service.ts:29105`、`src/shared/embedding/profile.ts:251`、`src/worker/handlers/semantic-index.ts:422,740,943` | `tests/worker/semantic-index-handler.test.ts:36`：Worker 合成 MP4 + ready video poster，image-only session 会返回 image target 和 image source target。当前只证明来源路由/待准备状态，未证明真实 provider 推理和最终结果 | 实际 MP4 full flow 尚未通过 Electron E2E；保持待人工验收 |
| 只显示当前编码器可以直接处理或有图片预览可回退的菜单入口 | `src/renderer/AssetContextMenu.tsx:2059`、`src/renderer/commands/asset-commands.ts:164`、`src/renderer/App.tsx:9015` | `tests/unit/asset-commands.test.ts:207`；`tests/e2e/semantic-sqlite-lifecycle.test.ts:182,190`。同一 E2E 右键文本显示入口、右键不支持图片隐藏入口；E2E 最终 1/1 passed | Electron 使用隔离 userData 和合成资源库。原有找相似结果 UI 布局未修改，用户明确表示后续再讨论 |
| 说明自然语言查找、找相似与资源开销 | `src/renderer/SemanticSearchSettings.tsx:201`、`src/renderer/i18n/catalogs/zh-CN.ts:1723`、`src/renderer/i18n/catalogs/en.ts:1742` | `tests/e2e/semantic-sqlite-lifecycle.test.ts:147`：新增提示在真实设置页可见；最终 E2E 1/1 passed | Computer Use 未执行，真实窗口截图验收仍待用户操作 |

本轮最终命令：`npm run typecheck` 通过；定向测试 77/77 通过；`npm run test:library-availability` 为 9 files / 233 tests passed；ESLint 0 errors、2 条 `App.tsx` 既有 hooks 警告（确切命令见[开发日志](../development/2026-10-13-semantic-sqlite-index.md)）；语义生命周期 Electron E2E 为 1/1 passed。测试生成截图已清理。由于 MP4 只在 Worker 合成夹具验证到 ready poster 来源，不能将“MP4 实际模型编码已端到端验证”写为通过。


## Derived-preview path regression (2026-10-13)

| Requirement | Implementation | Automated evidence (command and result) | Human/platform evidence |
| --- | --- | --- | --- |
| Read relative derived previews safely for semantic image preparation; successful vector writes reach ready, while a genuinely missing artifact still fails preparation | `src/worker/handlers/semantic-index.ts`; `tests/worker/semantic-index-handler.test.ts` | Old-code red: focused MP4 poster test failed with `ENOENT` at `stat 'clip-poster.jpg'`. Fixed: `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/semantic-index-handler.test.ts tests/worker/semantic-index-store.test.ts --reporter=verbose`, 2 files / 17 passed; `npx eslint src/worker/handlers/semantic-index.ts tests/worker/semantic-index-handler.test.ts` had no diagnostics; `npm run typecheck` passed; `npm run test:library-availability` passed 9 files / 233 tests, with Electron ABI and FTS5 preflight passing; root-agent background `SERPENT_E2E_HIDE_WINDOW=1 node scripts/run-e2e.mjs tests/e2e/semantic-sqlite-lifecycle.test.ts`, 1/1 passed in 13.2 seconds | Synthetic isolated Worker library only. The active library and its previously reported 16 failures were not rechecked. Real media/provider requests, Computer Use, packaged, and Windows were not verified. |

This increment did not retry the active library's durable failures. Whether they converge after a new index generation remains unknown; this is not evidence that the reported 16 items are fixed and is not human acceptance.
