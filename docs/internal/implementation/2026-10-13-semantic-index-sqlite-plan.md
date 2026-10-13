# 语义搜索 SQLite 正式化方案

日期：2026-10-13。状态：提案，待用户确认；2026-10-13 用户明确暂缓向量开发。仅制定方案，不包含实现、性能结论或验收通过。
调查基线：远端 dev `6a9f8449`。UI 分支与 dev 的语义功能存在差异，实施应基于届时最新 dev，不能直接以当前 UI 分支代码代替。

## 1. 推荐决定

采用 **资源库内独立 SQLite 文件 + Float32 二进制向量 + sqlite-vec 稳定版距离函数**。

- 建议位置为资源库内 `.serpent/semantic/index.sqlite`，具体相对目录需与现有布局模块统一登记。向量随库移动，不再存在应用配置目录的大型 JSON 中。
- Library Worker 是 SQLite、文件准备、索引写入与查询的唯一所有者。主数据库仍是资产事实源，语义数据库是可重建的派生数据。
- 持久化使用普通表及 BLOB；初期用 sqlite-vec 原生距离函数计算精确 cosine。不将扩展专属虚拟表设为唯一存储，不把 HNSW/DiskANN 设为第一阶段必要依赖。
- sqlite-vec 不能加载时，库的打开、浏览、普通搜索必须照常工作。语义搜索可用分块 Float32 精确计算作为正确性降级；不得借此宣称性能通过。
- 推理模型、本地运行时和 HTTP 适配层继续复用；本轮改变索引管理，不改变模型、输入策略或相关性规则。保持 dev 当前原始相似度排序，不引入文本扣分或混合排名算法。

推荐理由：独立 SQLite 避免向量膨胀影响核心元数据备份、迁移和损坏恢复；普通表确保扩展版本变化时数据仍能读取；Worker 管理与现有架构一致。独立库并不带来跨数据库原子性，所以方案必须显式处理资产修订核验和补偿，而不能假设外键或事务跨库生效。

## 2. 当前缺口（实际代码）

dev 的 `src/main/index.ts` 527–544 初始化本地和 HTTP 索引，分别写应用配置目录的 embedding-test-index / embedding-http-index。

- `embedding-test-index.ts` 656–709 与 `embedding-http-index.ts` 423–468：每个库/模型一个 JSON，使用同步读取、序列化、写文件；先移除旧文件再 rename。
- 两个编码循环每得到一条向量就重写全部 entries，而不是增量提交。增长过程反复写同一批历史数据。
- `embedding-test-index.ts` 85 起：数组遍历计算全部 cosine，再排序；本地和 API 共用此排名实现。
- 已有 profileKey、source revision、失败跳过、取消 generation、库权限和渐进结果，应复用并加强；不能把正式化理解为只替换扩展名。

## 3. 方案比较

| 方案 | 优点 | 主要代价 | 决定 |
| --- | --- | --- | --- |
| 主 library.db 增加向量 BLOB 表 | 与资产同事务、沿用备份 | 向量放大核心库及备份体积，涉及核心 schema 和恢复流程 | 不优先采用 |
| 库内独立 SQLite 普通表 | 隔离故障、随库移动、事务增量写、扩展可替换 | 需要跨库版本核验、独立备份/布局登记 | 推荐持久化 |
| 普通表 + sqlite-vec 距离函数 | 原生计算，可先按完整资产筛选条件限定候选 | 精确扫描仍为 O(N×D)，额外动态库打包 | 推荐初期查询 |
| sqlite-vec vec0 | 向量专用布局和 KNN 查询 | 按维度建表、筛选表达式有限，扩展依赖及重建 | 基线测量后可增加派生加速表 |
| vectorlite / HNSW | 近似检索可减少扫描 | 召回率、索引持久化和重建、额外 native 依赖与同步一致性 | 十万/百万级有证据后再考虑 |
| 独立向量数据库服务 | 服务端能力丰富 | 增加服务进程、安装、资源占用与库便携管理 | 当前桌面产品不采用 |

sqlite-vec 官方支持 better-sqlite3，普通 BLOB 表也可调用距离函数；vec0 有较受限的 metadata operators，因此复杂文件夹/合集/标签筛选不能直接照抄到 vec0。[Node 接入](https://alexgarcia.xyz/sqlite-vec/js.html)、[普通表 KNN](https://alexgarcia.xyz/sqlite-vec/features/knn.html)、[vec0 筛选](https://alexgarcia.xyz/sqlite-vec/features/vec0.html)。这些是项目官方能力说明，不代表 Serpent 已实测。

截至调查时稳定版为 v0.1.9；官网当前文档展示 alpha 版本，不能将 alpha 能力默认为稳定版能力。实施需锁版本/校验和并核对 tagged 源码。[稳定发布](https://github.com/asg017/sqlite-vec/releases/tag/v0.1.9)。补充引擎调研见[独立调查](../research/2026-10-13-vector-search-engines.md)。

## 4. 数据模型与边界

语义数据库采用自己的 schema 版本和迁移记录，不占用 core MIGRATIONS 版本；核心库仅在确需持久事件接缝且现有事件不足时另行新增迁移，并先检查版本占用。

建议普通表：

1. `index_meta`：schemaVersion、libraryId、生成格式、增量对账位置。libraryId 不匹配时拒绝复用；克隆/导入重新分配资产身份时走既有 ID 映射或重建。
2. `embedding_profiles`：稳定 profileId、模型/服务语义身份、权重 revision、维度、预处理/模板/池化版本、模态和距离规则、启用状态。不能只用本机 serviceId；端点/模型语义变化需新 profile。凭据、个人绝对路径不入库；敏感端点不存原文，只保存一致性指纹和本机配置引用。远端服务无法提供可靠权重 revision 时，记录验证指纹并允许用户显式使 profile 失效；同名远端模型被服务端替换不能被宣称自动可检测。
3. `asset_embeddings`：profileId、assetId、sourceRevision、dimensions、vector BLOB、updatedAt。主键 `(profileId, assetId)`，保留当前每资产每 profile 一条向量的行为。
4. `embedding_jobs`：profileId、assetId、预期 sourceRevision、状态、尝试次数、可重试时间和脱敏错误类别。同一目标去重；失败不会被误计为 ready。
5. `legacy_imports`：旧文件内容摘要、profile 映射、接受/拒绝行数、完成标记，用于断点恢复和防重复迁移。

BLOB 明确为 IEEE Float32、小端编码，数据库使用 `typeof(vector)='blob'` 与 `length(vector)=dimensions*4` 等不依赖扩展的约束；Worker 检查维度、有限数、非零范数与归一化。维度由 profile 决定，不硬编码为 Gemma 的 768。调用原生扩展前检查宿主字节序；扩展直接读取宿主 float 布局时需 native 格式适配。未来设备架构字节序不同需要显式转码，不依赖宿主 TypedArray 默认格式。

模型文件和 API 密钥继续为设备级数据；携带向量不携带认证或远端授权。跨设备 profile 无法可靠匹配时，可保留数据但不混用或调用服务，待用户配置一致模型。

容量估算（单向量、仅向量正文，不含页/索引/job/WAL）：768 维每条 3072 字节；2 万条约 58.6 MiB，10 万条约 293 MiB，100 万条约 2.86 GiB。多 profile 按条数相加。不是性能或磁盘占用实测。

## 5. 写入、生命周期和一致性

- Worker 以有界分页选出待编码目标；准备图片、缩略图、文档或音频输入。推理层接收校验过的输入，不能让 Renderer 获得路径/SQL，不能继续让 Main 扫库或任意读取资产文件。
- 复用 Main 的 provider 调度、认证与模型进程生命周期；文件准备转回 Worker。IPC 有输入大小上限，不把整库向量或大文件无限 base64 传输。具体媒体输入接缝在实施时基于当前 typed protocol 拆独立模块。
- 编码不占写事务。回传后 Worker 再核对 library generation、profile、授权/启用状态、资产存在和当前 sourceRevision；过期结果丢弃。
- 小批量 UPSERT 和 job 完成状态同事务提交。初始可探索 32–128 条或约 250ms 的提交间隔，按本地/网络盘 fsync 测量调节，不是已证明最优值。关闭时停止领取任务、提交已完成批次、关闭连接；中断 job 重启后回 pending。
- 资产内容变化使旧向量失效，元数据变化仅在确实参与 embedding 输入时重算；文本标题/内容、thumbnail artifact、音频处理策略均纳入 sourceRevision。不能把 rating/tag 的无关变化等同为重新编码。
- 删除资产在查询时立即排除，索引后台删除；恢复时同 revision 可复用。查询候选必须来自实时 core 资产状态，不信任 sidecar 里旧 ID。永久删除后清理向量/jobs，失败有可见重试，不留下静默残留。
- 同库旧版本软件不会写新队列，因此启动及关键目录变化后需分页对账真实资产 revisions/删除状态。对账不阻塞主界面，不以一次全量同步扫描为开库前置条件。
- 同一 Worker 拥有两库；不宣称跨库事务原子提交。通过写前核验、读时排除、幂等补算和完整重启对账收敛。查询结束前检查库/目录版本，变更时丢弃过期结果并调度最新请求。

## 6. 查询与性能

1. 在 provider 层生成 query embedding，缓存仅限当前会话且包含 profile 和授权身份；不持久化用户查询原文。
2. Worker 复用普通搜索的范围与过滤构建器，先确定合法候选，再进行向量距离计算。禁止先全库取 Top-K 再丢弃不符合条件的项，这会漏掉真正的范围内 Top-K。
3. 初期普通表 JOIN 或候选 ID 临时表分块扫描。距离函数路径与 Float32 fallback 使用相同归一化/维度和 `score = 1 - cosineDistance` 语义；相同 score 以 assetId 稳定排序。
4. 查询不一次性把整个库 BLOB 转为 JS number[]。扫描批次之间让出 Worker 事件循环并检查取消 token，避免搜索拖慢删除/浏览。批次预算需要测量；同步 SQLite 一条巨型 ORDER BY 不能被写作天然可取消。
5. 结果会话保存 ID/score 与目录版本，复用现有 progressive browse 接缝。保持可浏览全结果，不把现有搜索静默改成只能看前 100 条。第一次稳定的全候选排名完成后发布首屏，后续分页；索引新提交时按最新请求更新，禁止混用不同 query/profile 的 cursor。
6. 正确性基准使用精确 cosine。Float32 与 JSON number 转换可能有微小数值差异，需测定容差和近似并列次序，不承诺 bit-for-bit 一致，也不得因此重新引入分数校正。

性能验证计划：现有 20,000 资产基线，追加 100,000 和 1,000,000 向量的独立检索测量；覆盖 768 及 API 常见高维、冷/热查询、强过滤、并行补算和低内存。分别记录 provider 查询向量时间、Worker 排名时间、IPC/渲染时间及总时间。目标为 2 万规模稳定首屏约 1 秒；远端 API/冷模型耗时另列，不能保证外部服务延迟。

如果精确路径不能满足基线，先评估 vec0 的内存/过滤正确性，再评估 ANN。ANN 必须有真实查询及精确 ground truth 的 recall@K、过滤后 recall、重建成本证据，不能只按资产数直接切换。

## 7. JSON 迁移与恢复

- 首次打开库启动后台一次性迁移，先停止该库旧 JSON 写者，新 SQLite 路径不再写 JSON。Worker 从固定、可信的旧缓存根按库与 profile 读取；不能开放 Renderer 任意路径读取能力。
- 按旧 profileKey 映射可信 profile；核对 assetId、当前 sourceRevision、维度和有限非零向量。无法识别、旧版本或损坏条目计数并进入重建，不混入当前索引；HTTP 旧 JSON 缺维度强校验的问题在迁移处补齐。
- 大 JSON 使用有界流式解析和小批量事务；先预检库目标盘空间，考虑 SQLite/WAL/journal 峰值与多 profile。未知格式或空间不足保持源文件，明确显示未迁移原因。
- 幂等导入，SQLite 提交完成标记后完整关闭重开核对行数/内容摘要。成功且确认源属于应用旧缓存、无其他写者时删除对应旧 JSON 和旧 partial；失败时保留原缓存供恢复，不触碰其他库或用户文件。
- 外部 API 缺失项的自动重新请求需要沿用库授权和用量边界；不能把索引损坏恢复变成未经用户知情的大量付费请求。
- 语义 DB 损坏单独报告和重建，不把它当作核心 library.db 损坏触发元数据抢救。重建的临时文件需空间预检、成功/失败清理及启动时回收；无法清除的残留必须提示并提供重试入口。
- 仅语义派生数据可重建，core 资产数据绝不删除重建。索引缺失不阻塞普通库功能。

## 8. 网络盘、备份与打包

- 复用现有库 storageKind 判定：确认本地盘可用 WAL，网络/未知盘按既有策略 DELETE + FULL。SQLite WAL 官方不支持不同主机经网络文件系统共享；不能“为了速度”统一启用 WAL。[WAL 约束](https://www.sqlite.org/wal.html)。
- 随库复制/导出需要登记新增 sidecar。应用内活动库备份使用 SQLite backup API 或已有可靠关闭/快照流程，不能仅复制 .sqlite 忽略未 checkpoint 的 WAL。[Backup API](https://www.sqlite.org/backup.html)。模型权重/认证仍不随库导出。
- 默认完整库导出包含已提交向量；导出格式没有覆盖新 sidecar 前不能宣称携带索引。用户选择轻量导出时应明确索引会重建。
- 扩展仅从应用内置、锁版本并校验哈希的 native 资源路径加载；不从资源库/user plugin 路径执行动态库。macOS arm64 与 Windows x64 的 Forge ASAR 解包、签名和运行时加载都需实测；Node 测试成功不是 Electron packaged 证据。
- 发布前核对 sqlite-vec 自身许可证与实际随包依赖声明；不默认 alpha DiskANN 可进入稳定版。

## 9. 实施拆分与估算

| 阶段 | 交付 | 难度/工程估算 |
| --- | --- | --- |
| A | 扩展锁版、目标平台加载验证、普通表查询及 filtered baseline 方案验证 | 中，1–2 工程日 |
| B | Worker 独立 SQLite、profiles/vectors/jobs、版本核验、磁盘生命周期 | 中高，3–5 工程日 |
| C | 本地/API provider 统一接入、渐进查询及取消、旧 JSON 迁移 | 高，3–5 工程日 |
| D | 真实重启、损坏/迁移失败、性能、Windows/macOS packaged 证据收口 | 高，2–4 工程日 |

总估算约 9–16 工程日，依据当前边界粗估，非承诺工期；平台 runner 缺失需另列阻断。可并行调查，不使用 worktree；实现轨道串行交接。

全部阶段仍保留精确检索；ANN 不是上述估算范围。A 的能力/性能验证未通过时回到选型，不带着未经验证的引擎结论继续正式化。

## 10. 验收计划（尚未执行）

| 需求 | 拟实现位置 | 拟自动化证据 | 拟真实/平台证据 |
| --- | --- | --- | --- |
| SQLite 取代 JSON | Worker 新 semantic-index 模块 + 库布局 | BLOB/约束、批次事务、磁盘失败单测/集成 | 编码后无新 JSON；重开库向量复用 |
| 无过期写入/结果 | job 与 query controller + typed protocol | 切库、模型变更、revision 改动、授权撤回、取消竞态 | 补算中编辑/删除/切库，结果不串库 |
| 过滤准确/分页完整 | 复用 catalog filter 与 search sessions | 范围内精确 Top-K、组合过滤、并列与全结果分页 | 文件夹/标签/合集搜索与找相似 |
| 旧缓存无损迁移 | legacy import + 独立 schema | 中断重启、异常行、profile/维度冲突、重复导入 | 旧索引迁移后完整退出重启复用 |
| 核心库独立可用 | availability 与恢复接缝 | 完整 test:library-availability | 索引损坏时库仍可打开写入与普通搜索 |
| 性能和打包 | benchmark + native resources | 20k baseline、10万/百万向量测量 | 两平台当前 HEAD packaged、真实 Electron 解码/搜索 |

实现阶段需同步受影响测试，运行资源库可用性、真实 Electron 核心旅程与最终 verify:mainline；后台串行，不抢前台。当前仅方案，不运行测试、不登记待人类验收，也不关闭功能工单。

## 11. 需同步的旧文档

ADR-0011 仍写 MVP 不存向量，与 dev 现有产品行为不一致。实施前应以本方案与用户确认结果更新/替代该 ADR，领域模型补充 profile/index/job 与派生数据关系；当前不把未批准提案标为已接受架构决定。
