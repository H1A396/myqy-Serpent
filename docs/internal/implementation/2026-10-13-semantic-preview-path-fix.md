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

因此，所有需要用派生预览进行图像编码的资产都会以 `ENOENT` 进入 `preparation` 失败；MP4、GIF、AVIF 只是最容易落入该路径的类型。模型实际接收 JPEG/WebP 预览，并不存在模型格式不支持的问题。

## 修复范围

1. 在 `src/worker/handlers/semantic-index.ts` 的图像准备分支中：
   - 原图直读路径继续使用 `resolveAssetPath()`。
   - 派生预览先取 `artifactId`，再用 `getArtifactAbsolutePath(libraryId, artifactId, 'preview')` 得到经过安全校验的绝对路径。
   - 不自行拼接 `.serpent/artifacts`，复用现有统一解析与边界检查。
2. 保留当前失败分类：解析/文件读取失败仍归为 `preparation`；不改 SQLite schema。
3. 既有失败行不做破坏性清空。修复后，超过一分钟重试窗口的 durable job 会在下一次索引 generation 中重新 claim；成功写入后转为 `ready`，历史失败计数自然收敛。
4. 若绝对路径解析发现文件确实缺失，继续失败并等待已有的缺失派生文件 reconciliation 失效并重建，不能绕过安全检查读取任意路径。

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

- 合成 MP4/GIF/AVIF 预览路径均能准备为模型的图像输入。
- 当前活动资源库在重新索引后，原 16 个 `preparation` 失败项不再因路径解析失败而保留。
- 后台任务最终失败数与 durable `embedding_jobs` 一致；确实缺失或损坏的派生文件仍显示失败。
