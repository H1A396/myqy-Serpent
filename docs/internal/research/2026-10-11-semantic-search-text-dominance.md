# 语义搜索中文字资产霸榜的排查与缓解

2026-10-12 产品决定：用户要求回退相关性校正方向，纯文本也不扣分；应用现按模型原始相似度排序。下文固定扣分的“仓库现状”描述为早期调研时点，校准/重排建议已撤回，不作为当前实施要求。见 [撤回与定向验证记录](../development/2026-10-12-semantic-raw-ranking.md)。

2026-10-12 追加实测见 [含字图片与纯文本实验](../qa/2026-10-12-semantic-text-bias-experiment.md)：本地 Q4 Gemma 无关中文叠字的成对抬分已复现，纯文本扩展及用户授权真实库已单独测试；当前绑定 Qwen 的有限应用查询另记。本文以下“尚未测量”等文字描述早期调研阶段，后续测量与当前结论以实验报告为准。背景校正未作为产品修复交付。

用户后续补充：含文字图片和纯文本资产普遍容易获得高分，文字与查询无关时也可能如此，不能将原问题缩减为图片印着查询关键词。默认全类型按内容相关性混排、不固定偏向图片已由用户确认。当前专项方案、API 一行介绍和针对该现象的背景查询对照见 [Embedding API 格式与全类型语义搜索方案](../implementation/2026-10-11-embedding-api-and-mixed-search-plan.md)。本文早期的视觉优先建议只保留为研究背景，不作为已选方案。

## API 接入候选方案（讨论稿，未批准开发）

用户已确认 API 格式必须可设置，开启语义搜索后默认使用语义检索；当前阶段只讨论，不开发。以下新增选项和行为均为候选方案。

1. “API 格式”选项短名建议为：OpenAI 兼容、llama.cpp 多模态、DashScope 多模态。依次对应标准 OpenAI Embeddings 格式、llama.cpp 的 OpenAI 兼容多模态扩展、DashScope 多模态 Embedding 格式。前两项共用 endpoint、鉴权、响应解析，仅输入序列化不同；不得复制一套接入实现。Ollama 的文本检索先使用其 OpenAI 兼容入口，原生 `/api/embed` 暂不列为必要范围。
2. 内部统一输入是“有 ID 的条目及内容片段”，不是厂商请求体。每个独立条目预期对应一个向量；query/document 角色、查询指令与文本前缀由模型配置和 adapter 转换。批量条目与单条图文组合必须明确区分。
3. API 格式与模型能力分别记录。文本、图片等能力需要声明并通过对应探测；仅连接成功、模型名称或接受字段不构成验证。OpenAI 标准文本格式不能因勾选图片能力而隐式改发多模态扩展。内置本地模型由应用提供已知协议与配置，用户无需重复选择格式。
4. 首期保持文本资产与图片独立编码，不把 fusion 设为必选项或通用开关。以后确需同一资产图文联合表示时，由 adapter 按服务合同处理分组；无法实现时明确报不支持，不用平均多个向量来冒充等价的模型融合。rerank 作为独立可选能力规划。
5. 搜索策略与接入协议解耦：用户已确认默认全类型按内容相关性混排，不固定偏向图片；具体校准与相关性修复仍需评估。不能把格式选择当作文字霸榜修复。
6. 向量 profile 应包含影响编码语义的模型身份、输出维度、编码模板、媒体预处理及组合策略等配置。相关配置改变时不得混用新旧向量；具体复用、重建和切换规则沿用既有索引代次设计。请求与响应按所选 adapter 校验，不通过猜另一种响应格式静默兜底。

当前已有两种 HTTP adapter 与独立的本地 llama-server 接入；上述方案主要是补齐多模态扩展边界与统一内部合同。本文没有修改功能代码，也未执行模型探测或检索验收。

- 日期：2026-10-11
- 范围：调查文字密集图片和纯文本资产在语义搜索中长期排在前列的可能原因及处理路径；不修改应用代码或工单。
- 证据口径：区分仓库代码事实、官方文档/论文结论与待验证推断。本文未连接实际模型服务，未使用真实用户资产复现，也未验证任何建议的效果。

## 结论

仓库已经对纯文本资产做了固定分数扣减，但这只覆盖纯文本 channel，无法处理含文字的图片。纯文本和图片都进入一个列表时，它们的余弦分数被直接比较；一个没有文字的图片若语义与查询匹配，也可能输给文本描述更贴近查询的资产。现有 `0.12` 扣减没有针对 Serpent 查询集的校准证据，且相似度分数不是概率，不能据此解释为“相关百分比”。

建议按成本从低到高验证：先记录实际 provider/model 与两条 channel 的原始和扣减后排名；再 A/B 测试更明确的查询指令；若产品意图是“找图”，用视觉资产范围或视觉优先的展示规则解决目标不符；需要跨类型混合时分别召回并融合排名，或对小候选集使用多模态 reranker。RRF 能避开不同 channel 的原始分数不可比，但单独使用不能保证图片压过文字资产。不要在没有标注集的情况下继续加大固定扣分。

## 仓库现状

| 位置 | 当前行为 | 对问题的含义 |
| --- | --- | --- |
| `src/main/embedding-test-index.ts`：`EMBEDDING_TEXT_CHANNEL_PENALTY`、`embeddingChannelFromRevision`、`scoreEmbeddings` | 混合 channel 时，纯文本资产减 `0.12`；图片仍按图像 channel 排序。 | 文本文件得到一次静态扣分；图片上印着查询词仍是图片，不会受到扣分。 |
| `src/main/embedding-test-index.ts`：`handleSearch` | 本地 EmbeddingGemma 搜索调用 `scoreEmbeddings(..., { demoteTextChannel: true })`。 | 本地路径也有上述扣分。 |
| `src/main/embedding-http-index.ts`：`handleSearch` | HTTP 搜索调用同一评分函数并启用 `demoteTextChannel`；DashScope 查询使用 `DASHSCOPE_VISUAL_SEARCH_INSTRUCT`。 | 当前 DashScope 指令偏向图片而非纯文本文件，但不明确要求忽略图内文字或区分“按可见文案找图”和“按画面内容找图”。 |
| `src/main/embedding-http-index.ts`：`#listTargets` | 按 `embeddingSourcePlan` 把文本资产读成文本，把图片送为图像；HTTP adapter 区分 OpenAI 文本 embedding 与 DashScope 多模态。 | 文本和图片会并存于同一个索引；文本-only 服务不等同于图文搜索。 |
| `src/shared/embedding/http-service.ts`：`DASHSCOPE_VISUAL_SEARCH_INSTRUCT` | 查询指令为 “Retrieve images relevant to the user's query. Prefer visual matches over plain text documents.” | 指令已有视觉导向，但仍需用含字图片验证；改写 prompt 的收益不能从官方说明直接外推到本库。 |
| `docs/internal/implementation/embedding-providers-and-find-similar.md` | 设计原则要求不同 channel 的原始分数不可直接拼接；多 channel 联合检索提议按 channel 排名后用 RRF。 | 已有后续设计可复用；仍需决定当前用户查询是找图还是搜索所有资产。 |

当前可配置的 HTTP 适配器中，DashScope 多模态可编码文本和图像；OpenAI 兼容 embedding 适配器保持文本-only。DashScope 端可配置 `qwen3-vl-embedding`，官方描述其支持独立或融合 embedding、可自定义查询 `instruct`。本次没有确认用户实际选用哪个服务、模型版本或维度，因此不能把表现归因到某个模型。

## 证据与限制

1. **查询指令是低成本可测的变量。** 阿里云多模态 embedding API 把 `instruct` 定义为帮助模型理解查询意图的自定义任务描述，并建议英文指令；其文档报告自家下游任务使用指令通常比不使用提升 1–5%。这不是对“压制 OCR/图中文字”的承诺，也不是 Serpent 数据上的测量。[阿里云多模态 embedding API](https://help.aliyun.com/en/model-studio/multimodal-embedding-api-reference)

2. **文字可成为图像模型强特征，这是需要验证的机制假设。** OpenAI 对 CLIP 的一手说明明确观察到，图中文字可以控制部分神经元响应，并将这类现象称作 typographic attacks；CLIP 论文也单独测过 OCR 能力。它说明视觉语言模型可能从图中文字得到很强信号，但不能证明当前 EmbeddingGemma 或 Qwen3-VL 的高分由此导致；这些模型、训练目标和数据不同。[OpenAI：Multimodal neurons](https://openai.com/index/multimodal-neurons/)、[CLIP 论文](https://arxiv.org/abs/2103.00020)

3. **共享向量空间不等同于分数天然校准。** Qwen 官方模型卡称 Embedding 模型把图像、文本等映射到共享表示空间；同时介绍独立的多模态 reranker，对 query-document 配对输出相关性分数，并将其定位为初召回后的重排阶段。模型卡的汇总基准改善不能证明它能识别 Serpent 的图中文字偏好，仍需本地标注查询验证。[Qwen3-VL-Embedding 模型卡](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B)、[Qwen3-VL-Reranker 模型卡](https://huggingface.co/Qwen/Qwen3-VL-Reranker-2B)

4. **RRF 的证据支持融合方法，不支持视觉优先目标。** 原始 RRF 论文用多个检索系统的排名而不是原始分值来融合，并在其 TREC/LETOR 实验中报告胜过单一系统或一些融合基线。它可避免把跨 channel cosine 当作同一标尺，但如果纯文本检索系统也把一份说明文排第一，RRF 仍可能将该文本保留在融合列表前部；若目标是让“找图”只返回图片，必须由查询范围或 channel 策略表达这个意图。[Cormack 等，RRF 原论文](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)

5. **不要把“modality gap”当作所有模型都需固定扣分的证明。** 经典模态间隔研究分析的是 CLIP 式对比学习表示，显示文本与图像嵌入可能几何分离；它不能推出本项目的具体模型分值关系，也不能推出纯文本一定高于图像。当前仓库注释所述“文字—文字分数更热”应视为实施者动机，`0.12` 仍是未经项目评估的启发式常数。[Mind the Gap](https://arxiv.org/abs/2203.02053)

## 建议路径

### 1. 先测实际表现，保留现有扣分作为对照

对同一批 query 记录模型/provider、模型版本、指令、维数、文本/图像各自的原始 top 20 和当前扣分后的 top 20。分别统计图像命中、纯文本命中、含文字图片命中，并抽查分数差距。这样可以确认问题是纯文本资产、图中文字、检索意图不清，还是多个原因叠加。不要把当前固定扣分视为已验证修复。

### 2. A/B 测试视觉意图指令

对 DashScope 的查询指令对照当前文本与一条更明确的英文指令，例如：

> Retrieve images based primarily on depicted objects, scene, composition, and visual style. Treat text printed inside an image as secondary; match it only when the user explicitly asks for visible wording. Do not prefer a text document over a visually relevant image.

分别测试“按画面找图”“找含指定文字的海报/UI”“搜索所有资产”三种意图。单测里如果用户要找带指定文案的图，忽略文字反而是回归。阿里云文档允许 `instruct` 描述 query 意图；本项目目前设置为一次固定的视觉检索 instruction，所以引入多意图时需要明确 query 何时选择哪条指令，并记录指令版本。其他 provider 是否支持同一字段必须按 adapter 合同确认。

### 3. 以检索意图决定结果范围/呈现

对明确的视觉搜索，让图片成为主结果范围；把纯文本作为单独 channel/可切换范围，或分区显示“图片”和“文本”。这是最直接、可解释的产品策略，不依赖分数尺度，也保留“搜索所有资产”的能力。含文字图片仍参与视觉排序，因此需同时评估第 2 项或 reranker。是否添加视觉模式/范围控件属于产品选择，本次只给研究建议。

### 4. 需要混合列表时分通道召回

给文本与图像 channel 分别形成排序，再用项目既有设计中的 RRF 做融合；按库规模控制每个 channel 候选池，必要时给视觉 channel 单独的展示配额或权重。RRF 可避免把两类 raw cosine 直接相加，但只做中性融合不会自然实现“图片优先”。若只需视觉搜索，过滤纯文本候选比任何分数融合都更确定。

### 5. 对视觉候选做多模态 rerank

先召回较宽的视觉候选，再以 `(query, image)` 送给兼容的多模态 reranker，指令要求按画面内容判断，并明确图中文字仅在用户查询文字时作为主证据。若需保留文档候选，可单独使用 `(query, text)` 排序后再应用产品融合策略。官方模型卡证明 Qwen3-VL-Reranker 接受文字和图像输入、设计为二阶段 rerank；它不证明针对 Serpent 的图片含字案例能解决问题，且候选图片若未进入 reranker 就无法补回召回损失。也需评估推理延迟、费用、隐私和服务能力。

### 6. 分数校准或微调放到有标注之后

若产品仍要求一张全类型混合列表，先积累按意图标注的 query-asset 相关性，比较分 channel 的温度/分位数/校准器或学习排序；在独立 query 集验证。不要直接把 `0.12` 调成更大数字：不同 provider、模型版本、维数、query 模板和资产分布可能改变分数范围。模型/指令/预处理变更需要可对账的 profile 版本；改 corpus 编码方式时应生成新索引，不能与旧向量混排。

## 可复现的小样本评估

本轮未运行该评估。后续可在隔离测试中构造约 60 张合成 PNG 与文本 fixture：一组纯图像；一组主体内容明确、同时叠加主题一致或无关的大字；一组海报/UI 截图；以及约 20 份短纯文本资产。合成文字覆盖简体中文和英文，不使用用户库内容。准备 30–40 条中文/英文查询，至少包括视觉主体查询、明确查找可见文字、普通全资产搜索；人工建立相关性标注并冻结 query 集。

对同一模型与索引比较：

- 当前指令与视觉优先指令；
- 当前扣分关闭、保留 `0.12`、以及按 channel 分别查看排名；
- 图片范围检索、文本/图像独立召回 + RRF；
- 若服务具备 reranker，再对相同视觉候选跑 rerank。

报告 `Image Recall@10`、`Text-only share@10`、`nDCG@10`，另单列“明确查可见文字”查询的 `Recall@10`，避免把有价值的海报/UI 结果误判为错误。分数可用来排序，不写成百分比。先看 top 10 例子并保留逐项结果，随后才根据独立查询集合比较总体指标。若查询交给云服务，应只上传合成 query 和合成图片，并固定模型名、维数、adapter、instruction 与服务区域。

**范围限制：** 本报告没有用真实用户资产复现现象，没有请求远程 embedding/reranker 服务，没有验证以上指令、通道拆分、RRF 或 reranker 的实际效果。实施建议仍需根据用户当前配置的 provider/model 与受控评估结果选择。

## 接口规范与产品约束（讨论中）

### Embedding API 有共同约定，但没有统一强制的线格式

常见 embedding API 都有“模型 + 输入 + 向量输出”的相似概念，也常见批量数组与按 `index` 对应返回项；这只是广泛约定。OpenAPI 是描述 HTTP API 的接口/schema 格式，不规定不同厂商的请求字段、模型能力、向量语义或返回聚合方式。厂商提供 OpenAI-compatible endpoint 也只是兼容指定子集，不自动意味着同样支持多模态或检索指令。[OpenAPI Specification](https://spec.openapis.org/oas/v3.1.1.html)

| Provider / 官方接口 | 输入与任务角色 | 输出及多内容语义 |
| --- | --- | --- |
| OpenAI Embeddings | `POST /v1/embeddings`；`input` 是文本字符串、文本数组或 token 数组；`model` 必填；`dimensions` 仅部分型号支持；`encoding_format` 为 `float` 或 `base64`。 | `{object: "list", data: [{object: "embedding", index, embedding}], model, usage}`。该接口的官方定义是“input text”；没有图像、fusion 或 `search_query/search_document` 字段。 |
| Alibaba DashScope Multimodal Embedding | `input.contents` 放 `text`、`image`、`video` 等内容；`parameters` 可含 `dimension`、`instruct`、模型支持时的 `enable_fusion`。 | 独立模式按输入返回多条带 `type`/`index` 的向量；Qwen3-VL 支持独立与融合，`enable_fusion=true` 返回一个融合向量。支持与字段依具体模型不同，不能只凭同一 endpoint 假设。 |
| Cohere Embed v5 | `inputs` 可含文本或带图像/文本内容片段的对象；使用 `input_type="search_query"` 或 `"search_document"` 区分检索角色；另有 `output_dimension`、`embedding_types`。 | 响应按 embedding 类型组织，例如 `embeddings.float`。单个 `inputs` 项含图文内容时可得到一条合并向量；其 API 没有与 DashScope 同名的 `enable_fusion` 开关。Cohere 的独立 Rerank v2 目前定义为 `query` + 文本 `documents`。 |
| Voyage Multimodal Embeddings | `inputs` 中每项以 `content` 序列表示文字、图像或视频；`input_type` 可为 `query`/`document`，官方说明会添加任务前缀。 | 每项多模态输入得到对应 embedding；混合内容作为一个 input 的多模态表示。输出编码使用 `output_encoding`，官方接口字段与 Cohere、DashScope 均不同。 |

依据：[OpenAI Embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create)、[DashScope Multimodal Embedding API](https://help.aliyun.com/en/model-studio/multimodal-embedding-api-reference)、[Cohere Embeddings](https://docs.cohere.com/docs/embeddings)、[Cohere Rerank v2](https://docs.cohere.com/reference/rerank)、[Voyage Multimodal Embeddings](https://docs.voyageai.com/reference/multimodal-embeddings-api)。这些文档描述的是各自 provider 的接口和型号合同，不是跨厂商一致的语义标准。

### 两种“融合”不是一回事

- **Embedding 的多模态 fusion**：编码阶段把同一资产/输入组中的文本、图片等内容一起编码成一个向量（或 provider 的独立模式逐项返回多个向量）。例如 DashScope 的 `enable_fusion`，或 Voyage/Cohere 在一个 `content` 中提交多模态内容。这决定“这个资产如何表示”。
- **RRF 等结果融合**：检索阶段分别取得文本和图片候选排名，再把多个有序结果列表合并。这决定“不同检索 channel 的候选如何排队”。

前者不能自动校准“文本资产 vs 图片资产”的排名偏好；把 OCR 文本与图片内容融合进一个向量，理论上甚至可能强化词面信号，但这是针对本问题的推断，尚未在当前模型/数据上验证。后者避免直接相加不同 channel 的原始分数，也不自动意味着视觉优先。两者不能因字段名或“fusion”一词而混为同一策略。

### Rerank 没有广泛统一的 provider API

Cohere 的公开 rerank 接口使用 `model`、`query`、字符串数组 `documents`，响应含排序后的 `results[{index, relevance_score}]`。它当前定位为**文本**重排。Qwen3-VL-Reranker 则是多模态 query-document 模型，可接收图像等输入，但其 model/API 输入合同与 Cohere 不同。共同的只是“用 query 对候选逐项评分并重排”的操作概念，不是统一的 wire schema、模态范围、分数标尺或模型能力。[Cohere Rerank v2 API](https://docs.cohere.com/reference/rerank)、[Qwen3-VL-Reranker 模型卡](https://huggingface.co/Qwen/Qwen3-VL-Reranker-2B)

当前仓库只有 `openai-embeddings-v1` 和 `dashscope-multimodal-v1` 两种 embedding adapter；`src/shared/embedding/http-service.ts` 负责请求体转换，`src/main/embedding-http-index.ts` 负责索引/查询。源码中没有 provider-neutral rerank operation 或 reranker adapter。现有多模态接口落差说明内部 adapter 应承担 provider 转换，而不是要求所有 provider 伪装成 OpenAI endpoint。

### 可供后续讨论的内部合同

以下是设计建议，不代表已批准实现：

- 模型能力按具体 `provider + model + revision` 声明/验证：支持的输入模态、`query/document` 等任务角色、是否支持 instruction、输出维度/编码、每请求限制、预处理约定；另声明 `independent`、`fused` 或两者兼有，以及返回向量和输入 ID 的映射方式。API 能接收 image 字段不等于该型号真正支持图像；型号声称多模态也不等于当前 adapter/runtime 已验证。
- 统一 embedding 操作可表达“有稳定 ID 的输入项 + role + 可选 task instruction/融合组”，返回“按输入 ID 关联的向量或融合向量 + profile/model 标识 + usage/错误”。Wire protocol 留在 provider adapter 内；模型维度、归一化、图像预处理、融合模式和 query/document 配对属于向量 profile。
- rerank 作为独立可选能力，而非假设 embedding provider 必然有 rerank：接收 query 与有稳定 ID、带模态标注的候选，返回按 ID 对应的排名及 provider score；adapter 声明支持的候选模态、批量/长度限制和指令能力。score 只用于该模型约定内的排序，跨模型或跨 provider 不直接比较。

### 已确认的搜索入口约束

用户已明确：**开启语义搜索后，默认使用语义检索；所有类型按内容相关性混排，不固定偏向图片。** 默认不筛掉纯文本或拆成两个结果区。上一节的视觉范围/优先建议属于早期候选，不是当前选定的默认方案；具体校准与排序实现仍需受控实验。

### 本地 llama.cpp 与 Ollama 接口补充（2026-10-11）

llama.cpp 当前上游 server 文档记载 `/v1/embeddings` 支持 OpenAI 风格 `data[].embedding`；启用 `--embedding --pooling mean` 并提供 `--mmproj` 时，多模态扩展允许 `input` 项使用 `{content:[{type:"image_url", image_url:{url:...}}]}`。这是 llama.cpp 自己扩展的请求形状，不属于 OpenAI Embeddings API 标准。当前 Serpent 的 `src/main/embedding-llama-session.ts` 正调用该 endpoint：文本传 `input:[text]`，图片传上述 `content/image_url`，解析 `data[0].embedding`；启动参数包含 `--embedding --pooling mean --mmproj`。`src/main/embedding-install.ts` 固定发布 `b11457`，所以 master 文档只能说明上游当前合同，不能单独替代 pinned build 验证；仓库已有代码注释记录该 pinned build 通过 EmbeddingGemma 图像 canary，本次没有重跑。

Ollama 原生 `/api/embed` 的公开合同面向文本：`input` 为字符串或字符串数组，可用 `truncate`、`dimensions`，响应为 `embeddings`。其 OpenAI 兼容 `/v1/embeddings` 文档同样只列文本字符串/字符串数组，支持 `dimensions`，且属于 OpenAI API 子集。Ollama `api/types.go` 新版注释提到 image/audio map 输入，但 embeddings 能力文档及 OpenAPI schema 仍描述文本，因此不能据此确认公共 embedding endpoint 可生成图像向量；视觉聊天支持也不构成图像 embedding 证据。旧 `/api/embeddings` 已被官方标为由 `/api/embed` 取代。

因此“请求格式兼容”与“模型/adapter/runtime 具备图像 embedding 能力”是两项不同声明。评估本地 provider 时需记录实际版本、模型和 endpoint，并分别做文本与图片 smoke；OpenAI 兼容形状本身不保证跨实现接受相同多模态扩展。

### API 格式与 EmbeddingGemma 2 图像检索机制（用户确认约束；2026-10-11）

用户已确认：embedding API 格式必须可配置；当前候选为 OpenAI-compatible 与 DashScope。设置标签宜采用各自官方名称“OpenAI-compatible Embeddings API”和“DashScope Multimodal Embedding API”，并保留各协议自己的字段/语义。仓库已有 `openai-embeddings-v1`、`dashscope-multimodal-v1` adapter，并由用户显式选择；本记录是产品约束与命名建议，不代表本次新增实现。

Google 的 **EmbeddingGemma 2**（不是仅文本的前代 EmbeddingGemma）官方资料称它包含可选择加载的 vision encoder，且将文本和图像等映射到统一的 768 维空间。模型卡列出 mean pooling 和 512→768 projection；检索文本 query 使用 `task: search result | query: ...` 前缀，文本文档使用 `title: ... | text: ...`，图片不加文本前缀。官方多模态指南明确可直接比较 text-only query 与 image embedding。因此“文本 query 搜图片”不要求融合：分别把 query 和图像编码成同空间向量后做相似度，就是 cross-modal retrieval。`enable_fusion`/图文合一语义只在希望一条输入同时含文本与图片并生成单条联合向量时才需要，且 API 对应字段由 provider/model 决定。

llama.cpp 的通用多模态说明称 `mmproj` 文件负责图像编码和投影，再把视觉 embeddings 送入语言模型；它不是最终检索向量，也不是 fusion 开关。Google 模型卡给出 EmbeddingGemma 2 的视觉 encoder、pooling 与输出 projection 角色；但本次没有检查项目每一份 GGUF 的 tensor 清单，故不进一步断言本项目 `mmproj` 文件内部具体包含哪些权重。仓库当前配置 `--mmproj --embedding --pooling mean`，profile 为 768 维，并在 cosine 前通过 `normalizeEmbedding` 做 L2 归一。此处是文档/源码合同核对，没有重跑本地图片 smoke，也不证明 OCR-heavy 资产排序问题已解决。

## 一手来源

- [阿里云 Model Studio：Multimodal Embedding API Reference](https://help.aliyun.com/en/model-studio/multimodal-embedding-api-reference) — `instruct`、可选维度、Qwen3-VL 独立/融合 embedding 与服务输入合同。
- [OpenAI：Embeddings API Reference](https://developers.openai.com/api/reference/resources/embeddings/methods/create) — 文本 `input`、`dimensions`、`encoding_format` 与 `{data, model, object, usage}` 响应结构。
- [llama.cpp：HTTP Server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) — 上游当前 `/v1/embeddings`、原生 `/embeddings`/`/embedding`、pooling 与 mmproj 图像输入扩展说明。
- [Google：EmbeddingGemma 2 model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2) — EmbeddingGemma 2 的模态 encoder、768 维空间、pooling、projection、query/doc prompt 与归一化注意事项。
- [Google：Multimodal Embeddings with EmbeddingGemma 2](https://ai.google.dev/gemma/docs/embeddinggemma/multimodal-embeddinggemma-with-sentence-transformers) — 同空间跨模态检索以及单次输入图文组合的可选用法。
- [llama.cpp：Multimodal README](https://github.com/ggml-org/llama.cpp/blob/master/tools/mtmd/README.md) — 通用 mmproj 图像编码/投影与语言模型输入说明；不证明某个模型包内权重的确切组成。
- [Ollama：Embeddings capability](https://github.com/ollama/ollama/blob/main/docs/capabilities/embeddings.mdx)、[OpenAI compatibility](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx) — 原生 `/api/embed` 与兼容 `/v1/embeddings` 合同；[Ollama API docs](https://github.com/ollama/ollama/blob/main/docs/api.md) 将 `/api/embeddings` 标为已取代。
- [Ollama：EmbedRequest source](https://github.com/ollama/ollama/blob/main/api/types.go) — 输入类型注释与 `truncate`、`dimensions` 字段；image/audio 注释不足以证明公共图像 embedding endpoint 可用。
- [Cohere：Embeddings](https://docs.cohere.com/docs/embeddings)、[Rerank API v2](https://docs.cohere.com/reference/rerank) — 模型任务角色、多模态输入与文本 rerank 字段。
- [Voyage：Multimodal Embeddings API](https://docs.voyageai.com/reference/multimodal-embeddings-api) — 混合内容输入以及 query/document 角色。
- [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) — OpenAPI 是描述 HTTP API 的规范格式，不是 embedding/rerank 跨 provider 语义合同。
- [Qwen：Qwen3-VL-Embedding-2B 模型卡](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B) — 支持模态、共享表示空间与 instruction-aware 描述。
- [Qwen：Qwen3-VL-Reranker-2B 模型卡](https://huggingface.co/Qwen/Qwen3-VL-Reranker-2B) — 多模态 query-document rerank 的任务边界和官方基准。
- [OpenAI：Multimodal neurons in artificial neural networks](https://openai.com/index/multimodal-neurons/)；[Radford 等：CLIP](https://arxiv.org/abs/2103.00020) — CLIP 的文字图像反应与 OCR 能力，仅用于说明潜在机制，不能直接外推到当前模型。
- [Liang 等：Mind the Gap](https://arxiv.org/abs/2203.02053) — CLIP 式对比学习中模态间隔的研究，不作为固定惩罚值证据。
- [Cormack 等：Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) — RRF 定义与其检索融合实验。
