# EmbeddingGemma 2 实验与通用 Embedding 模型接入方案

2026-10-11 补充：[通用模型协议、资源库绑定与资产找相似详细方案](../implementation/embedding-providers-and-find-similar.md)。该文细化适配器/模型配置分离、云端与自定义服务、稳定查询会话和资产右键找相似；找相似 P1 工单为 `Serpent-7skmn`。均属设计，不表示功能已经落地。

- 日期：2026-10-10
- 状态：阶段 1 实验 CLI 已实现，并有 Windows CPU 合成样本证据。阶段 2 已开始：设置 → AI 可以在本机登记三档 GGUF，尚未做能力探测、云端 adapter、库绑定或语义索引。
- 目标：先让产品负责人用小型图片语料比较 EmbeddingGemma 2 的三档 GGUF；随后按本文阶段接入本地/云端模型、图像/视频/音频语义通道和资源库级模型绑定及重建。首轮实验不写生产语义索引。
- 背景：[图像 embedding 模型研究](2026-10-10-image-embedding-models.md)、[ADR-0011](../adr/0011-defer-vector-search.md)。

## 结论

按阶段交付：先以隔离实验面板验证三档 GGUF 的图像检索和运行时；再完成通用模型/provider 管理与多模态能力验证；最后为每个资源库绑定 profile，并以可恢复、可取消的派生索引重建实现切换。实验只读用户选择的小样本，不写资源库数据库或生产索引。正式阶段旧索引保持可用，直到新 profile 的索引完成并原子切换。

以用户指定的 [Unsloth GGUF 仓库](https://huggingface.co/unsloth/embeddinggemma-2-GGUF)为准，仓库提供的三档是 `UD-Q4_K_XL`、`Q8_0` 和 `BF16`。官方模型卡明确不建议 F16：该模型可能在 F16 下输出 NaN 或静默退化。因此本方案把 BF16 作为 16-bit 基线，不把同为 16-bit 的 F16 当作有效对照。

llama.cpp 已合入 `gemma-embedding2` 模型支持。此前 issue 的报告者后来确认，最初的图片请求结构错误；改用 `/v1/embeddings` 的嵌套 `input[].content[]` 后，已在同一构建上验证不同图片会得到不同向量，并完成小样本文找图。我们的三个权重组合、目标平台和打包版本仍须分别复测；GGUF 能加载、文本向量能返回或 HTTP 200 都不足以单独证明图像 embedding 可用。若正确请求在目标构建中失败，再评估 libmtmd helper。

## 权重组合与空间预算

HF 页面显示的单文件大小为近似 MB。文件均在 Unsloth 仓库的上传提交 [`412430755667d84b1ac64fe1fe2693aa6219f1d9`](https://huggingface.co/unsloth/embeddinggemma-2-GGUF/commit/412430755667d84b1ac64fe1fe2693aa6219f1d9) 中；下载时应固定这个 revision，并保存文件 SHA-256，不用可移动的 `main` 作为模型身份。

| 面板档位 | 模型文件 | 多模态投影文件 | 估算下载量 | 展示名称 |
| --- | --- | --- | ---: | --- |
| 4-bit 级 | `embeddinggemma-2-UD-Q4_K_XL.gguf`（176 MB） | `mmproj-Q8_0.gguf`（555 MB） | 731 MB | Q4_K_XL 核心 + Q8_0 多模态投影 |
| 8-bit | `embeddinggemma-2-Q8_0.gguf`（310 MB） | `mmproj-Q8_0.gguf`（555 MB） | 865 MB | Q8_0 核心 + Q8_0 多模态投影 |
| 16-bit 基线 | `embeddinggemma-2-BF16.gguf`（558 MB） | `mmproj-BF16.gguf`（982 MB） | 1,540 MB | BF16 核心 + BF16 多模态投影 |

按用户最终选择，使用现成权重，不自行量化。Q4 与 Q8 可以共用一份 Q8 投影文件；三档核心文件加 Q8、BF16 两份投影的去重下载总量约 2,581 MB（约 2.58 GB），还不含运行时和实验输出。Unsloth 当前仓库没有 Q4_K_M，也没有 Q4 多模态投影。`UD-Q4_K_XL` 是该仓库实际提供的动态量化 Q4 档；UI 和报告须保留量化类型及核心/投影分项，不能写成所有权重均为 4-bit。

为单独观察核心量化的影响，可增加可选对照：Q4 核心 + BF16 投影、Q8 核心 + BF16 投影。它们复用 BF16 档已下载的投影文件，不增加下载体积。主档位比较的是实际成套配置，质量差异同时可能来自核心和投影量化，报告不得把差异全归因于核心权重。

## 模态、profile 与比较边界

Google 模型卡声明 EmbeddingGemma 2 将文本、图像、视频、音频映射到共享 768 维空间，使用 mean pooling 和 512→768 投影；音频建议单声道 16 kHz，视觉 token 默认预算为 280，视频默认按 1 FPS 采样。这只是模型声明/参考预处理，不能证明某一 GGUF、mmproj 或 llama.cpp 运行路径实现了每种模态或完全遵循相同预算。上游已有图像成功证据；我们的三档图像路径以及本地音视频路径仍待验证。能力状态必须分别展示“模型/服务声明”和“当前 adapter + runtime 已验证”，用户勾选不能赋予模型能力。

- 文本/图像检索：EmbeddingGemma 2 的文本查询使用 `task: search result | query: {query}`；文本语料使用 `title: {title} | text: {content}`（无标题时 `title: none`）；图片不加前缀。文本-only profile 不得提供图像检索。
- 视频视觉通道：优先验证模型/adapter 的原生视频输入。否则，仅当 profile 已验证 image capability 时，才可复用 Worker 的 FFmpeg 抽帧底层能力，按固定上限均匀抽取帧、保留时间戳，以 profile 固定的聚合策略形成视频表示。该模式必须标为“抽帧视觉检索”：只能检索画面，不理解连续运动或声音；不可使用 `video-input.ts` 的 contact sheet 作为 embedding 输入。建议 profile 固定最多 32 帧并对帧向量做归一化均值，避免 max pooling 对长视频产生偏置；native adapter 可有自身采样，但也须版本化并验证。
- 音频通道：独立验证原生音频 embedding。EmbeddingGemma 2 模型卡建议输入转单声道 16 kHz，提供音频 token 预算，但不能据此认定 GGUF 的 mmproj 支持音频。视频音轨不随抽帧视觉通道隐式处理；只有启用并验证 audio-capable adapter 后才可单独抽取/编码音轨。若未来提供 ASR 转录+文本 embedding，必须显示为转录文本通道，不得标作原生音频理解。
- Google Gemini Embedding 2 云 API 官方支持文本、图片、视频、音频和 PDF 的统一 embedding 接口；但视频音轨不会被处理，视频最多 120 秒/32 帧（短视频按 1 FPS，长视频均匀抽帧），独立音频最长 180 秒。云端多模态输入通常不加文本 task 前缀；文本检索仍按文本 query/document 模板。OpenAI `/v1/embeddings` 的输入是文本/token，不作为通用多模态 adapter。各云 provider 的请求格式、输出聚合、限额、费用和隐私行为单独实现与声明，不能套用一个“统一 embeddings endpoint”。
- `visual`（图像及视频画面）和 `audio` 是独立检索 channel。单 channel 内只比较相同编码 profile 的向量；跨 channel 或跨 profile 不得假定 raw cosine 可比。联合检索首版固定使用 Reciprocal Rank Fusion（RRF，`k=60`），每个 asset 在每个 channel 只保留最佳名次后按 `1/(60+rank)` 求和并按 asset 去重；策略版本写入搜索配置，分别保留各 channel 命中与视频时间戳。
- 输出必须通过 profile 对应的维数、有限值和非零范数检查。EmbeddingGemma 2 使用 768 维；其他模型维数及归一化规则由 adapter 声明。不同 profile 不混写向量或比较 cosine。

Embedding profile 记录 provider/model revision、权重哈希和量化（本地 core 与 mmproj 分开）、runtime 完整 commit、channel、pooling/输出维度、提示模板、各模态输入预处理/采样/聚合版本、归一化。编码语义改变生成新 profile version；能力验证状态、设备、运行时间、耗时另存运行记录。rank-fusion 属于检索配置并独立版本化，只改融合排序不重算向量。媒体缓存按内容哈希失效。Gemma 图片预处理不可无条件复用 `src/worker/ai/image-input.ts` 的 JPEG85/最长边 2048 策略；任何缩放/色彩/解码步骤必须显式版本化，三档实验需一致。

## 运行时准入：先证实图片路径

### 1. 固定并复测 llama.cpp

llama.cpp PR [#30054](https://github.com/ggml-org/llama.cpp/pull/30054) 于 2026-10-06 合入 `gemma-embedding2` 架构支持。[#30082 报告者的更正](https://github.com/ggml-org/llama.cpp/issues/30082#issuecomment-3380876794) 给出可用请求结构：`{"model":"embeddinggemma-2","input":[{"content":[{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}}]}]}`。报告者在同一 `b11457` 构建上测出不同图片向量及文找图结果。原报告中 `/embedding` 的 `image_data` 被忽略仍提醒我们不要把未知字段的 HTTP 200 当作有效图片编码；实现应只使用已验证的请求路径。

实施者先检出并记录完整 llama.cpp commit（不得跟随浮动分支），在 CPU 路径至少依次验证：模型和配套 mmproj 能加载；文本 query 返回 768 维有限向量；一张图片返回 768 维有限向量；不同内容图片的输出随内容变化；无图片输入不得与图片向量伪装成成功的同一结果。Q4/Q8/BF16 每档都跑同一组检查。保存命令、提交 SHA、平台和原始诊断。

### 2. HTTP 失败时做原生 helper spike

如果固定版本的 HTTP embeddings API 不满足上节准入条件，评估由独立原生 helper 直接调用 llama.cpp/libmtmd，将图片送入 EmbeddingGemma 2 视觉编码路径，按模型架构得到单个 768 维 mean-pooled embedding，再输出带 schema/version 的 JSON 向量。GGUF + mmproj 可加载不代表这条路径已经存在；当前没有证据证明 libmtmd 已提供现成的图像 embedding API，所以把它列为 spike，而非承诺能力。

Spike 的退出条件：三档核心权重和相应投影均能在目标设备加载；helper 能分别返回真实文本 query 和图片向量；图片输入经解码和编码后明确使用视觉 encoder；不同图片能产生内容相关的不同向量；与官方 BF16 路径的输出维度、有限值、pooling 口径一致；重复运行确定性足以比较检索排序；CPU/GPU 和 Windows/macOS 构建边界已记录。若做不到，先停在技术阻断结论，不交付只对文本有效的面板，也不切换成其他权重格式来冒充三档 GGUF 验收。

## 阶段 1：三档 GGUF 图片实验

通过运行时准入后，首轮使用独立实验工具与本地结果页面，用户显式选择小型图片样本，不访问资源库内部路径；阶段 1 只评估静态图像的文找图、图找图。视频和音频属于后续正式模型/channel 能力，不能因首轮只测图像而从产品计划中排除。若实验以后进入应用，资产读取仍由 Library Worker 持有，推理 helper 不绕过 Worker 访问文件。隔离在专用模块中，不扩展现有 `ai/protocol.ts` 的描述/标签/评分契约，也不把 embedding 混入 `ai_content`。

1. 用户选择一个小型图片目录或文件集、独立的文本查询和可选查询图片，并选择一个本地模型/缓存目录。面板只读取该批输入，不扫描整个资源库。
2. 下载前显示当前档位和预计字节数，预检用户选定卷空间；三档按顺序加载、编码各自语料和查询、完成 Top-K 后卸载，再运行下一档，避免三个模型并驻内存。
3. 结果并排显示每档的匹配缩略图、文件名、档内 cosine、Top-K 顺序；同时显示载入时间、单图编码时间、查询编码时间、总耗时、峰值/进程内存（能可靠取得时）、runtime commit 和 profile。明确报出跳过格式和失败原因。
4. 首轮建议语料 20–100 张用户自选的代表性静态图；查询应包含若干文本描述和至少一张不在语料中的查询图片。评价维度包括中文/英文文找图、题材/对象/构图描述、相近风格但不同主题、重复/近似图、图找图。用户可按同一查询检查三组 Top-K；结果文件名和相对排序可导出用于反馈。

运行时由隔离 helper 管理，不在 Renderer 中加载模型，也不阻塞 Library Worker。保持现有边界：Renderer 通过 Zod 校验的 typed command/event 发起试验；Main 负责进程生命周期和目录选择；helper 只访问用户明确选中的媒体、模型目录与实验目录，不持有数据库连接。可参考 `src/main/script-runtime-supervisor.ts`、`src/main/disk-free-space.ts`、`src/main/native-dialogs.ts`、`src/preload/bridge/library.ts` 的模式，落地前确认具体 API 可复用。

模型权重和向量缓存写入用户明确选定的本地目录，不默认写进资源库、系统盘临时目录或安装包。测试输出仅放入这个目录下的应用拥有子目录，manifest 使用本次运行 ID 和相对样本名。下载与生成过程失败时在同一生命周期清理临时文件；已有模型作为用户选择的缓存保留，并提供明确的“清除此实验数据”入口。删除失败必须显示路径类别、失败原因和重试动作。写入前按选中档位检查空间；若用户计划跑全套，提示约 2.58 GB 权重加输出空间，不能静默下载。

## 正式产品接入：模型管理、库绑定与索引生命周期

### 全局模型配置和资源库绑定

全局“设置 → AI → Embedding 模型”提供添加、编辑、测试、停用、删除和设为默认，不在此处切换当前资源库。列表显示名称、本地/云端、模态和可用状态。本地配置包含运行时、核心权重与配套文件；云端配置包含 embedding 协议/provider、端点、模型 ID、凭据引用和输出维数。更换云端端点也必须重新确认服务身份及上传授权，不能默认视为等价代理。模态开关表示允许使用的能力上限，库设置从中选择本库需要的模态；未验证能力显示原因并禁用。已有绑定固定版本，全局编辑产生新版本供各库主动选择。仅增加模态可复用编码契约未变的现有通道并补建新增部分；减少模态停用对应通道，不强制重算其他向量。

默认模型用于新库首次启用语义索引时预选；默认指向云端也不能未经确认自动上传。库可明确选择“关闭语义索引”。资源库保存可移植的模型身份/profile 快照及索引代次，不保存本机模型绝对路径或密钥；设备级注册表映射到实际模型文件和凭据。库换电脑后若无法解析原 profile，显示“需要配置此模型”，保留索引与普通搜索，不自动换成另一模型重建。

- 复用全局设置入口 `src/renderer/AppSettingsPages.tsx` / `src/renderer/app-settings-sections.ts` 管理本地模型目录和默认 profile；默认值只用于新建库或尚未绑定 profile 的库初始化，不是所有库的活动模型。已绑定库保持稳定。修改默认模型或全局模型的编码语义不隐式切换/重建已绑定库。
- `src/renderer/LibrarySettingsDialog.tsx` 管理当前库实际使用的本地/云端模型、channel/modality 配置、active profile 和显式提交的 pending profile。单库只有一个 active 和最多一个待切换 profile；未完成重建时查询继续使用 active。用户选择“应用到此库”后才启动该库的索引任务。云端 provider 凭据按设备保存和加密，不进入 library.db；可在设备级 provider 配置中管理，按 `src/main/index.ts` 的 Electron `safeStorage` 模式实现。凭据轮换本身不改变向量语义，不触发重建。
- 每种 modality 同时显示模型/provider 声明能力与该具体 adapter/runtime 已验证能力。只有 verified capability 可用于配置。EmbeddingGemma 2 的模型声明不能代替本地 GGUF/mmproj 逐模态验证。OpenAI 文本 embedding 只能配置 text；Gemini Embedding 2 可作为官方多模态云 adapter 候选，必须对实际支持的图像、视频和音频输入分别做 contract/live smoke。删除模型时列出仍绑定它的库，用户须先明确替换或解除绑定。
- 云请求发送前展示模态、样本/资产数、估算费用和会上传的内容类型，并要求显式确认。费用按 provider 当时的价格资料估算，不将易变价格硬编码为 profile。限制/政策/隐私链接由 adapter 明示。删除模型时列出仍绑定它的库，用户须先明确替换或解除绑定；取消模型下载/索引任务不得自动删除共享模型文件。

### 资源库模型切换和派生索引重建

模型绑定属于资源库语义配置，向量属于可重建的派生数据；切换只重建该库的语义索引，不替换整个 `library.db`。索引实现由 Library Worker 持有，不给 Renderer 或 Main 数据库/任意路径能力。

确认窗口标题：“更换语义搜索模型？”正文：“将为此资源库重新建立语义索引，可能需要一段时间。原文件、标签和描述不会改变。重建完成前将继续使用原模型。”按钮：“取消”“更换并重建”。若原模型不可用，末句改为“重建期间仍可使用关键词搜索”；首次建索引不声称已有旧索引。云端配置另外列出将上传的媒体类型、数量和可取得的费用估算；无法估价明确显示未知。首次确认可授权本库后续新增/修改资产沿用同一 provider 自动增量编码，用户可暂停或撤销，无需逐资产重复确认；更换上传目的地、增加上传模态或扩大授权范围需再次确认。

进度条同时出现在库设置和既有后台任务入口，可关闭设置窗口继续运行。显示“准备模型 → 扫描资产 → 生成语义索引 → 更新新增内容 → 完成”，总量未知时用不定进度条，已知时显示当前阶段百分比及“已处理 X / Y”；下载按字节，编码按资产并可展开帧/片段数。失败和跳过单独计数，不把失败写成成功；提供暂停、继续、取消和重试失败项。中英文文案和样式复用现有 DialogShell、进度组件与主题 token。

1. 切换前按估算向量/临时索引空间预检本地磁盘；云端任务还先做费用估算和上传确认。检查模型文件/运行时已就绪与 capability verified 后创建 pending generation。
2. 对库资产 revision 建立一致性快照和高水位；同时记录快照后资产变更的 durable delta。后台按快照编码，遇到内容/revision 已改变的资产不写旧向量，而将最新 revision 纳入追平队列。全部快照完成后回放 delta，追到当前 revision 再准备切换。任务记录绑定 `libraryId`、profile version 和 asset revision，写入前复核，防止切库/并发任务串库。
3. 只有 pending generation 与当前资产版本追平且校验通过，才在 Worker 事务中原子切换 active profile/generation。切换前查询仍使用旧索引；切换后只查询新 profile，不混合不同 profile 的 raw cosine。失败、取消或关闭时保留旧 active generation；新库任务可恢复。索引代次清理需确认无查询/任务引用后再执行。
4. UI 以阶段、已完成/总数、失败数和跳过数报告扫描、抽取/预处理、编码、delta 追平和切换；总数未知时显示阶段状态，不伪造百分比或 ETA。应用退出/重启后任务可恢复；关闭资源库时暂停任务并释放 runtime，重开该库才可继续，禁止后台持有已关闭的非默认库。取消后清理本任务临时产物，但保留共享模型缓存；清理失败提供明确重试入口。
5. 增量索引按 asset revision 失效并重算变更资产。视频帧/音频片段保留时间戳；profile 固定采样上限、预处理、片段聚合和 channel rank-fusion 版本。跨 visual/audio channel 默认按排名融合并按资产去重，不能用原始分数直接排序；保留每个 channel 的命中和时间戳供结果解释。

长音频和原生视频超过 provider 限额时按可配置但版本化的时间窗口分段，保留起止时间及重叠策略，不能静默只取前一段。分段/抽帧前估算调用数量并限制并发、总片段数和预算；超过预算暂停让用户调整范围，不悄悄增加云端费用。抽帧兼容默认均匀覆盖全片且最多 32 帧，界面提示可能漏掉短暂画面；音轨是否分析单独可选。片段保存子向量与时间戳，资产级向量采用固定归一化聚合；子向量用于定位片段，不能伪造聚合向量对应的精确命中时间。

默认仅在应处理项全部成功、明确不支持的项已列出且变更追平后切换。存在失败时显示“部分完成”，可重试或由用户明确选择“使用已完成的索引”，并保留失败清单和覆盖率；取消不得切换 active。发布事务内复核增量高水位，避免追平检查到提交之间漏掉资产变更。旧索引只在新索引成功发布且无读者引用后清理；恢复任务是持久任务数据，失败下载/抽帧等临时产物仍须及时回收。

现有入口复用建议：全局页只负责模型目录和默认 profile；当前库模型/channel 选择、绑定、切换确认和阶段进度放在 `LibrarySettingsDialog.tsx`。云端凭据是设备级 provider 配置，不改变资源库语义。现有 `src/worker/ai/gemini-adapter.ts`、`openai-adapter.ts` 是生成/对话 adapter，不是 embedding API；`src/worker/ai/protocol.ts` 只表达 description/tags/rating，不能扩成 embedding chat。视频 `src/worker/ai/video-input.ts` 消费 contact sheet 用于云端视频描述，不能作为视频 embedding 输入；复用/提取 `src/worker/library-service.ts` 中 FFmpeg 抽帧底层能力，产出独立有时间戳的帧。音轨抽取路径需先确认现有媒体能力，再明确复用或新增。

## 复用点、测试和验收证据

以下是后续实现的建议映射，不代表已实现或已验证。测试应和代码在同一变更中新增/更新；这次设计阶段没有运行测试。

| 需求条目 | 候选实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 三档 artifact/profile 正确配对、分档和控制组报告不混淆 | 新增独立 `src/worker/embedding-experiment/` 或 helper 模块；复用 `src/worker/ai/` 中 adapter 的错误/取消边界，不复用结构化对话 schema | 新增 profile/manifest 单测：量化名、revision、核心/mmproj 哈希、尺寸与预处理改变后 profile key 必变 | 用户看到三档具体文件与核心/投影格式后确认理解；三档 Top-K 并排记录 |
| 文本 query prompt、图片无前缀、768 维有限值、cosine 归一化 | 实验 encoder adapter；参考研究中的 query 模板和官方模型卡 | 新增 adapter 契约测试；native smoke 使用不同图片与无图对照，验证图片输入确实影响向量；任何错维/NaN/忽略图像均失败 | 至少一组中文/英文文找图、一组图找图由用户检查；记录完整 runtime commit |
| 图片来源与模型预处理一致且可追溯 | 不复用 `src/worker/ai/image-input.ts` 2048/JPEG85 作为无条件默认；新 adapter 明确 profile 的图像处理配置 | 使用不同方向、色彩和输入尺寸 fixture 验证解码实际发生，所有量化档的预处理参数一致 | 对代表性设计图检查输出；注明支持/跳过格式。Computer Use/packaged/Windows 未执行时如实记录 |
| 用户选择存储、空间预检、失败清理和显式删除 | 参考 `src/main/disk-free-space.ts`、`src/main/native-dialogs.ts`、`src/main/script-runtime-supervisor.ts` | 新增空间不足、取消下载、进程中断和清理失败测试，断言没有静默残留且显示重试路径 | 用户选目录并运行/清理一组数据；检查文件确实消失。分别记录 macOS/Windows 与 packaged 状态 |
| capability 声明/验证、全局模型目录/默认 profile、库级本地/云端选择与设备凭据 | 全局 `AppSettingsPages.tsx` / `app-settings-sections.ts`、库级 `LibrarySettingsDialog.tsx`、Main safeStorage、独立 embedding adapters | 默认只初始化新/未绑定库；已有绑定不随默认值或语义编辑变化；未验证模态不可启用；凭据不落库且轮换不重建；删除被绑定模型要求处理受影响库 | 用户配置本地与至少一个已验证云端模型，确认能力标志、凭据和默认行为；各模态分别记录 live smoke，未跑即标未验证 |
| 当前库 active/pending profile 选择与按库应用模型 | `LibrarySettingsDialog.tsx`、Library Worker 命令与 profile binding | 新库默认、既有库保持绑定、显式切换生成 pending generation；切库/并行库任务不得串写；跨 channel 走固定 rank-fusion 并去重，不比较 raw cosine | 用户切换一个小样本库；旧搜索持续可用直到切换完成，完成后结果/来源 channel 可解释 |
| 图片/视频画面/音频 channel 与时间戳、聚合策略 | 模态 adapter；FFmpeg 帧提取候选 `library-service.ts`；音轨路径先调查；不复用 contact sheet | 文本-only 模型不能开启帧抽样；frame 上限、均匀抽样、时间戳和均值聚合可复现；音频提取/采样契约；live adapter 测试证明内容参与向量 | 用户用含运动、长短片段及音频的脱敏小样本分别检索，UI 明示抽帧只看画面；当前未实现/未验证 |
| 快照 + delta 追平、pending 恢复/取消、空间费用预检和原子切换 | Worker 派生索引生成、持久任务与事件；不替换整库 `library.db` | 资产修改期间建索引、revision 变更、失败/取消/重启/关库重开/跨库并行、空间不足、拒绝云上传均覆盖；断言旧索引保持 active，追平后原子切换且不写陈旧向量 | 人工查看阶段/完成总数/失败跳过数；验证暂停释放与恢复；云端首次上传展示费用和内容并有确认 |

可复用测试上下文：[tests/unit/ai-protocol.test.ts](../../../tests/unit/ai-protocol.test.ts) 覆盖当前结构化输出协议；[tests/worker/ai-analysis.test.ts](../../../tests/worker/ai-analysis.test.ts) 覆盖 `ai_content` 写入和迁移；[tests/worker/library-availability.test.ts](../../../tests/worker/library-availability.test.ts) 是以后修改资源库打开/schema 时的强制门禁。新实验首轮不应为了向量测试改动后二者的数据契约。

## 实施阶段与完成边界

1. **运行时 spike / 阶段 1 实验：** 锁定 llama.cpp commit，先证明文本与图片路径真实有效，再开放三档 GGUF 小样本图像对比。Spike 失败就记录阻断并停止；不把 text-only 或换权重格式写成 GGUF 多模态验收。
2. **多模态 adapter 与模型管理：** 完成 local GGUF capability probe 与独立图像、视频视觉、音频契约；加入至少一个经逐模态验证的云端多模态 provider adapter（Gemini Embedding 2 为候选），设备模型目录/默认值、库级 provider/profile 选择及本地凭据管理完成。一个 modality smoke 不得外推到其他 modality。
3. **资源库绑定与检索：** 实现 active/pending binding、文本/图像/视频画面/音频通道及版本化 rank-fusion；内容策略按 profile 配置，不同 channel/profile 不混算原始 cosine。
4. **恢复式重建与产品验收：** 快照+增量追平、阶段进度、预检、取消/恢复、旧索引保留和原子切换落地后，补 Worker/跨进程/Electron 验收、性能与旧库兼容审查。新功能完工前不加到人类验收清单，也不标记已实现或待人类验收。

实验向量不可直接升级成生产索引。资源库 schema/Worker 实现前，应审查是否需要 generation 元数据或独立派生存储；若改资源库结构须完整执行 `npm run test:library-availability`，并对跨进程媒体/搜索路径跑真实 Electron E2E。两万资产性能和 Windows/packaged 证据按仓库门禁单独记录。

## 未验证事项

- 本项目使用的 llama.cpp commit、三档 GGUF 组合在 Windows/macOS 上的 `/v1/embeddings` 图片与文本编码能否通过实际内容差分；上游虽已证明正确请求可用，不能直接外推到我们的组合。
- libmtmd 是否能以适合独立 helper 的 API 产出该模型图像的 768 维单向量，以及各档 `mmproj` 与核心 GGUF 的配对兼容性。
- llama.cpp 路径是否精确遵循官方模型的 mean pooling、视觉 token 默认/可调预算、缩放裁切和色彩处理。
- 本地 GGUF 的音频/视频 modality 实际可用性、mmproj 内容、音频前处理以及视频抽帧/聚合输出；Gemini adapter 的每模态请求/响应、限制、实时费用估算与隐私呈现也须逐项验证。
- Q4/Q8/BF16 在 Serpent 目标图片集上的检索质量差异、冷启动/常驻内存、吞吐与 GPU 支持。
- Windows、macOS 及 packaged app 的 native helper 构建和运行情况。
- UI 能否可靠采集峰值内存；若不能，报告应标为 unavailable，不能拿 RSS 代替 GPU 内存。

## 来源

- [Unsloth EmbeddingGemma 2 GGUF 仓库与文件清单](https://huggingface.co/unsloth/embeddinggemma-2-GGUF/tree/main)（文件名、量化类型、文件大小、GGUF 推理说明）
- [Unsloth GGUF 文件上传提交](https://huggingface.co/unsloth/embeddinggemma-2-GGUF/commit/412430755667d84b1ac64fe1fe2693aa6219f1d9)（权重 revision）
- [Google EmbeddingGemma 2 模型卡](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2)（多模态能力、768 维、pooling、提示、MRL、BF16/FP32 要求及 F16 风险）
- [Google Gemini Embeddings API](https://ai.google.dev/gemini-api/docs/embeddings)（云端多模态输入、请求边界、视频音轨限制、长度/帧数与输出维数）
- [Google Gemini API 定价](https://ai.google.dev/gemini-api/docs/pricing)（动态费用来源；实施时估价须按当前价格核算）
- [OpenAI Create Embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create)（embedding endpoint 接收文本或 token，不提供原生图像/音频/视频输入）
- [llama.cpp #30054](https://github.com/ggml-org/llama.cpp/pull/30054)（合入 embeddinggemma2 架构与转换支持）
- [llama.cpp #30082 及报告者更正](https://github.com/ggml-org/llama.cpp/issues/30082#issuecomment-3380876794)（正确嵌套请求已验证图片 embedding；错误请求与旧端点的静默忽略风险）
- [仓库内图像 embedding 研究](2026-10-10-image-embedding-models.md) 与 [ADR-0011](../adr/0011-defer-vector-search.md)（profile 隔离、缓存和正式向量索引边界）
