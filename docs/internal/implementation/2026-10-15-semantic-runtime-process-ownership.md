# 语义搜索运行时的进程所有权与回收

工单：`Serpent-e91544`。主 agent 制定方案与监督审查，Luna high 开发。范围优先解决退出残留；空闲卸载、启动耗时测量另行推进。

## 已确认的问题与复现

- `embedding-llama-session` 直接启动外部运行时，正常清理依赖 Main 调用 `close()`。应用被强杀后无法执行退出回调。
- 正常应用退出最终调用 `app.exit()`，不能把 `will-quit` 中未等待的异步清理作为唯一保障。
- 原清理发送 SIGTERM 后不等待退出，也无 POSIX 升级终止。
- 2026-10-15：`npx vitest run tests/unit/embedding-process-lifecycle.test.ts` 在真实模拟 HTTP 运行时上复现：强杀所属进程后等待 6 秒，运行时仍存活。测试结束清理本次 fixture 进程与目录。

## 实施方案

1. **独立进程所有权**：外部运行时由一个轻量守护进程启动，Main 通过专有管道持有它。管道 EOF 覆盖主进程强杀、崩溃、启动阶段退出；守护进程负责终止本实例的运行时及其媒体子进程。不得按进程名批量杀死其他实例。
2. **明确退出边界**：普通 close 关闭所有权管道并等待回收完成；重复 close 共享同一个完成 Promise。Main 在 Worker 关闭及 `app.exit()` 前等待语义运行时清理；启动中取消也须纳入回收范围。
3. **平台策略**：POSIX 使用本实例独立进程组，先 SIGTERM，1 秒后升级 SIGKILL，并等待进程组消失；无法确认时以错误结束。Windows 在启动 runtime 前先把 guardian 自身加入启用了 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 Job Object；runtime 自动继承该 Job。正常 close 发出带 ACK 的 `TerminateJobObject(job, 0)`，Main 等 ACK 与 guardian 的 0 退出；Main/guardian 被强杀时，最后一个非继承 Job handle 关闭，由 Windows 回收整个 Job。这样消除了 spawn→assign 窗口，也覆盖同名结束 Serpent 主进程与 guardian。API 配置不适用或 Job assignment 失败时启动失败，不降级为只杀一个子进程。
4. **分发兼容**：guardian 使用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`；Windows 的 `koffi` 路径由 Main 相对应用 package 解析后以启动配置传给 inline helper。helper 不落盘，不依赖系统 Node。当前 Forge 未配置禁用 RunAsNode fuse；开发态 Electron 集成须单独执行，packaged app 与 Windows 均不能据静态检查记为通过。
5. **边界处理**：守护进程启动失败、运行时启动失败、启动中退出、运行时自行退出、清理超时、同时多实例、正常退出与强杀并发均不得导致未处理拒绝或清理其他用户进程。

## 验证与交付

| 需求 | 实现位置 | 自动化证据 | 平台/人工证据 |
| --- | --- | --- | --- |
| 强杀 Main 后回收运行时 | [embedding-process-owner.ts](../../../src/main/embedding-process-owner.ts) / [embedding-llama-session.ts](../../../src/main/embedding-llama-session.ts) | `tests/unit/embedding-process-lifecycle.test.ts` 的实际独立 owner + HTTP runtime fixture，强杀后检查 runtime 与后代 PID 消失 | POSIX 定向 fixture 已通过；Windows Job Object 未执行 |
| 正常退出等待清理、重复 close | [embedding-llama-session.ts](../../../src/main/embedding-llama-session.ts) / [index.ts](../../../src/main/index.ts) | 并发 session close、ACK 提前到达协议、索引快速切模型与并发 close | 真实 Electron fixture 命令见开发日志；由主 agent 统一运行 |
| 启动取消、启动清理失败传播、实例隔离 | [embedding-test-index.ts](../../../src/main/embedding-test-index.ts) | startup 未 ready 时取消并回收 runtime 后代；切模型 AbortSignal；两个 owner 互不影响；无 ACK 非零退出仍拒绝 | POSIX 定向 fixture / 单元测试已通过；Windows 未执行 |
| 真实 Electron 主进程所有权 | [embedding-process-lifecycle.test.ts](../../../tests/unit/embedding-process-lifecycle.test.ts) | gated fixture 启动常规 Electron executable、隔离 `userData`、无窗口，覆盖正常 session close 与强杀 Main | 主 agent 执行 1 passed / 6 skipped；这是 Electron 进程集成，不覆盖完整 Serpent 资源库路径。packaged/Windows 未执行 |

Windows Job Object 依据：[AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject) 要求目标 handle 具备 `PROCESS_SET_QUOTA` 与 `PROCESS_TERMINATE`；因此实现将当前 guardian 自身（伪句柄）加入 Job，避免额外打开进程 handle 权限。Windows 8+ 支持嵌套 Job；若宿主 Job 限制导致 assignment 失败则本地模型启动失败并可诊断，不退回弱清理。`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的语义见 [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)；`TerminateJobObject` 终止 Job 中所有进程，见[官方 API 文档](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject)。这些是静态依据，不代替 Windows 实测。

POSIX 边界：测试强杀的是 Main 所属进程，guardian 有独立进程身份与生命周期管道；若操作系统按映像名同时强杀所有 Serpent 进程（包括 guardian），POSIX 没有本实现所用的内核 Job 兜底，runtime 回收不作保证。Windows Job 方案覆盖这一情形。未经用户授权不提交或推送。
