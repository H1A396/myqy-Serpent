# SQLite 向量检索引擎选型调研

调研日期：2026-10-13。范围：官方文档、固定版本源码、GitHub Release API 与 npm registry；本轮未安装依赖、未运行测试或基准，也未验证 Serpent packaged 应用。

## 建议

建议由 Library Worker 管理资源库内独立 SQLite 文件，以普通表中的 Float32 BLOB 保存完整向量与空间身份。第一阶段使用 **sqlite-vec 0.1.9 的标量距离函数**，对当前目录、合集、标签、资产状态等条件共同确定的候选集合做精确检索。该路径有官方普通表示例，也与现有 better-sqlite3 集成方式一致；`vec0`、HNSW、DiskANN 可作为后续可重建加速层。选择独立文件属于 Serpent 的架构建议，官方资料不替项目证明跨库一致性或性能。[普通表精确检索](https://alexgarcia.xyz/sqlite-vec/features/knn.html#manually-with-sql-scalar-functions)、[better-sqlite3 集成](https://alexgarcia.xyz/sqlite-vec/js.html#node-js)。

这个建议优先保证结构化过滤后的 top-k 正确性、模型/维度演进与库格式可读性。是否能满足大库延迟预算需要后续按项目基线测量，不能从上游不同负载的性能数字推断。

## 当前发布状态

| 引擎 | 可钉死的正式发布 | 较新版本与成熟度 | 检索方式 |
| --- | --- | --- | --- |
| sqlite-vec | **v0.1.9，2026-03-31**；GitHub `prerelease=false`、npm `latest=0.1.9` | **v0.1.10-alpha.4，2026-05-18**；npm `alpha`，仍是预发布；项目整体为 pre-v1 | 0.1.9 的 `vec0` / 标量距离为精确扫描；0.1.10 alpha 新增 DiskANN、rescore 与实验性 IVF，不能把 ANN 当正式版能力 |
| vectorlite | **v0.2.0，2024-08-19**；GitHub `prerelease=false`、npm `latest=0.2.0` | README 仍称 beta；在线文档标题为 0.3.0，但查询到的 Release/npm 未发布该版本 | HNSW 近似检索；另有标量 `vector_distance()` 可用于精确扫描 |

以上同时核对 [sqlite-vec Release](https://github.com/asg017/sqlite-vec/releases)、[Release API](https://api.github.com/repos/asg017/sqlite-vec/releases)、[npm 元数据](https://registry.npmjs.org/sqlite-vec) 与 [vectorlite Release](https://github.com/1yefuwang1/vectorlite/releases)、[Release API](https://api.github.com/repos/1yefuwang1/vectorlite/releases)、[npm 元数据](https://registry.npmjs.org/vectorlite)。vectorlite 的 beta 描述见 [README](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/README.md)，文档标题差异见 [官方文档首页](https://1yefuwang1.github.io/vectorlite/)。实施前再次核对并锁定完整版本与二进制摘要。

## 维度、距离与过滤

| 项目 | sqlite-vec 0.1.9 | vectorlite 0.2.0 |
| --- | --- | --- |
| 向量布局 | `vec0` 列固定元素类型与维度，支持 float32/int8/bit；普通 BLOB 表可按空间保存不同维度 | 每张虚拟表单一向量列，固定维度；此版本源码仅支持 float32 |
| 维度上限 | `vec0` 明确上限 **8192**，因此 768 与 4096 都可用；该常量不是普通 BLOB 表/标量函数的统一维度上限 | 解析器要求维度大于 0，未见与 8192 相同的显式上限；这不构成无限维度/内存保证 |
| 距离 | `vec0` float32 默认 L2，可设 cosine；普通表可调用 `vec_distance_L2/L1/cosine` | `l2` 为平方 L2，另有 cosine 与 inner product；不能不经换算复用另一引擎的 L2 阈值 |
| 过滤入口 | `vec0` 支持内部 metadata、partition key 与 rowid `IN`；普通表允许既有 SQL 候选集合与关系查询 | 基于 `rowid =` / `rowid IN` 的索引过滤；需 SQLite ≥3.38，并将 rowid 集合传给 HNSW |
| 精度 | 对同一空间、完整有效候选集进行精确扫描，可得到该集合的精确 top-k | 即使过滤被推入 HNSW，结果仍近似；提高 `ef_search` 不构成必然完整召回保证 |

sqlite-vec 的维度常量与过滤实现以 [v0.1.9 源码](https://github.com/asg017/sqlite-vec/blob/v0.1.9/sqlite-vec.c#L3483) 为准；vectorlite 的类型/维度/距离以 [v0.2.0 vector_space.cpp](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/vectorlite/vector_space.cpp) 为准，平方 L2 见 [vector.cpp](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/vectorlite/vector.cpp)。HNSW 过滤与调参来自 [vectorlite 官方说明](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/README.md) 和 [Node 示例](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/bindings/nodejs/packages/vectorlite/README.md)。

`vec0` 的内部 metadata 并不等于 Serpent 完整的过滤语言：最多 16 个 metadata 列；auxiliary 列不能用于 KNN 过滤；partition 最多 4 个且过细分区会降低效率。文档列出比较操作并警告 `LIKE`、`GLOB`、`IS NULL`、标量函数等不适合直接下推。**文档已落后于 0.1.9：固定版本源码还支持 INTEGER/TEXT metadata 的 `IN`，但 FLOAT/BOOLEAN 的 `IN` 报错。**不应因文档遗漏而声称完全不支持 `IN`，也不能据此承诺任意 SQL 条件均可下推。[vec0 官方说明](https://alexgarcia.xyz/sqlite-vec/features/vec0.html)、[metadata IN 实现](https://github.com/asg017/sqlite-vec/blob/v0.1.9/sqlite-vec.c#L5689)。

### 过滤必须发生在 top-k 截断之前

假设全库最近的 20 项都在目录 A，用户正在目录 B：先全库取 20 项、再与 B 取交集会返回空，即使 B 内有大量匹配向量；扩大固定倍数 k 仍不能一般性保证正确。这是查询语义推导。

正确路径是先复用目录/合集/标签/回收站等现有条件确定全部有效候选 ID，再对**该集合**计算距离并排序截断。普通 BLOB + 标量函数允许关系过滤在 SQL 中表达；`vec0` 使用其实际支持的 rowid `IN` 下推，vectorlite 则将相同集合传入 HNSW。仅在 KNN 外层 `JOIN/WHERE` 过滤不是同一保证；具体 SQL 和 planner 行为仍需后续固定版本测试。[sqlite-vec rowid IN 查询计划](https://github.com/asg017/sqlite-vec/blob/v0.1.9/sqlite-vec.c#L5464)、[vectorlite constraint 实现](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/vectorlite/virtual_table.cpp#L339)。

候选集合还必须匹配向量的空间身份与资产内容修订。相同维度不代表可比较；provider/model/version、输入模态和预处理、维度、距离及归一化约定需要进入空间身份。ANN 候选可重排，但重排无法补回 HNSW 未召回的候选。小候选集或需精确结果时保留精确路径。这些是本项目的设计建议。

## 持久化与跨平台格式

**vectorlite HNSW 不应承担 canonical 数据。**其 v0.2.0 虚拟表注册中 `xBegin/xSync/xCommit/xRollback/xSavepoint/xRollbackTo` 均为空；可选索引文件在 `xDisconnect` 保存。因此不能推导出“SQLite 事务回滚同时回滚图索引”或“提交后崩溃不会丢索引更新”。应保留普通表完整向量，将 HNSW 文件标为可丢弃、可重建并管理代次。[事务回调源码](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/vectorlite/vectorlite.cpp#L17)、[保存时机源码](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/vectorlite/virtual_table.cpp#L224)。

**独立向量 SQLite 与主目录库也需要对账协议。**SQLite 明确说明 WAL 下多 attached database 的提交只保证各文件单独原子；主机在跨文件 commit 中崩溃时可能出现部分文件已更新。不要以单个 `ATTACH` 事务宣称跨文件崩溃原子性。建议用资产内容修订与空间/任务代次校验，查询拒绝陈旧向量，并通过持久任务记录与重建恢复；数据库与索引均放在资源库内，保存相对位置。[SQLite ATTACH 原子性说明](https://sqlite.org/lang_attach.html#details)。

**BLOB 应定义自己的字节格式。**sqlite-vec 0.1.9 把 BLOB `memcpy` 到本机 float32 缓冲区；vectorlite 0.2.0 直接将字节解释为 `float*`。两者都不能证明自动处理不同字节序。建议 canonical 格式固定为 IEEE 754 Float32 little endian，普通表用 `BLOB` 与 `length(blob)=4*dimensions` 检查，Worker 校验有限数值、维度和空间身份；避免把扩展函数放入 canonical schema 的 CHECK，使扩展不可用时数据库仍可打开和迁移。实现可用 `Buffer.writeFloatLE/readFloatLE`，启动时通过 `os.endianness()` 检查原生函数适配条件。目标平台的具体二进制仍需运行验证，未来 BE 平台需转换适配。[sqlite-vec BLOB 读取](https://github.com/asg017/sqlite-vec/blob/v0.1.9/sqlite-vec.c#L700)、[vectorlite BLOB 读取](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/vectorlite/vector_view.cpp#L15)、[Node Buffer](https://nodejs.org/docs/latest-v24.x/api/buffer.html#bufwritefloatlevalue-offset)、[Node 字节序](https://nodejs.org/docs/latest-v24.x/api/os.html#osendianness)。

## Node、许可证与发布打包

两者都通过 SQLite loadable extension 接入现有 better-sqlite3。sqlite-vec 官方使用 `sqliteVec.load(db)`；vectorlite 使用 `db.loadExtension(vectorlite.vectorlitePath())`。扩展本身是 SQLite 共享库/DLL，不是 `.node` addon；better-sqlite3 的 Electron Node ABI 重建要求仍单独适用，且扩展必须与驱动内置 SQLite API 兼容。[sqlite-vec Node](https://alexgarcia.xyz/sqlite-vec/js.html)、[vectorlite Node](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/bindings/nodejs/packages/vectorlite/README.md)、[SQLite 扩展加载](https://sqlite.org/loadext.html)、[better-sqlite3 loadExtension](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#loadextensionpath-entrypoint--this)。

sqlite-vec 为 **MIT / Apache-2.0 双许可**，vectorlite 为 **Apache-2.0**；发布应保留选定许可及实际打包依赖的 notices，不根据主项目 MIT 推断二进制依赖也为 MIT。[sqlite-vec MIT](https://github.com/asg017/sqlite-vec/blob/v0.1.9/LICENSE-MIT)、[Apache](https://github.com/asg017/sqlite-vec/blob/v0.1.9/LICENSE-APACHE)、[vectorlite LICENSE](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/LICENSE)。

| 发布检查点 | 官方资料确认 | Serpent 后续验收 |
| --- | --- | --- |
| Windows x64 / macOS arm64 | sqlite-vec 0.1.9 Release 具有 windows-x86_64 / macos-aarch64 loadable assets；npm 有 `sqlite-vec-windows-x64` / `sqlite-vec-darwin-arm64`。vectorlite 0.2.0 Release 具有 win_amd64 / macos arm64 wheel，npm 平台包为 `@1yefuwang1/vectorlite-win32-x64` / `vectorlite-darwin-arm64` | 验证安装和离线启动实际带上对应平台库；上游有文件不等于本项目已通过 |
| ASAR 与本地加载 | SQLite 使用系统共享库加载；Electron ASAR 是虚拟文件系统，部分原生路径操作需要真实文件 | 显式打包到应用资源或 `app.asar.unpacked` 并解析真实路径；不能只依靠 `.node` 自动解包规则覆盖 `.dll/.dylib/.so` |
| 版本和签名 | sqlite-vec Release 提供 checksums；驱动要求扩展 SQLite 版本兼容 | 钉死版本/摘要，检查 arch、依赖库及 macOS 签名；UtilityProcess 中执行扩展版本与合成向量距离探针；跨重启、缺扩展/坏索引恢复与过滤正确性需实际验证 |

平台资产与 npm 包核对来源为前述 Release API / registry；vectorlite 平台选择器另见 [固定版本 loader](https://github.com/1yefuwang1/vectorlite/blob/v0.2.0/bindings/nodejs/packages/vectorlite/src/index.js)，ASAR 要求见 [Electron 官方资料](https://www.electronjs.org/docs/latest/tutorial/asar-archives#adding-unpacked-files-to-asar-archives)。打包探针、性能、Windows/macOS 运行与崩溃恢复均为**未执行**；本轮只有资料与源码证据，没有实现完成或产品验收结论。
