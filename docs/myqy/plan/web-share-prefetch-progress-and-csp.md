# 计划（交接）：网页分享预取进度条 + CSP/预加载修复

> 状态：**已完成**（源码已本地提交，未推送）
> 创建：2026-10-01 ｜ 完成：2026-10-01
> 前置计划：[`web-share-big-image-lod-and-prefetch.md`](./web-share-big-image-lod-and-prefetch.md)（批次 1–3 已全部完成并提交）
> 规则：[`../web-share-preview.md`](../web-share-preview.md)、[`../git-rules.md`](../git-rules.md)

## 一、本任务的由来（用户原始诉求）

用户在浏览器控制台看到一堆报错，并反馈"自动下载好像并没有什么作用"；随后要求在**开发测试页面**顶部工具栏最右侧加一个**进度条**，显示自动下载 webp82 / webp100 的进度。

控制台原文关键行：
- `Executing inline script violates ... 'script-src 'self''` → 入口 HTML 的内联脚本被 CSP 拦截（设置 `<html lang>` 的那段）。
- `A preload for '.../index-*.js' is found, but is not used because the request credentials mode does not match` → Early Hints 预加载因缺 `crossorigin` 被丢弃。
- `Loading 'https://static.cloudflareinsights.com/beacon.min.js' violates ... "script-src 'self'"` → Cloudflare 注入的统计脚本被拦。
- 多条 `The resource <URL> was preloaded using link preload but not used within a few seconds ...`。

## 二、诊断结论（"自动下载没作用"的根因）

用 headless Chromium（Playwright）对运行中的分享服务（一个 118 张图的分享库）实测：

- **预取本身在工作**：一次干净会话内产生 **236 次 `/media/view` 请求**（118 图 ×2 档），IndexedDB `serpent-web-share` 有 **236 条记录、约 67 MB**。
- **根因是"没有可见反馈"**：预取在后台静默进行，页面无任何进度指示，用户便以为"没作用"。
- 附带确认：初次 15s 探测只看到 0 条记录，是因为首张图派生编码冷启动较慢；等待 20s 后两档全部完成。非功能缺陷。

结论：预取功能正常，缺的是**可见进度**（本任务新增进度条）+ 控制台报错（本任务修复 CSP/预加载）。

## 三、实际落地内容（与最初草案的差异）

### 3.1 CSP 内联脚本（根因修复）

原草案打算给内联脚本加 sha256 hash。核对构建产物后发现：
- 计划里写的 hash `sha256-hkrZITuB/...` 与真实构建产物**都不匹配**（源、主线、预览入口的内联脚本实测 hash 均为 `sha256-cY42Qb/5Dql7D7mt6GZ/L0rHOSdbGpjXEFqfbrpdSdE=`）。
- 硬编码 hash 会随脚本文字/空白漂移，且是一处会静默失效的门。

最终选择**移除内联脚本**（更彻底）：把 `<html lang>` 的设置从 `index.html` 内联脚本移到 `main.tsx`（复用 `i18n.ts` 的 `PREFERS_CHINESE`）。入口文档不再含内联脚本，CSP 的 `script-src 'self'` 即可，无需 hash。`<link rel="icon" href="data:," />` 抑制浏览器自动请求 `/favicon.ico`。

### 3.2 Cloudflare Insights

`script-src` 追加 `https://static.cloudflareinsights.com`，`connect-src` 追加 `https://cloudflareinsights.com https://static.cloudflareinsights.com`。这是选定的处理方式（与之前"继续拦"不同）；隧道下 beacon 可正常上报，控制台不再报 CSP 违规。

### 3.3 Early Hints 预加载未复用

`entryAssetHintHeaders()` 生成的 `Link: rel=preload` 追加 `; crossorigin`，与 Vite 在 HTML 里给 module script / stylesheet 打的 `crossorigin` 属性一致。

### 3.4 缺失文件不再回退 SPA 入口（额外发现的根因）

`/favicon.ico` 等缺失文件此前被 `resolveStaticFile` 回退成 **根 `index.html`**，其 Early Hints 又会预加载根 bundle（永远不会被使用）→ 正是"preload 未被使用"那几条告警的来源。修复：`resolveStaticFile` 对**带扩展名**的路径直接返回 `null`（404），只有无扩展名的客户端路由才回退到 SPA 入口。配合 §3.1 的 favicon data link，告警彻底消失。

### 3.5 预取进度条 UI

- `prefetch-queue.ts`：`PrefetchProgress` 增加 `images`；新增 `subscribe()` / `progress` / `#setProgress()`；`stop()` 复位进度；`#run` 的 `finally` 仅在 generation 未变时收尾（避免旧运行覆盖新进度）。
- 新增 `PrefetchIndicator.tsx`：订阅队列，顶部工具栏最右渲染「自动缓存 82 完成/总数 · 100 完成/总数」两条细进度条（`role="progressbar"`），空闲/完成时隐藏。档位完成数由"先整库 low 再整库 high"的严格顺序推导。
- `App.tsx` 在 `grid-density-control` 之后挂载 `<PrefetchIndicator />`；`styles.css` 用主题 token 新增样式（`--ui-content-*`、`--ui-action-accent`、`--ui-radius-pill`、`--ui-space-*`）。

### 3.6 预取竞态修复 + 完成态驻留（用户复测追加）

用户复测时仍看不到进度条。无头 Chromium 对隧道实测发现真实竞态：`PrefetchQueue.start()` 在已有运行中时会被 `if (!this.#running)` **静默丢弃**。页面 effect 若重跑（例如启动时一次瞬态 401 导致 `phase` 抖动），cleanup 的 `stop()` 会中止并复位当前 run，紧接着的 `start()` 因旧 run 尚未收尾而不启动——预取"假死"、进度条也不再出现。

- `prefetch-queue.ts`：新增 `#ensureRunning()` / `#restart`，运行中的 `start()`/`resume()` 记下重启动请求，旧 run 察觉 generation 被超越后立刻按最新资产重新起跑；`stop()` 清除该标记。
- `PrefetchIndicator.tsx`：完成态**驻留约 6 秒**再隐藏（`DONE_LINGER_MS`），避免快网/热缓存下"一闪而过"。

### 3.7 Early Hints 在隧道下仍可能告警（记录，未处理）

经 Cloudflare 隧道时，用户控制台仍偶发 `preloaded using link preload but not used`（Cloudflare 的边缘 Early Hints 处理我们无法控制；本地直连已验证 `crossorigin` 修复生效、无此告警）。属边缘层行为，暂不处理，记录待观察。

### 3.8 预取准确计数 + 并发加速（用户复测追加二）

用户复测反馈"进度显示完成、但下载到本机后并无帮助，等很久打开图仍慢"。无头 Chromium 隧道实测确认缓存链路正常（完整 236 次全 200、IndexedDB 235 条、打开查看器 0 网络请求），真正问题是**预取太慢**（顺序下载，隧道下需数分钟）且**计数不诚实**（失败也计 `completed`，进度条可 100% 而无任何缓存）。

- `prefetch-cache.ts`：`put()` 返回 `boolean`，仅真正写入成功才算成功。
- `prefetch-queue.ts`：新增 `failed`；仅成功写入/缓存命中计 `completed`；`#download` 失败重试一次（300ms）；同档内 3 个并发 worker（`concurrency` 选项，测试默认 1）。
- `PrefetchIndicator.tsx`：完成判定 `completed + failed >= total`；有失败显示「失败 N」。
- 隧道实测：并发 3 下 42s 内约 170 次 `/media/view`（此前顺序约 79，约 2 倍）。

### 3.9 预取全部失败的根因：fetch `Illegal invocation`（用户复测追加三）

用户截图「82 0/118 · 100 0/118 · 失败 42」——每次下载都失败、什么都没缓存，这才是“自动下载没帮助、等多久都慢”的**根因**。

`PrefetchQueue` 把 `fetch` 裸存实例字段，却以 `this.#fetchImpl(url,…)` 调用，浏览器因此以队列实例为 `this` 调用 `fetch` → 抛 `TypeError: Illegal invocation`，**在任何请求前**就失败；`#download` 吞掉异常，旧代码又把失败计为完成，于是进度条谎报 100%、IndexedDB 全空。

之前没发现的原因：所有无头探针都会 `addInitScript` 打补丁并 `.bind(window)` `fetch`，掩盖了绑定问题；用**不打补丁**的真实登录流程探针即稳定复现（4/4 失败、145 失败、0 请求）。

修复：构造函数 `this.#fetchImpl = (options.fetchImpl ?? globalThis.fetch).bind(globalThis)`；新增回归单测。不打补丁探针验证：修复前 4/4 失败，修复后本地 236 全 200 / 236 条，隧道 130 全 200 且持续写入。

### 3.10 实时下载速度显示（用户要求）

用户要求在进度条前显示自动下载的实时速度（3 路并发合计）。

- `prefetch-queue.ts`：新增 `#totalBytes`（每个成功写入累加 `blob.size`）；`#startSpeedSampling()` 每秒采样一次，用 0.5 EMA 平滑，写入 `PrefetchProgress.speed`（字节/秒）；运行时启动、结束/中止/停止时清除。
- `PrefetchIndicator.tsx`：`progress.active && speed > 0` 时在「自动缓存」后显示 `formatBytes(speed)/s`。
- 验证：隧道实测显示 `55 KB/s → 1007 KB/s`；单测覆盖速度上报与显示。

### 3.11 查看器残留 blob 破图 + 关闭查看器重载缩略图（用户复测追加四）

- 破图根因：`Viewer` 的 `cachedLow/cachedHigh` 状态在切图首帧仍存有**上一张**的 `blob:` URL，被新 `ZoomImage` 当作初始 `src`，随后该 URL 被 revoke；且 `ZoomImage` 的 `displaySrc` 不跟随 `src` 变化。修复：缓存改为 `{key,low,high}` 且仅在 key 匹配当前资产时使用；`ZoomImage` 渲染期跟随 `src`（不把高档降回低档）。
- 关闭重载根因：`Thumb` 在查看器打开时返回占位 `<span>`，关闭时 `<img>` 重新挂载。修复：保持缩略图挂载。
- 验证：真实浏览器连续翻 10 张全部 `blob:` 命中、0 破图；关闭后 `/media/thumbnail` 0 次新请求。

## 四、验证证据

- `npm run typecheck` 通过；改动文件 `npx eslint` 无输出。
- 定向单测：`web-share-prefetch-queue` / `web-share-prefetch-cache` / `web-share-prefetch-indicator` / `web-share-server` / `web-share-app` / `web-share-viewer` 共 6 文件 58 测试全绿。
- 全量 `npx vitest run tests/unit`：4174 通过 / 5 跳过 / 4 失败；4 个失败全部是 Windows `symlinkSync EPERM`（`plugin-install-failure-detail`、`artifact-response`、`desktop-ingestion`），与本次改动无关，属环境限制。
- headless Chromium（Playwright）对重启后的服务实测 `/web-preview/`：
  - 控制台 **0 条消息**（CSP 内联、preload credentials、preload 未使用、Insights 全部消失）。
  - 进度条实测采样：`自动缓存 82 18/118 100 0/118` → `… 82 118/118 100 112/118`。
  - 236 次 `/media/view`、IndexedDB 236 条 / 67,356,046 B（low 118 + high 118）。
- 追加修正后本地无头实测：进度条出现并推进到 `82 118/118 100 118/118` 时驻留、随后隐藏；236 次 `/media/view` 全 200、IndexedDB 236 条、控制台 0 消息。
- 未执行：真实 Cloudflare 隧道下 Insights 表现、packaged、Windows —— 待人工验收。

## 五、关键文件

| 文件 | 改动 |
| --- | --- |
| `src/myqy-web-share/client/index.html` | 删除内联 lang 脚本；新增 `<link rel="icon" href="data:,">` |
| `src/myqy-web-share/client/main.tsx` | 用 `PREFERS_CHINESE` 设置 `<html lang>` |
| `src/myqy-web-share/client/PrefetchIndicator.tsx` | 新增进度条组件 + `tierCompletion` |
| `src/myqy-web-share/client/App.tsx` | 工具栏挂载进度条 |
| `src/myqy-web-share/client/prefetch-queue.ts` | `images`、`subscribe`、`stop` 复位、finally 防覆盖 |
| `src/myqy-web-share/client/styles.css` | 进度条样式（主题 token） |
| `src/myqy-web-share/server/web-share-server.ts` | CSP（去 hash、放行 Insights）、Link `crossorigin`、缺失文件 404 |
| `tests/unit/web-share-server.test.ts` | CSP/Link/404 断言 |
| `tests/unit/web-share-prefetch-queue.test.ts` | 进度订阅/复位测试 |
| `tests/unit/web-share-prefetch-indicator.test.tsx` | 新增指标组件测试 |

## 六、后续（需用户/人工）

- 用户验收 `/web-preview/` 的进度条与控制台。
- 验收通过后 `npm run web:build`，使主线 `/` 与测试页同态。
- 真实 Cloudflare 隧道、packaged、Windows 证据。
