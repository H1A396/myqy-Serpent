# 图像语义搜索：embedding 模型现状与不绑定单一模型的方案

- 日期：2026-10-10
- 范围：面向 Serpent 后续「用自然语言找图 / 以图搜图」的模型现状与架构选择。本文件不修改生产代码，也不推翻 [ADR-0011](../adr/0011-defer-vector-search.md)。
- 证据口径：模型能力、维度、API 字段和榜单分数只引用模型卡、供应商文档、论文或榜单页面。产品建议单独标为推断。
- 仓库对照：[ADR-0011](../adr/0011-defer-vector-search.md) 已经把「embedding 与模型、版本、维度、预处理绑定，换模型要全量重算」写成推迟向量搜索的理由；[产品简介](../../product-brief.md) 规定 MVP 只用用户自带 Key 的云端模型，本地模型与 Ollama 属于后续阶段。

## 结论摘要

1. **软件不必写死某一个 embedding 模型，但每一份向量索引必须写死一套模型档案。** 不同模型的向量不在同一个空间里，不能放进同一个索引做相似度。换模型的正确动作是新建一份索引并在后台重算，而不是翻译旧向量。
2. **2026 年的图像语义检索已经从 CLIP 双塔转到「视觉语言模型做成的 embedding」。** 开放权重里，绝对检索质量看 Qwen3-VL-Embedding（2026-01）；端侧体积看 EmbeddingGemma 2（2026-10-06，740M，图文同一 768 维空间）。Cohere Embed 5、Voyage `voyage-multimodal-3.5`、Google `gemini-embedding-2` 是云端代表。经典 CLIP / SigLIP 2 仍然适合本地、轻量的「长得像」检索，但在指令式图文检索榜上明显落后。
3. **不存在统一的图像 embedding 接口。** OpenAI 的 `/v1/embeddings` 到本文写作时仍只接受文本。各家云端都用「文本块 + 图片块」这类内容片段，但模型名、维度、query/document 不对称提示和量化格式各不相同。抽象层应该是 Serpent 自己的提供者接口，而不是假装大家都是 OpenAI embeddings。
4. **对 Serpent 的推断：** 向量只作为可删除的派生缓存，按模型档案隔离；全文搜索继续是始终可用的路径。两万资产这一档用精确点积就够，不必先绑定 `sqlite-vec`。自然语言找图和以图搜图可以是两份档案，甚至两个提供者，不必合成一个「万能模型」。

## 1. 为什么换模型就不能沿用旧向量（事实 + 推断）

事实：

- 各模型的输出维度本来就不同。例如 Qwen3-VL-Embedding-2B 最高 2048 维、8B 最高 4096 维，且允许在 64 到最高维之间自选；Cohere `embed-v5.0-pro` 的可选维度是 256、512、768、1024、1536、2048（默认 2048）；Voyage `voyage-multimodal-3.5` 默认 1024，另支持 256、512、2048；Gemini Embedding 2 默认 3072，可在 128 到 3072 之间缩短。来源见第 6 节。
- 同一模型内部的缩短（Matryoshka / MRL）只保证「这一个模型的前若干维仍能用」。`sqlite-vec` 的 `vec_slice` 文档也是这么写的：截断后再做 L2 归一化，用于 Matryoshka。它没有说可以把 A 模型的向量截成 B 模型的维度。
- 很多检索模型是不对称的。Cohere 要求语料用 `search_document`、查询用 `search_query`。Voyage 多模态接口同样区分 `document` 与 `query`，并会在向量化前加上不同的提示句。Qwen3-VL-Embedding 的模型卡把 Instruction Aware 标为 Yes。因此「同一个权重、不同提示词」也不是同一套向量。
- 2025 年的 vec2vec（NeurIPS 2025，*Harnessing the Universal Geometry of Embeddings*）能在**文本** embedding 空间之间做无配对翻译，论文报告与目标空间真值的余弦相似度最高约 0.96。实验模型是 GTR、CLIP 文本塔、E5、GTE、Stella、Granite、Qwen3 等文本向量，不是「给图库换一个视觉模型后免重算」。

推断：

- 把 vec2vec 或任何线性对齐当成资源库的兼容层，不能保证以图搜图或自然语言找图的排序。它也解决不了预处理（色彩空间、缩放、最长边）和提示词模板的差异。
- 产品上应把「可互换」定义成：软件只依赖档案和提供者接口；数据上，一份档案的向量只和同一份档案的查询向量比较。

## 2. 2026 年模型版图

评测主榜是 TIGER-Lab 的 [MMEB-V2](https://huggingface.co/spaces/TIGER-Lab/MMEB-Leaderboard)（图像、视频、视觉文档上的指令式排序，不是设计师说的「这张原画长得像那张」）。榜单会更新。下面是 2026-10-10 抓取该页面时，Overall 靠前的条目；提交日期是榜单上的 Date 列，不是抓取日。

| 榜上名称 | 参数量 | 榜单日期 | Overall | Image Overall |
| --- | --- | --- | --- | --- |
| DME-Large | 未标明 | 2026-07-17 | 80.24 | 81.11 |
| octen-vl-embedding-large | 未标明 | 2026-05-15 | 80.09 | 81.86 |
| DME-Medium | 9.4B | 2026-07-17 | 78.38 | 79.76 |
| QQMM-embed-v4 | 未标明 | 2026-07-01 | 78.31 | 82.02 |
| Qwen3-VL-Embedding-8B | 8.14B | 2026-01-06 | 77.82 | 80.12 |
| Qwen3-VL-Embedding-2B | 2.13B | 2026-01-06 | 73.25 | 74.96 |

Qwen 官方模型卡给出的自测（并说明除 IFM-TTE 外已在更新后的 VisDoc OOD 划分上重测）是：8B 的 Image Overall 80.1、Image Retrieval 80.0、All 77.9；2B 为 75.0、74.9、73.4。与榜单同一量级，个位后的差异来自榜单后续修订，引用时以对应页面当时的数字为准。

同一模型卡上的对照能说明代际差距：VLM2Vec-V2（2B）Image Overall 64.9；更早的双塔在 MMEB 上更低。第三方汇总页把 CLIP（约 0.4B）零样本 Image 检索记在 53 左右、SigLIP（约 0.9B）零样本记在 31.6，口径与 MMEB 官方榜不完全相同，只说明「双塔零样本 ≠ 2026 年的指令式多模态 embedding」。SigLIP 2 论文自己的强项是另一套任务：零样本分类和 COCO / Flickr 图文检索的 recall@1，并发布 ViT-B 86M、L 303M、So400m 400M、g 1B，以及固定分辨率和保持长宽比的 NaFlex 变体。

按部署方式分成三类：

| 类型 | 代表 | 适合的搜索 | 桌面应用上的约束 |
| --- | --- | --- | --- |
| 轻量双塔 | SigLIP 2（Google，2025-02） | 以图搜图、短文本找图 | 体积小，可走 ONNX；长句子、否定、组合描述弱；文本侧有固定预处理（SigLIP 2 官方说明会小写并截断/填充到 64 token） |
| 开放权重 VLM embedding | Qwen3-VL-Embedding-2B/8B（2026-01）；Jina Embeddings v4（3.8B，基于 Qwen2.5-VL，单向量 2048、可截到 128，另有 128 维 late-interaction） | 自然语言找图、截图/文档、中英混合 | 2B 已是桌面后台任务的量级；8B / 3.8B 更吃显存和首次建索引时间。Jina v4 的多向量模式索引成本远高于一条向量 |
| 云端多模态 embedding | Cohere `embed-v5.0-pro` / `embed-v5.0-fast`；Voyage `voyage-multimodal-3.5`；Google `gemini-embedding-2`（2026-04 GA） | 同上，且 Gemini Embedding 2 还接受音频、视频、PDF | 要把像素送到供应商。与 Serpent「用户自带 Key、导入不默认上传」的边界一致时，只能做成显式开关 |

### 2.1 EmbeddingGemma 2（2026-10-06）

Google 于 2026-10-06 发布 EmbeddingGemma 2：Apache 2.0 权重，总参数 740M（文本骨干 270M，视觉编码器 170M，音频编码器 300M）。文本、图像、视频、音频进同一个 768 维空间。只做图文时可以不加载音频编码器，官方有效规模是 440M。原生维度 768，MRL 截断档为 128、256、512；截断后必须重新 L2 归一化。上下文 8192 token。模型卡要求推理用 bfloat16 或 float32，并写明 float16 会得到 NaN 或静默变差的向量。部署仍须遵守 Gemma 禁用用途政策。

官方 768 维自测：

| 基准 | 指标 | 分数 |
| --- | --- | --- |
| MMEB v2 Image | Mean(Task), Hit@1 | 57.28 |
| MMEB v2 VisDoc | Mean(Task), NDCG@5 | 67.84 |
| MMEB v2 Video | Mean(Task), Hit@1 | 50.67 |
| MMEB v2 Overall（截断表） | — | 59.01 |
| MIEB lite | Mean(TaskType) | 64.64 |
| MTEB multilingual v2 | Mean(Task) | 61.36 |

同一张截断表里，MMEB v2 Overall 从 768 维的 59.01 到 256 维的 56.24，128 维掉到 45.65。模型卡写明 128 维更适合纯文本，多模态应先用自己的数据验证。

这些数字和 Qwen 模型卡不是同一列。Qwen3-VL-Embedding-2B 的 Image Overall 是 75.0、All 是 73.4；8B 是 80.1 和 77.9。EmbeddingGemma 2 的图像列标的是 Hit@1，不能和 Qwen 的 Image Overall 直接相减。两边各自的 MMEB Overall（59.0 对 73.4 / 77.9）已经说明它是 1B 以下的端侧档，不是榜单上限。Google 的发布说明也是按「每参数质量、可在设备上跑」来定位的。

和档案设计直接相关的约定：

- 任务前缀只加在文本上。检索查询用 `task: search result | query: {query}`；图片、视频、音频不加前缀。因此文找图是不对称的：查询带前缀，图库侧是裸图像向量。
- 默认每张图 280 个视觉 token，允许在 70 到 1120 之间改。模型卡写明加长视觉序列会提高细粒度理解。这个预算一变，向量空间就变，必须写进档案。
- 图文可以交错，用 `<|image|>` 占位，得到的仍是一条 768 维向量，可与纯文本查询比较。

内存与能跑的机器以 LiteRT 量化包为准，不是满精度 PyTorch。Google 的端侧包把文本做成 int4、视觉编码器做成 int8（均为量化感知训练）。图文包下载 388 MB，全模态 485 MB，纯文本 165 MB。发布说明给出 Pixel 11 Pro 上的活跃内存：纯文本约 191 MB，全模态约 567 MB。LiteRT 模型卡的性能表另有一套进程内存，并写明除苹果的 `phys_footprint` 外，GPU / NPU / TPU 显存不计入；各操作系统的数字不能横向比。图像基准用的是最低档 70 个视觉 token，不是模型卡默认的 280。LiteRT 图文包只提供 70 和 140 两档，没有满精度那种最高 1120 的细粒度档。

图文（Text + Vision）官方测量，延迟是 5 次平均：

| 机器 | 后端 | 单张图延迟 | 官方所记内存 |
| --- | --- | --- | --- |
| Dell XPS 16（Intel Core Ultra Series 3） | CPU | 338 ms | 342 MB（进程私有内存，这就是占用本身） |
| 同上 | GPU | 62.5 ms | 1769 MB 进程私有内存；显存未单列 |
| 同上 | OpenVINO NPU | 49.8 ms | 394 MB 进程私有内存；NPU 内存未单列 |
| MacBook Pro M5 | CPU | 151 ms | 310 MB（含统一内存） |
| MacBook Pro M5 | GPU | 37.3 ms | 403 MB（含统一内存） |
| RTX 4090 | GPU | 23.9 ms | 678 MB 进程内存；显存未单列 |
| Raspberry Pi 5 16 GB | CPU | 1761 ms | 619 MB |
| Pixel 11 Pro | TPU | 49 ms | 表内 125 MB 不含 TPU 内存 |
| iPhone 18 Pro | GPU | 69.8 ms | 196 MB |

满精度权重可以用参数量估算，官方没有给这份检查点的峰值显存：图文 440M 在 bfloat16 约 0.9 GB，float32 约 1.8 GB，还不包含激活。模型卡要求 CPU 用 float32，有 bfloat16 的 GPU 才用 bfloat16，禁止 float16。

推断：Serpent 的 Windows 和 macOS 笔记本都能在 CPU 上跑图文量化包，内存在数百 MB 这一档；有 GPU 或苹果统一内存时单张图降到几十毫秒。2 万张图若按表中 70 token 的 338 ms 估算，CPU 大约两小时量级，XPS 的 GPU 大约二十分钟量级；默认 280 token 更慢，表里没有这个数。显存不是门槛，批量建索引的时间才是。换到满精度或提高视觉 token，占用和速度都要按新档案重测，不能把上表当成那个配置的显存。

推断：若以后要在本机放一个默认的图文档案，EmbeddingGemma 2 是目前最贴这个角色的开放权重：一个小模型同时覆盖文找图和图找图，768 维对 2 万资产大约 59 MiB，提示词和视觉 token 预算都有书面约定。它替代不了 Qwen3-VL-Embedding 那一档的复杂描述检索。换视觉 token 预算、换截断维度或换前缀，都是新档案。

### 2.2 2026-10-10 再查：质量前沿不在 EmbeddingGemma 2

EmbeddingGemma 2 是端侧体积上的新模型。同一周和前一个月还有两条质量更高的线，公开 MMEB-v2 榜（2026-10-10 再次抓取）第一仍是 2026-07-17 提交的 DME-Large，Overall 80.24，权重和参数量未标明。

Ovis-Embedding（阿里，arXiv:2609.25165）在自己的 MMEB-v2 表里用和公开榜对得上的 Overall：Qwen3-VL-Embedding-8B 77.82、Octen-VL-Embedding-Large 80.09，与榜单相同。在这张表上：

| 模型 | 参数 | 维度 | MMEB-v2 Overall | Image Overall |
| --- | --- | --- | --- | --- |
| Ovis-Embedding-VL-9B | 9B（Qwen3.5-9B） | 4096 | 81.13 | 83.96 |
| Ovis-Embedding-VL-2B | 2B（Qwen3.5-2B） | 2048 | 77.46 | 80.62 |
| 对照：Qwen3-VL-Embedding-2B | 2.13B | 最高 2048 | 73.25 | 74.96 |
| 对照：DME-Large（公开榜，未进 Ovis 对照表） | 未标明 | — | 80.24 | 81.11 |

9B 的 81.13 高于榜上 DME-Large 的 80.24，但论文没有把 DME-Large 放进对照表，2026-10-10 的公开榜页面也还没有 Ovis 一行。这是论文自测，不是榜单已登录的名次。2B 的图像 80.62 高于同规模的 Qwen3-VL-Embedding-2B（74.96）和 DME-Small（75.91）。第三方索引显示 `ATH-MaaS/Ovis-VL-Embedding-9B` 于 2026-09-21 出现在 Hugging Face，标注 Apache-2.0；分数以论文为准。

同一篇论文的 Omni-3B 走的是另一套榜 MMEB-v3（190 个任务，含音频和 agent）。Overall 58.46，高于表中次名 Tianmu-Emb-Uni 的 53.27；图像组 77.55。58 和 v2 的 81 不是同一个平均，不能相减。

Perplexity 于 2026-10-07 发布 `pplx-embed-v2-late` 0.6B 与 9B。这是 late-interaction：每个 token 一条 128 维向量，用 MaxSim 打分，不是一条向量代表一张图。两个尺寸在同一个向量空间里，0.6B 可以查询 9B 建好的索引。ViDoRe v3 图像 nDCG@10 为 0.6B 62.3、9B 65.2。博客写明也支持自然图像语义搜索，主战场是版面、图表、PDF 页面。索引体积随 token 数涨，和「一资产一条 float32」不是同一种表。

推断：到 2026-10-10，开放权重里图像语义检索的质量前沿是 Ovis-Embedding-VL，9B 最高、2B 已经超过 1 月的 Qwen 2B。EmbeddingGemma 2 仍是能塞进笔记本内存的那一档。Perplexity 这一对模型是「同一家族里小模型查大模型索引」，只解开了这一家里的尺寸绑定，解不开换一家模型。

推断：游戏美术库里的两种需求不要合成一个默认模型。

- 「找一张构图、配色、材质接近的」更接近双塔的图像–图像距离。
- 「雪地里的红斗篷骑士，不要 Q 版」更接近指令式 VLM embedding。MMEB 高分模型强在后者，不自动等于前者。

## 3. 接口现状：能抽象提供者，不能抽象成一个向量格式

事实：

- OpenAI Embeddings 指南写明：把文本字符串发给 embeddings 端点。创建接口的 `input` 是字符串或 token 数组，模型为 `text-embedding-3-small`、`text-embedding-3-large`、`text-embedding-ada-002`。`dimensions` 只适用于第三代及以后，用来缩短**该模型**的向量。官方视觉文档走的是 Responses / Chat Completions / Images API，不是 Embeddings API。官方食谱里的图像检索示例使用的是本地 CLIP，而不是 OpenAI embeddings。
- Cohere Embed v2 接受文本、图片 data URI，以及图文交错的 `inputs[].content[]`。`embed-v5.0-pro` 支持 float、int8、binary。`input_type=image` 在 v5 上会退回 `search_document`，官方建议检索时显式使用 `search_document` / `search_query`。
- Voyage 多模态端点是 `POST /v1/multimodalembeddings`，内容同样是 text / image_url（3.5 文档还出现 video）。推荐模型为 `voyage-multimodal-3.5`；上一代 `voyage-multimodal-3` 固定 1024 维。
- Gemini Embedding 2 用 `embedContent`，输入是 text、image、audio、video、PDF 的 parts，`output_dimensionality` 控制长度。更早的 `multimodalembedding@001` 仍在同一文档族里，默认 1408 维，和 Embedding 2 不是同一空间。
- Hugging Face Text Embeddings Inference 的支持列表是文本模型（BERT、Qwen3-Embedding、GTE、ModernBERT 等）。其 issue 讨论过 CLIP / SigLIP 文本塔，官方维护者曾表示图像编码器不是 TEI 的目标。TEI 不能当作「换一个模型名就能做图像 embedding」的运行时。

推断：

- 内容片段（一段文字或一张图）是云端 API 的表面共同点，足够做一个远程提供者适配器。字段名、不对称提示、维度枚举、量化类型必须留在适配器里。
- 本地运行时的可替换单位是「一份模型图 + 它自己的预处理器」，不是一个通用 ONNX 接口。社区把 Jina v5 omni nano 导出成 ONNX 后，视觉图仍被固定成 224×224 的补丁布局；换一张图的前处理就会和建索引时不一致。运行时可移植，向量仍然只属于那一次导出。

## 4. 建议的不绑定方案（推断）

目标：Serpent 的代码、数据库和资源库目录都不出现「只认某一个模型」的契约；用户换模型或模型下架时，库仍然能打开、能全文搜索，语义搜索要么用旧档案继续，要么在新档案建好后切换。

### 4.1 模型档案，而不是模型名

每一套可搜索的向量对应一条档案，至少冻结：

- 提供者种类（本地运行时或远程端点）与模型标识、权重或 API 版本
- 任务（图找图、文找图）
- 存储维度、是否已 L2 归一化、距离（归一化后的点积）
- 查询侧与文档侧的提示词或 `input_type`；两边必须成对，不能混用
- 像素预处理：色彩空间、缩放、最长边、是否保持长宽比；若模型还有视觉 token 预算（EmbeddingGemma 2 默认每图 280，可在 70–1120），一并冻结
- 量化格式；第一版只存 float32，避免再绑死某种 int8 / binary 训练方式

档案标识用这些字段的稳定哈希。任何一个字段变化都是新档案，触发新索引，不覆盖旧向量。

这和 ADR-0011 的后果同一方向：AI 生成的描述已经要求记下模型与版本；向量比描述更不能跨版本比较，所以档案要比「模型显示名」更严。

### 4.2 向量是派生缓存

- 只新增表，不改现有资产表的语义。例如档案表，加上 `(asset_id, profile_id)` 的向量块。
- 删掉一份档案就删掉它的向量。资源库没有向量时，行为与今天相同。
- 建索引在后台进行。新档案未覆盖完当前库时，语义搜索仍用上一份完整档案；没有完整档案时不提供语义搜索。
- 资产增删改只更新受影响档案的对应行，不要求一次换成「最新模型」。

这样软件和某一个 embedding 权重解绑：缺模型、换模型、用户不配置语义搜索，都不会让库不可用。

### 4.3 两万资产先做精确检索

按 float32 估算，2 万条向量大约是：768 维约 59 MiB，2048 维约 156 MiB，4096 维约 313 MiB。这一档对归一化向量做精确点积，延迟不是产品瓶颈。

`sqlite-vec` 能在 SQLite 里做 KNN，并支持 float、int8、bit 和 Matryoshka 切片，但官方仓库仍标明 pre-v1、预期会有破坏性变更。Serpent 的库要跨版本打开。推断：在库规模真正需要近似最近邻之前，不把搜索路径绑到这个扩展上；真要加，也只作为某份档案的可选索引，原始 float32 仍是可重建的来源。

### 4.4 提供者以适配器接入，核心不 import 某个模型 SDK

与现有云端对话适配器同一原则：内部一个请求形状，外面各自处理供应商差异。

- 远程适配器：Cohere、Voyage、Gemini，以及用户自己的兼容端点。端点必须声明它实现的是哪份档案，不能只凭「看起来像 embeddings URL」就写入索引。
- 本地适配器：后续阶段再做。候选运行时是 ONNX Runtime 一类可随 Electron 分发的库，模型文件由用户选择或以后单独下载。不把某个权重打进安装包，也不在未征得同意时把整库图片发给云端。

查询和入库必须走同一个适配器、同一份档案。只升级「查询模型」会得到看起来能搜、排序却是错的结果。

### 4.6 和现有 `library.db` 怎么接（2026-10-10 对照代码）

当前库是 SQLite，schema 到 v57。全文搜索是外部内容表 `asset_search_index` 加 FTS5 虚表 `asset_search`。缩略图走 `revision_artifacts`（文件路径，不是向量）和 `jobs`。`jobs.kind`、`revision_artifacts.kind` 都是 CHECK 枚举；加一种 kind 要重建那张表。Library Worker 是数据库唯一所有者。ADR-0028：更高版本的库仍可写打开，未知迁移不回写，额外列忽略。

这不是 RAG。RAG 是先检索再把片段交给生成模型写一段回答。资源库要的是检索：查询变成向量，找到最近的资产，仍用现在的网格显示。生成描述、标签的 AI 已经在 `ai_content` 里，和向量索引是两条线。

推断：表结构是一次只加表的迁移，不动 `assets`、`asset_search`、`jobs`。

- `embedding_profiles`：档案标识、模型、维度、查询前缀、视觉 token 预算、归一化、状态。
- `asset_embeddings`：`asset_id`、`revision_id`、`profile_id`、float32 BLOB。资产或修订删除时级联删掉。修订一变，旧向量自然对不上当前修订。

向量的后台排队用一张新队列表，避免为了一种 kind 去重建 `jobs`。两万条 768 维大约 59 MiB，放在同一个 `library.db` 里。距离在 Worker 里对这一份档案做精确点积，查询结果仍是资产 id，交给现有浏览。没有完整档案时搜索保持今天的全文路径。

工作量在 Worker 里的编码、失效和查询模块，不在改表。`library-service.ts` 已经很大，这块应独立成模块，而不是再写进那一个文件。`sqlite-vec` 和单独的向量库都不是这一步的必要部分。

### 4.5 明确不采用的捷径

- 用 OpenAI `/v1/embeddings` 当图像接口。它不接收图片。
- 用 Matryoshka 假装跨模型兼容。它只缩短同一个模型。
- 用 vec2vec 或通用线性映射免去重算。证据停留在文本向量研究，且换视觉模型和换预处理都覆盖不到。
- 第一版就上 late-interaction（Jina v4 的多向量、ColPali 一类）。每张图存的是一串向量，索引和查询都更重，和「先把单向量档案做对」不是同一件事。
- 在榜单最高分的闭源模型名上冻结产品。2026 年 7 月榜首仍在更换，且多数不提供可本地复现的权重。

## 5. 和当前产品边界的关系（推断）

ADR-0011 推迟的是「现在就生成并依赖向量」。这份调研不建议立刻做语义搜索，只确定以后做时的形状：

- 全文检索继续是默认路径，语义搜索是可关闭的附加索引。
- 与 MVP 的 AI 边界一致：不内置官方代理，不在用户未打开时上传图片；本地模型仍然属于产品简介里的后续阶段。
- 若以后要做一个默认体验，优先把「以图搜图」放在本地小双塔档案，「用句子找图」放在用户显式选择的云端或本地 VLM 档案。两份档案并列，而不是选出一个永久默认模型。

## 6. 来源

- Qwen3-VL-Embedding-8B 模型卡（维度、MRL、指令感知、MMEB-V2 自测表）：https://huggingface.co/Qwen/Qwen3-VL-Embedding-8B
- 论文 *Qwen3-VL-Embedding and Qwen3-VL-Reranker*，arXiv:2601.04720：https://arxiv.org/abs/2601.04720
- MMEB-V2 榜单页面（2026-10-10 抓取的名次）：https://huggingface.co/spaces/TIGER-Lab/MMEB-Leaderboard
- SigLIP 2 论文，arXiv:2502.14786（recall@1；模型尺寸）：https://arxiv.org/abs/2502.14786
- SigLIP 2 官方检查点说明：https://github.com/google-research/big_vision/blob/main/big_vision/configs/proj/image_text/README_siglip2.md
- Hugging Face SigLIP 2 文档（文本小写与 64 token 预处理）：https://github.com/huggingface/transformers/blob/main/docs/source/en/model_doc/siglip2.md
- Jina Embeddings v4 模型卡（3.8B、2048 维、MRL、单向量与多向量）：https://huggingface.co/jinaai/jina-embeddings-v4
- Cohere Embed 模型表（`embed-v5.0-pro` / `embed-v5.0-fast` 维度与模态）：https://docs.cohere.com/docs/cohere-embed
- Cohere Embed 5 发布说明：https://docs.cohere.com/v2/changelog/embed-v5
- Cohere 多模态 embedding 指南（`input_type` 与 v5）：https://docs.cohere.com/docs/multimodal-embeddings
- Voyage 多模态 embedding 文档：https://docs.voyageai.com/docs/multimodal-embeddings
- Gemini Embedding 2 模型页（2026-04-22 GA，最高 3072 维）：https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/embedding-2
- Google 多模态 embedding 用法（`gemini-embedding-2` 与 `multimodalembedding@001` 的维度表）：https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-multimodal-embeddings
- OpenAI embeddings 指南与创建接口：https://developers.openai.com/api/docs/guides/embeddings ，https://developers.openai.com/api/reference/resources/embeddings/methods/create
- OpenAI 图像食谱（本地 CLIP，而非 OpenAI embeddings）：https://developers.openai.com/cookbook/examples/custom_image_embedding_search
- Hugging Face TEI 支持的模型：https://huggingface.co/docs/text-embeddings-inference/en/supported_models
- `sqlite-vec` 仓库（pre-v1 声明）与 `vec_slice` 的 Matryoshka 说明：https://github.com/asg017/sqlite-vec ，https://alexgarcia.xyz/sqlite-vec/api-reference.html
- vec2vec，NeurIPS 2025：https://arxiv.org/abs/2505.12540
- EmbeddingGemma 2 模型卡（740M、768 维、MMEB 自测、前缀与视觉 token 预算）：https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2
- EmbeddingGemma 2 权重：https://huggingface.co/google/embeddinggemma-2
- EmbeddingGemma 2 发布说明（2026-10-06，Apache 2.0，Pixel 11 Pro 约 191 MB / 567 MB）：https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/
- LiteRT 量化包与分平台延迟、内存表：https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm
- Ovis-Embedding 论文（arXiv:2609.25165，MMEB-v2 / v3 自测）：https://arxiv.org/abs/2609.25165
- Perplexity `pplx-embed-v2-late` 发布说明（2026-10-07）：https://www.perplexity.ai/hub/blog/multimodal-embeddings-beyond-a-single-vector
