# 语义索引预览路径失败修复方案

日期：2026-10-13
关联工单：`Serpent-424d7b`

## 现象与证据

对当前活动资源库做只读聚合诊断后，剩余失败项均属于 `preparation`：

- 16 项失败均依赖已有缩略图或视频海报；扩展名分布为 AVIF 11、MP4 3、GIF 1、PNG 1。
- 数据库记录均为 `ready` 且未失效，派生文件在资源库的 `.serpent/artifacts` 中真实存在。
- 每项已尝试 4–7 次，说明失败可稳定复现，并非模型偶发拒绝。
- 相同相对路径在 Worker 进程工作目录下不存在。

根因位于 `semantic.index.prepare`：`LibraryService.getThumbnailArtifact()` 返回的 `filePath` 是资源库派生目录内的相对路径，语义准备代码却直接将它交给 `stat()` 和 `readFileBounded()`。其他媒体/AI 路径通过 `LibraryService.getArtifactAbsolutePath()` 做资源库归属、当前 revision、文件存在性和符号链接边界校验。

因此，需要派生预览的 image-only provider 会以 `ENOENT` 进入 `preparation` 失败；MP4、GIF、AVIF 只是最容易落入该路径的类型。本地支持 video 的 provider 必须直接接收原视频，不能因已有海报而改送图像。

## 修复范围

1. 在 `src/worker/handlers/semantic-index.ts` 的图像准备分支中：
   - 原图直读路径继续使用 `resolveAssetPath()`。
   - 派生预览先取 `artifactId`，再用 `getArtifactAbsolutePath(libraryId, artifactId, 'preview')` 得到经过安全校验的绝对路径。
   - 不自行拼接 `.serpent/artifacts`，复用现有统一解析与边界检查。
2. 保留当前失败分类：解析/文件读取失败仍归为 `preparation`；不改 SQLite schema。
3. 既有失败行不做破坏性清空。修复后，超过一分钟重试窗口的 durable job 会在下一次索引 generation 中重新 claim；成功写入后转为 `ready`，历史失败计数自然收敛。
4. 若绝对路径解析发现文件确实缺失，继续失败并等待已有的缺失派生文件 reconciliation 失效并重建，不能绕过安全检查读取任意路径。

## 产品不变量更正：模型支持原始模态时禁止使用封面

用户于 2026-10-13 再次明确：资产的原始模态只要被当前模型及运行时支持，就必须送入对应原始模态通道，禁止为了接入方便改用封面或缩略图。预览图只允许作为模型不支持该原始模态时的兜底输入。

因此，上述 MP4 海报路径修复只保留给“不支持视频、但支持图像”的编码器；本地 EmbeddingGemma 2 必须改为原生视频输入：

1. `EmbeddingSourceModality`、Worker 命令/响应和索引目标增加 `video`，本地档案声明实际输入通道为 image/video/audio/text。
2. `embeddingSourceForModalities()` 对视频优先返回原视频 revision；只有选中编码器没有 video、但有 image 且资产已有可用预览时，才返回缩略图 revision。
3. Worker 的 `semantic.index.prepare` 对 video 读取当前原始资产，不查询 `video_poster`，执行 revision 二次核验并返回有大小上限的 MP4 payload。超过当前安全输入上限时明确失败，不能静默换封面。
4. 本地 llama-server 使用固定版本支持的 `/v1/embeddings` typed content：`input_video`；启动时显式传入 1 FPS 和应用随附 FFmpeg/ffprobe 所在目录。视频内容走 raw base64，不把资源库路径暴露给 HTTP 服务，也不扩大 `--media-path`。
5. `EmbeddingTestIndex` 对 video 调用独立的 `embedVideoPayload()`。失败归为 provider 或 preparation，不回退到 image。
6. 现有 MP4 Worker 回归改为两组：本地四模态档案即使没有海报也选择并准备原 MP4；仅图像档案才使用已就绪海报。两组 source revision、MIME、payload 和找相似状态必须分别断言。
7. 同步撤回开发日志、QA 和人类验收清单中“本地视频使用封面”的错误表述。

依据：Google 官方模型卡规定视频按帧通过视觉编码器处理，默认 1 FPS；固定的 llama.cpp server 文档明确 `/v1/embeddings` 接受 `input_video` typed content，并提供 `--video-fps` 与 `--video-ffmpeg-dir`。

## 回归测试

先把 `tests/worker/semantic-index-handler.test.ts` 中当前错误地把 MP4 海报准备失败写成预期行为的用例改成回归测试：

1. 在隔离资源库的 `.serpent/artifacts` 写入合成 JPEG 字节，并让 `revision_artifacts.file_path` 只保存相对文件名。
2. 当前代码应因按工作目录读取而失败，形成精确红灯。
3. 修复后断言 `semantic.index.prepare` 返回 `kind: image`、`mimeType: image/jpeg`，且返回字节与派生文件一致。
4. 保留找相似从 `preparing` 到成功向量写入/`ready` 的覆盖；不得再把路径错误标为产品允许的失败。
5. 增加一个缺失派生文件的负例，确认仍被归类为准备失败，不绕过 `getArtifactAbsolutePath()` 的安全边界。

## 验证门禁

- 定向 Worker：`semantic-index-handler` 与 `semantic-index-store`。
- 类型检查和相关 ESLint。
- `npm run test:library-availability`（触及 `LibraryService`/资源库读取边界，必须完整执行）。
- 后台运行 `tests/e2e/semantic-sqlite-lifecycle.test.ts`，验证完整退出和重启后失败项可恢复并复用索引。
- 只汇报本次实际运行结果；packaged 与 Windows 未执行时继续明确记录为未验证。

## 完成判定

- 对 image-only provider，合成 MP4/GIF/AVIF 的 ready preview 可通过安全绝对路径作为图像输入；缺失/损坏 artifact 仍明确失败。
- 对支持 video 的本地 provider，即使没有 poster，也从当前 revision 读取有界原视频并使用 typed video 输入；超限或运行时缺失明确失败，不回退封面。
- 当前活动资源库此前报告的失败项、真实 provider 推理、完整退出重启、packaged 与 Windows 证据需分别验证，不由合成夹具和本地测试结果代替。
