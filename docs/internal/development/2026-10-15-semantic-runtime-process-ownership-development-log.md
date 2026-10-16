# 语义本机运行时进程所有权开发记录

- 规格：[语义运行时进程所有权与回收](../implementation/2026-10-15-semantic-runtime-process-ownership.md)
- 工单：`Serpent-e91544`（主 agent 已 claim）
- 分支：`dev`
- 基线 HEAD：`4e3ddf09`
- 开始日期：2026-10-15
- 当前状态：实现与定向自动化完成；Electron Main 进程集成通过；Windows/packaged/本机模型人工验收未执行
- 最后更新：2026-10-15

## 问题与根因

旧实现让 Main 直接启动 llama-server；正常 close 只发停止信号，不等待进程树退出。Main 被强制结束时，清理代码不会运行，语义运行时继续占用内存。规格中的真实 HTTP fixture 已复现：强杀所属 Main 后 6 秒 runtime 仍存活。

## 实现

- 新增 inline Node owner。Main 持有 owner 的 stdin 管道，owner 在独立生命周期内启动本实例 runtime；EOF、Main 正常关闭和启动 AbortSignal 都会进入确定的关闭路径。无临时 helper 脚本落盘。
- POSIX owner 为 runtime 创建独立进程组，先 SIGTERM，1 秒后升级 SIGKILL，并等到进程组消失后才以成功状态退出。超时或未确认退出会返回清理错误。
- Windows 在启动 runtime **之前**让 owner 自身加入 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job Object。runtime 自动继承 Job。正常停止先输出 STOP ACK，再调用 `TerminateJobObject(job, 0)`，owner 和 runtime 同时以 0 退出；runtime 自行退出时输出 REAP ACK 并清理遗留的 Job 成员。Main 或 owner 被强杀时，非继承 Job handle 关闭，由系统回收 Job。若 Job setup/assignment 失败则 fail closed，不降级到只杀 runtime 主进程。
- Windows Job API 由 inline helper 通过 `koffi` 调用；Main 只向该进程传递解析出的模块路径，不写入日志/文档/fixture。helper 用 Electron `process.execPath` 与 `ELECTRON_RUN_AS_NODE=1`，不依赖系统 Node。
- session 的 close 共用一个 Promise；关闭加载中的 session 会 abort startup 并等待 owner 清理。若 owner 清理失败，AggregateError 会保留到索引 close，不能被启动失败处理吞掉。
- `EmbeddingTestIndex.close()` 并发调用共享等待 Promise；快速切模型会取消旧的 AbortSignal、等待旧 session 清理，再启动新 session。Main `before-quit` 用 `allSettled` 等待所有关闭任务并逐项记录错误，然后再关闭 Worker 和 `app.exit(0)`；单一 shutdown Promise 避免重复 quit 并发清理。

## 测试与证据

已运行：

- `npx vitest run tests/unit/embedding-llama-session.test.ts tests/unit/embedding-process-lifecycle.test.ts tests/unit/embedding-test-index.test.ts` — 3 files passed；20 tests passed，1 个 gated Electron test skipped。覆盖真实 POSIX 进程：强杀 owner、忽略 SIGTERM 后升级 SIGKILL、正常/并发 close、启动未 ready 时取消、实例隔离；ACK 先于 close 到达仍保留；没有 ACK 的非零 owner exit 被拒绝；切模型 Abort、索引并发 close、GPU owner 清理失败时不启动 CPU fallback且失败继续可见。
- `npx tsc --noEmit` — 最终定向代码变更后通过。

Electron Main 专项命令（主 agent 统一执行；本 agent 未运行）：

```sh
SERPENT_EMBEDDING_TEST_ELECTRON=1 npx vitest run tests/unit/embedding-process-lifecycle.test.ts -t 'real Electron'
```

主 agent 最终执行结果：`1 passed / 6 skipped`，3.94 秒。该测试在系统临时目录构建 fixture，使用已安装 Electron executable（不设置 `ELECTRON_RUN_AS_NODE`），由常规 Electron Main 导入真实 session 模块，设置隔离 `userData`、不创建窗口，并依次验证正常 close 和强杀 Main 后 runtime 及其后代退出。退出事件监听在启动后立即缓存，避免正常退出早于断言监听的竞态。它是 Electron 进程集成测试，不覆盖 Serpent UI、真实资源库或应用索引开关全路径。早期试跑分别发现 fixture 的 builtin external 配置缺失和误用系统 Node 启动 Electron，均已修复。

## 风险、边界与未执行项

- Windows 未实测 Job ABI、Koffi FFI、嵌套 Job 限制、Electron `RunAsNode` 与打包路径；Windows/packaged 仍为未验证。
- POSIX 证据覆盖强杀 Main PID。若系统操作按映像名同时杀掉 Main 与 owner，runtime 无 Windows Job 的内核兜底；该终止方式不作保证。
- 真实 llama 模型内存回收、完整 Serpent 语义索引启用路径、Computer Use、真实资源库路径、packaged app 均未执行。
- 所有 POSIX fixture 运行在 `os.tmpdir()` 并由用例清理。Electron 集成测试使用独立临时 userData；通过和失败运行的 fixture 进程与临时目录均由用例清理。不得删除归属不明的路径。

## 重要文件

- [进程 owner](../../../src/main/embedding-process-owner.ts)
- [llama session](../../../src/main/embedding-llama-session.ts)
- [索引生命周期](../../../src/main/embedding-test-index.ts)
- [Main 退出等待](../../../src/main/index.ts)
- [进程回归测试](../../../tests/unit/embedding-process-lifecycle.test.ts)
- [索引回归测试](../../../tests/unit/embedding-test-index.test.ts)
- 人类验收项：`EMBED-PROC-001`（待用户本人验收）

## 用户验收

2026-10-15 用户确认「还行」并要求提交推送。`EMBED-PROC-001` 更新为人类验收通过，`Serpent-e91544` 关闭。以上 Windows、packaged 与完整应用自动化的未验证边界保持不变。
