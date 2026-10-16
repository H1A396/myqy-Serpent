# 正式语义索引监督审查

日期：2026-10-13。工单 Serpent-424d7b，实施基线 dev `b9604ac0`。
实现：Luna；设计及监督审查：主 agent。状态：主 agent 最终自查已记录；独立最终复核未完成，整体未通过验收门槛。

## Standards

采用独立 Worker store，复用 better-sqlite3、现有推理 provider、范围/筛选及渐进浏览接缝。审查固定检查进程所有权、Zod 边界、资源库可用性、临时产物清理、隐私以及巨型文件增长。任何最终结论均需在最终代码状态复核。

首稿发现并已要求实现者修复：

- BLOB 编码仅检查范数，fallback 为点积，而 native 为 cosine；非单位 API 向量会产生不同分数。已改为明确 Float32 归一化，新增 native/fallback 等价及极值测试。
- native 查询返回 `asset_id` 却按 `assetId` 使用，过滤会丢弃全部结果。已修复字段映射，真实原生路径非空结果纳入测试。
- UPSERT 把 SQL 持久化失败吞成普通 rejected。已分离向量验证与事务写入，使事务失败可传播并回滚。
- 构造中异常可能留下连接。已增加初始化失败的关闭处理，并拒绝 sidecar 目录或文件符号链接。

以上仅记录首稿纠正，不代替最终故障路径和 Worker 集成审查。

## Spec

用户授权独立 SQLite 正式化，并要求万资产 500ms 优化与测试。保持原始 cosine 排序、找相似、渐进完整浏览、授权边界和普通资源库可用性；禁止先截断全库再筛选。迁移、完整重启、版本竞态、导出快照、native 打包及端到端计时仍需实现和证据。

首阶段实现者报告 store 定向测试 1 file / 7 passed，含真实 sqlite-vec 与强制降级；主 agent 已查看对应代码和测试，但尚未独立执行最终集成验证。

## 调用链监督

- 新 HTTP 门禁最初同时要求显式 binding 与 `grantedLibraryIds`。主 agent 核对当前 Renderer 没有调用 grant 的入口，且 binding 存在默认继承语义；该实现会阻断既有配置。实现者已改为复用 effective selection，不将未接入的旧字段宣称为产品授权。
- 分片排名需要释放 scheduler admission，取消命令需要受控即时通道。实现者已接入让出接缝；真实 Worker 调度和切库竞态测试待补。
- 排名后的 revision 核验不能使用让出调度前计算的 `stillCurrent`。缩略图 artifact 不推进 browse sequence，需要另用稳定版本栅栏；已要求实现者覆盖最终发布前的完整核验。
- Main 不再保存整库向量或读取媒体源路径；Worker 准备有界输入。文件读取、音频进程取消、句柄释放及配置变更后的旧请求写入仍需最终测试核对。
- 实现者报告 provider 定向测试 27 条、store 与 search 定向测试 99 条通过；这不是最终主线或完整语义旅程验收。
- 查询 token 在 embedding 返回后才分配，会让慢的旧查询取消更快返回的新查询。已要求在请求入口建立独立 query generation，并加入乱序完成测试。
- 音频关闭路径等待包含 admission 重新获取的 Promise，可能与持有独占 admission 的关闭请求互等。已要求区分底层进程清理 Promise 与调度包装，并以真实 scheduler 测试证明关闭、取消和切库不会死锁。
- HTTP 编码的全局运行标记会使切换后的新库停留在 starting；已改为会话持有运行槽并在旧会话释放后调度新会话，新增切库回归。
- 任务枚举原先会把同修订 running 重置为 pending；现以每次尝试 claim token 保留运行状态，旧失败和旧向量写入必须匹配有效领取。实际提交成功的 ID 才计入 accepted；每页候选任务在同一事务写入。
- 窄来源投影最初未复用 JPEG/WebP/PNG 优先及最新 artifact 选择规则，可能把另一张预览当成编码来源；已修正，并加入 sibling-thumbnail 与完整来源投影一致性测试。
- 实现者最新报告 store 与 search 2 files / 102 tests passed，覆盖 claim 重启及 fencing、缩略图来源一致性。真实 UtilityProcess 调度、迁移及完整应用证据仍待补。

## 最终复核与结论（2026-10-13）

主 agent 在实施中对被跟踪文件及本轮新增文件做路径/凭据形态扫描，排除归属其他工作的临时目录：本机实际家目录串 0 命中。泛化家目录样例 46 命中、UNC 样例 1 命中；凭据前缀的 5 个命中均位于既有执行日志脱敏测试的输入与“不包含该值”断言，未输出口令原文。上述既有样例与扫描白名单仍归 Serpent-b78285 跟踪；这不等于全仓隐私门禁或历史脱敏完成。最终提交前仍需复扫本轮新增内容。

主 agent 核对最终改动：永久删除候选按稳定 ID 分页至快照结束，并在核心删除前先持久化最多 100k 一批的清理队列；对 100,001 项的 Worker 测试通过。完整应用语义重启 E2E 通过。10k 受控 Worker 检索低于 500ms；这不覆盖 provider、IPC、UI 或进程冷启动。

最终自动化门禁并非全绿：资源库可用性 9 files / 231 tests 通过；lint 0 errors / 7 warnings、typecheck 和 extension verify 通过；`npm run test` 有 17 项失败；全量 E2E 83 passed / 20 failed / 4 skipped；20k 性能套件有一项 metadata-cache 断言失败，且该同一断言在接入前基线已失败（Serpent-38b190）。详见 QA 报告。失败没有被强行归因到本次改动，也没有被隐藏或通过降低断言规避。

原独立审查 agent 在用量限制前留下了中间审查与待修意见，但没有完成最终复核。主 agent 检查了已知阻断修复，不能代替项目要求的独立最终 Spec/Standards 签署。Computer Use、当前 HEAD packaged、Windows、embedding + IPC + UI 的端到端 500ms 仍未验证。因此 Standards、Spec 和性能均不得标记为最终通过；工单继续开放。
