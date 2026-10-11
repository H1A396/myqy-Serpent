# EmbeddingGemma 2 本地图像实验开发记录

日期：2026-10-10  
范围：阶段 1 独立 GGUF 图片检索实验。没有修改资源库 schema、Worker embedding 协议、设置界面或生产索引。

## 结果

新增 `scripts/embedding-gemma/experiment/` 独立 CLI：按 Q4_K_XL + Q8 投影、Q8_0 + Q8 投影、BF16 + BF16 投影顺序启动并关闭本地 `llama-server`。默认依次运行三档，也可用 `--profile` 单独诊断。样本目录限 2–100 张 JPG、PNG、WebP，建议 20–100 张；文本和图片查询至少提供一种。模型文件必须由用户预先放入仓库外选定目录，工具不下载权重、不连接资源库、不写数据库。

使用 `POST /v1/embeddings` 的嵌套图像输入 `input → content → image_url`。每档先提交程序生成的红、蓝、棋盘 PNG、重复红图和文本控制，校验 768 维有限非零向量、不同视觉内容有不同输出且重复输入接近一致；canary 失败时该档不产生图片排名，但会关闭服务并继续尝试后续档。图像查询和语料图均按扩展名推导 MIME、读取原始文件字节并经同一嵌套 image endpoint 编码；没有图像转文字或文本向量回退。文本 query 使用 `task: search result | query: ` 前缀，图像不加文本前缀。全部向量 L2 归一化后以 cosine dot product 排序。

实验输出在用户选定的外部目录内创建独立结果文件夹：`report.json` 与 `report.html` 使用样本 ID，不保存查询文本、源媒体文件名或绝对路径；路径与样本名写入本地 `sample-map.json` 并附隐私提示。报告页只含内嵌结果和脚本，不引用远程资源；用户显式选择样本目录与 map 后，页面才以浏览器对象 URL 显示可点击缩略图，不复制源媒体、不上传文件。渲染使用 DOM `textContent`；内嵌 JSON 对 HTML 特殊字符转义。跳过部分图片时 profile 和总报告标记 `partial`；任意 profile 失败时总报告为 `incomplete`，其余档位仍继续运行。

## 检查

定向单测：

```powershell
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/embedding-gemma-experiment.test.ts
```

结果：1 个测试文件、13 个测试全部通过。覆盖向量合法性与 cosine 排序、样本扫描边界、合成 PNG 可解码、HTTP 图像请求形状、逐档顺序与失败隔离、未验证图像路径拒绝、仅图片查询、partial 状态、脱敏报告不包含样本名/文字 query/动态绝对路径、静态结果页无远程链接和脚本语法。

其他定向检查：`npx tsc --noEmit --pretty false` 通过；对实验 CLI、核心、HTTP adapter、报告页、脱敏模块和定向测试运行 ESLint 通过；五个 `.mjs` 文件 `node --check` 通过；`node scripts/embedding-gemma/experiment/run.mjs --help` 显示至少一个文本或图片 query 的要求。未运行全仓库测试、Electron UI 或 packaged 验收；本次增量是独立脚本，不修改资源库路径。

## 真实 Q4 / Q8 runtime 证据

runtime 使用 llama.cpp `b11457`，完整 commit `5ad1c5da0ad7f6176256b823925aad19134f0263`。Q4 core SHA-256 为 `ea905fd08e8061db77a0031cbb5096d459d7cfd2bdd0ad2ba66e483f16719493`；Q8 投影 SHA-256 为 `90e7b0238009e2954f856f2081dcf7f35af026b64c765e98f4777053e1754460`。命令结构如下，变量分别由操作者指向样本目录、外部模型缓存、已有外部输出目录、固定版 runtime 和外部合成图片；实际本机值与文件名未写入仓库：

```powershell
node scripts/embedding-gemma/experiment/run.mjs --images $images --models $models --output $output --runtime $runtime --profile Q4_K_XL --query-image $queryImage --text 'a bright red square' --text 'a black and white checkerboard' --gpu-layers 0 --runtime-commit 5ad1c5da0ad7f6176256b823925aad19134f0263
```

结果：`report` 和 Q4 profile 均为 `completed`；本机 CPU、GPU layers 0；模型启动 2059 ms；2 张程序生成语料图片编码成功、0 张跳过。Canary verified：红/蓝最大坐标差 `0.0831355539`，红/棋盘 `0.0789491378`，蓝/棋盘 `0.0889112496`，红图/文本控制 `0.1318621795`；重复红图 cosine 为 `1.0`。文本红方块查询 Top-1 命中红图，cosine `0.7603`；棋盘查询 Top-1 命中棋盘，cosine `0.8050`。独立蓝色图片查询返回两个语料 Top-K，第一名 cosine `0.8902`。服务使用 loopback，并已干净退出。该合成小样本只证明 pinned Windows runtime 的 Q4 图像请求链路及检索排序可运行，不证明用户语料质量或生产索引表现。

Q8 命令使用同一 runtime、同一合成 2 图语料和独立蓝图 query，仅将 profile 切为 `Q8_0`：

```powershell
node scripts/embedding-gemma/experiment/run.mjs --images $images --models $models --output $output --runtime $runtime --profile Q8_0 --query-image $queryImage --text 'a bright red square' --text 'a black and white checkerboard' --gpu-layers 0 --runtime-commit 5ad1c5da0ad7f6176256b823925aad19134f0263
```

结果：Q8 report/profile 均 `completed`；startup 2061 ms，2/2 语料图片成功、0 skipped。Canary verified：红/蓝 `0.0849050636`、红/棋盘 `0.0822474638`、蓝/棋盘 `0.0883773303`、红图/文本控制 `0.1386325642`，重复红图 cosine `1.0`。两条文字查询的 Top-1 分别命中对应红图和棋盘图，cosine 分别为 `0.7611`、`0.8062`；独立蓝图 query 的 Top-1 cosine 为 `0.8869`。Q8 core SHA-256 为 `6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc`，与 Q4 共用的 Q8 投影 SHA 与上文相同。

BF16 命令沿用相同 runtime、2 张合成语料和独立蓝图 query，单独选择 profile：

```powershell
node scripts/embedding-gemma/experiment/run.mjs --images $images --models $models --output $output --runtime $runtime --profile BF16 --query-image $queryImage --text 'a bright red square' --text 'a black and white checkerboard' --gpu-layers 0 --runtime-commit 5ad1c5da0ad7f6176256b823925aad19134f0263
```

结果：BF16 report/profile 均 `completed`；core SHA-256 为 `f315cbbb30dd487e44d501c8902abe88808755e43753a96beed1964f0a48aa4f`，BF16 投影 SHA-256 为 `995aaa56e88b9b631f651861d659b728a625ccc02a238be37cff56cf11dc0032`。Startup 2565 ms，2/2 语料图成功、0 skipped。Canary verified：红/蓝 `0.0836630798`、红/棋盘 `0.0814698939`、蓝/棋盘 `0.0881700199`、红图/文本控制 `0.1387658357`；重复红图 cosine `1.0`。两条文字查询 Top-1 命中对应红图/棋盘图，cosine 分别 `0.7599`、`0.8055`；独立蓝图 query Top-1 cosine `0.8885`，Top-2 `0.7872`。服务正常退出。该 BF16 档与 Q4、Q8 一样在 pinned Windows runtime、CPU（GPU layers 0）上单独运行通过。

另以默认配置（不传 `--profile`）按 Q4_K_XL、Q8_0、BF16 顺序完成一次三档连续运行：overall report `completed`，三个 profile 均 `completed`、canary 全部 verified，各档均成功编码 2/2 张语料图且 0 skipped。运行使用相同 pinned Windows runtime、CPU（GPU layers 0）和合成查询集，服务逐档正常退出。macOS、GPU offload、长时间大语料、音频/视频、应用设置和资源库重建本阶段未执行。

## 待人类验收

清单新增 `EMBED-EXP-001`，状态为“待人类验收”，覆盖 Q4_K_XL、Q8_0、BF16 三档本地图像实验和本地报告页。三档单独 profile 与默认全三档连续运行均有真实合成 canary/检索通过证据；用户样本体验仍待实际操作和反馈。

## 设置里的语义搜索

设置左侧单独有「语义搜索」。可以打开或关闭语义搜索，并在 EmbeddingGemma 2 的较小、标准、较高三项里选择。选择和开关保存在本机界面偏好里，默认关闭、预选标准。不要求填写文件夹或运行程序。

搜索框右侧有语义搜索图标。选中后，搜索仍先按关键词返回，并说明语义索引还没开始。开启语义搜索后，主界面和后台任务里会出现一条语义索引：所选模型还没有安装，因此还没有开始逐张计算。`EMBED-MODEL-001`、`EMBED-SEARCH-001` 为待人类验收。

## 本机测试索引

不再扫描磁盘找模型，也不再停在「已经在这台电脑上，但还没逐张计算」。打开语义搜索后，用仓库根目录一份不进入版本库的测试配置指向已经下载的权重和固定版 llama-server，开始为当前资源库里的 JPG、PNG、WebP 计算向量。主界面和后台任务显示已计算张数。算完的图可以立刻用搜索框里的语义图标按文字检索；没算完时提示写明进度，不再退回关键词结果。向量放在应用数据目录，还不是资源库数据库。一键在线安装仍未做。

索引进度到头之后，新导入不再被丢掉。导入和其它资产变更本来就会通知主进程；语义索引接到同一条通知，只给还没有向量、或文件已经换成新版本的 JPG、PNG、WebP 补算。算失败的那一张不会在每次通知里重试。

语义结果不再把最相近的 100 张都铺出来。有显卡时启动参数是 99 层，并显式把图像投影放到显卡上；显卡启动失败才退回 CPU。

用当前约 600 张已编码图片对「倒影」做了一次分数统计，没有把文件名写入仓库。原始 cosine 全部落在 0.52 到 0.70，中位数 0.60。最高分和下一张只差约 0.006，前者是带大段文字的截图，后者是画面里的倒影。把「一整页文字」也编成向量后，它和这些图的相似度都低于查询本身，所以按超出部分扣分没有改变任何一张的名次或分数。绝对阈值 0.4 低于全库最低分，网格因此仍是上限 100 张。均值中心化会把分数拉开，但带文字的图仍排在前面。现在改为只保留与本次最高分相差不超过 0.02 的结果。这能去掉长尾，不能把文字从图像向量里拆出去。已有向量不用重算。
