# Embedding API 格式设置与显式适配

用户仅要求调整 API 格式相关内容。设置现提供「OpenAI 兼容」「llama.cpp 多模态」「DashScope 多模态」，每项名称下常驻一行中英文介绍。继续复用既有设置单选按钮、辅助文字、主题 token 和服务表单；格式控件抽成独立小组件。保持刚恢复的原始相似度排序，不添加文本扣分或相关性校正。

新增 `llamacpp-multimodal-v1`，与 OpenAI 共享地址、鉴权、HTTP 调用与按 index 映射响应的实现。文本仍发送字符串数组，图片按独立资产发送 `input[].content[].image_url`，不会把多张资产融合成一个向量。视频沿用已有缩略图路径；本轮不提供原生音频或视频请求。请求和响应严格按用户所选格式处理，格式不匹配报错，不自动猜测或重试其他格式。依据：[llama.cpp 官方服务文档](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-v1embeddings-openai-compatible-embeddings-api)。

已有 OpenAI 与 DashScope ID 保留；缺少 adapter 的旧服务仍默认 OpenAI。请求/响应 Zod 枚举与 preload 使用共享类型，避免设置能保存而桥接拒绝。切换格式复用 registry 原有的 profile 失效规则，清除旧连接验证与维度；后续按新 profile 建索引。未修改资源库绑定、schema 或 Worker 的文件/数据库所有权。

本轮只交付格式接入。现有连接测试仍发送两段示例文字，不能证明图像被模型实际使用；逐模态 canary 与能力状态属于后续范围。选择多模态格式不构成具体模型图像能力或检索质量已验证的承诺。

## 当次验证

- `npx vitest run tests/unit/embedding-http-service.test.ts tests/unit/embedding-api-format-control.test.tsx tests/unit/semantic-work.test.ts tests/unit/embedding-test-index.test.ts tests/unit/protocol.test.ts`：5 文件、152 条通过。覆盖图像分组、文本输入、共享传输、响应顺序、错误格式不回退、不支持输入不发送、保存/协议往返、切换格式失效、旧配置兼容、中英文说明和原始排序。
- `npm run test:library-availability`：9 文件、231 条通过，native ABI 与 FTS5 预检通过。
- 本轮涉及的 shared/main/renderer 文件与定向测试 ESLint 通过。包含 preload 的检查被已有两处 `import()` 类型写法阻断（`library.ts:2123`、`:2125`）；新 adapter 类型采用常规 `import type`。
- `npm run typecheck`：未通过；已有 `embedding-install.ts:260` 的回调参数隐式 any 阻断。该处不是本轮修改。
- 隔离 userData、隐藏窗口、独立临时构建的 `embedding-api-formats.test.ts`：未通过。两次均停在 `electron.launch`，90 秒超时，未执行任何 UI 断言；第二次开启 `DEBUG=pw:browser`，确认 inspector WebSocket 已连接，但 Electron 启动调用未返回。不以重跑或单元测试替代启动证据；测试现明确限定启动超时 30 秒。
- Computer Use 读取当前开发应用并截图：只获得空白内容区，未能操作设置控件。真实 UI 的亮暗主题、交互与完整重启恢复均未验证。未更改真实资源库或保存真实服务设置。
- Windows、packaged、真实 llama.cpp/DashScope/Ollama 服务连接未执行。

本轮临时 fixture、构建、trace 与日志在对应进程退出后清理；既有归属不明的临时目录未动。未添加含真实资源库、文件内容、本机目录或凭据的记录。

## 提交前复核

用户授权提交推送当前分支的语义搜索设置与接入相关改动。补跑 `npx vitest run tests/unit/asset-commands.test.ts tests/unit/embedding-install.test.ts tests/unit/embedding-library-binding.test.ts tests/unit/embedding-model-catalog.test.ts`：4 文件、78 条通过；`git diff --check` 通过。

全仓被跟踪文本与本轮新增文件做本机绝对路径、UNC 与凭据形状扫描，本轮相对 HEAD 新增匹配为零。全仓仍有既有匹配，包含历史 fixture 和规则示例；缺少统一白名单门禁，不宣称全仓零命中或隐私工单已收口。临时 UI 截图和脚本不入库。上述类型检查、preload lint 与 Electron 启动限制继续保留。

## 四列追溯

| 需求 | 实现位置 | 自动化证据 | 人工/平台证据 |
| --- | --- | --- | --- |
| 三个短名和常驻介绍 | `src/renderer/EmbeddingApiFormatControl.tsx:10`、`EmbeddingServiceSettings.tsx:284`、中英 catalogs | `tests/unit/embedding-api-format-control.test.tsx:7`，两种语言通过 | Computer Use 未完成；亮暗主题与窗口布局未验证 |
| 独立 llama.cpp 图像输入、严格响应格式 | `src/shared/embedding/http-service.ts:163`、`:219`、`src/main/embedding-http.ts` | `tests/unit/embedding-http-service.test.ts:38`、`:59`、共享传输用例通过 | 真实服务未执行；图像影响向量未验证 |
| 持久化 ID、协议与切换失效 | 共享 adapter 枚举、requests/responses、preload、既有 registry | `embedding-http-service.test.ts` 的协议往返与失效用例通过 | `tests/e2e/embedding-api-formats.test.ts:17` 启动阻断，完整退出重启未验证 |
| 检索支持范围与原始排序 | `src/main/embedding-http-index.ts:482`；既有 `scoreEmbeddings` 未变 | `semantic-work.test.ts:109` 与 `embedding-test-index.test.ts` 通过 | 真实检索、Windows、packaged 未验证 |

状态：实现与定向测试完成，最终验收未完成。`EMBED-API-001` 记录为验证阻断，不进入待人类验收，不影响 `EMBED-SEARCH-001` 的既有失败状态。
