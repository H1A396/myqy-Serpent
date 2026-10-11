# 语义搜索：设置目录与资源库选用

## 行为

- 应用设置管理本机 EmbeddingGemma 安装和自定义向量服务。每个资源库在资源库设置里选用一项，或关闭。选择记在应用数据目录，不写入资源库数据库。
- 自定义服务保存支持的内容（图片、视频、音频、文字）和输出向量长度。长度可手填；留空时测试读取返回向量的长度。填写后，测试、索引和搜索都核对该长度。
- 兼容 OpenAI 的接口在有长度时发送 `dimensions`。通义多模态（如 qwen3-vl-embedding）使用单独的多模态接口，并发送 `parameters.dimension`。找相似仍只走本机模型。
- 本机安装把模型文件和当前系统可下载的 llama.cpp 运行程序放到应用数据目录，不打进应用包。
- 索引进度不再铺在工作区。后台任务指示只在安装或正在计算时出现。语义结果登记时保留当前搜索条件。

## 验证

- `npx tsc --noEmit` 通过。
- 定向单元测试：`tests/unit/embedding-http-service.test.ts`、`embedding-install.test.ts`、`embedding-library-binding.test.ts`、`semantic-work.test.ts`、`asset-commands.test.ts`、`semantic-search-preferences.test.ts` 共 6 个文件、80 项通过。测试不下载模型，也不写入密钥。
- 真实安装、通义接口和界面观感未在本环境点验。packaged 与 macOS 未执行。
