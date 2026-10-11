# 图片找相似一期（2026-10-11）

## 范围

按《通用 Embedding 接入与资产找相似》的第 1 步，在现有 Gemma 实验索引上提供单张图片找相似。通用模型配置、Worker 向量库、库绑定和云端模态没有做。

卡片上的余弦分数是调试显示，已去掉。排序仍用同一套归一化向量的点积，结果里不出现分数。

## 行为

语义搜索关闭、多选和回收站不出现「找相似」。JPG、PNG、WebP 静图可以查；序列和其他类型菜单项在，但不能点。

已有向量时直接用缓存向量和库内其他图片比较，不再编码，也不再请求文本模型。源图不出现在结果里。还没有向量、索引仍在计算时，这张图排到编码队列前面，界面保持当前浏览，算完后再换成相似结果。

结果沿用语义搜索的 25/50/100 分页。顶部是来源缩略图和「与此资产相似」。搜索框原文不改。返回走浏览历史，回到进入前的位置。

## 验证

- `npx vitest run --config vitest.config.ts tests/unit/find-similar.test.ts tests/unit/asset-commands.test.ts tests/unit/embedding-test-index.test.ts`：3 files / 70 passed。
- `npx tsc --noEmit`：通过。
- 未跑 `test:library-availability`：这次没有改资源库 schema 或 Worker 库协议。
- 未跑真实 Electron 找相似。packaged 与 macOS 未执行。

`EMBED-SCORE-001` 已撤回。`EMBED-SIMILAR-001` 待人类验收。

## 2026-10-11 续

菜单图标改为扫码框。预览失败，或修订记录变成损坏标记的文件，不再编码，已写入的向量在下次追平时从索引里去掉。结果条的布局另开工单，这次不改。

JPG、PNG、WebP 静图仍编码原文件。音频转成 16 kHz 单声道 WAV，按 llama-server 的 `input_audio` 内容块编码；超过 120 秒按段取均值，最多 16 段。文本按 `title: 文件名 | text: 正文` 编码，正文取前 2500 字。其他格式在缩略图就绪后编码缩略图。视频时间线仍用缩略图：模型卡把视频当作抽帧，当前这套 llama.cpp 的视频输入还没有经过验证。

定向测试：`npx vitest run --config vitest.config.ts tests/unit/find-similar.test.ts tests/unit/embedding-audio.test.ts tests/unit/asset-commands.test.ts tests/unit/embedding-test-index.test.ts`，4 files / 76 passed。`npx tsc --noEmit` 通过。没有对真实 llama-server 送过一段音频。
