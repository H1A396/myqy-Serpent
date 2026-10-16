# 语义搜索恢复原始相似度排序

用户反馈本轮方案体验不如之前，要求回退，并明确纯文本也不扣分。产品决定：保留模型原始相似度，不启用背景校正、RRF 或固定类型惩罚；不将现有实验候选交付为默认排序。API 格式接入设计保留。

背景校正仅运行于独立实验，尚未接入应用。本次撤回新增实验工具，保留脱敏测量为历史记录；真正需要修改的产品行为是共享评分函数中的纯文本 `0.12` 扣分，以及本地/HTTP 搜索对扣分选项的启用。向量和索引编码不变，不需要重建索引。没有证据证明偏差的全部根因，记录为当前模型检索能力限制，不以调分掩盖。

状态：代码修改与定向验证完成。共享评分没有类型扣分分支，本地和 HTTP 搜索都没有扣分参数；混合类型按原始分数与稳定 ID 排序。受影响测试已从“图片经扣分超过文本”改为“文本原始分数更高就排在图片之前”。API 接入与既有其他未提交工作保留，没有全仓回退。

当次验证：`npx vitest run tests/unit/embedding-test-index.test.ts tests/unit/embedding-http-service.test.ts`，2 文件、20 测试通过（约 937 ms）；`npx eslint src/main/embedding-test-index.ts src/main/embedding-http-index.ts tests/unit/embedding-test-index.test.ts` 通过。源码与测试搜索确认 `demoteTextChannel`、`EMBEDDING_TEXT_CHANNEL_PENALTY`、`embeddingChannelFromRevision` 已无残留。测试使用的临时目录由用例 finally 清理。

| 需求 | 实现 | 自动化 | 人工/平台 |
| --- | --- | --- | --- |
| 文本不扣分，全类型使用原始分数 | `src/main/embedding-test-index.ts` 的 `scoreEmbeddings` 与本地 search；`src/main/embedding-http-index.ts` 的 search | `tests/unit/embedding-test-index.test.ts` 的混合类型 raw cosine 用例；上述 20 条定向测试 | 当前应用新排序、packaged、Windows 未执行；`EMBED-SEARCH-001` 保持人类验收不通过 |

真实应用、packaged 与 Windows 排序复验尚未执行；不扩大已有验收状态。
