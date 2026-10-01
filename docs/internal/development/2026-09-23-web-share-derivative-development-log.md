# 只读网页分享：慢速隧道下的压缩派生图与多格式下载

日期：2026-09-23

工单：`Serpent-720f02`（同批布局/配色改动）

## 背景

用户用香港节点建站并经隧道分享资源库，实测**下行约 200 KB/s**：12 MB 的图片要一分钟以上才能打开。测速结果（本次实测，`http://<分享地址>/`）：

| 请求 | 结果 |
| --- | --- |
| `GET /`（登录页 455 B） | HTTP 200，TTFB ≈ 123 ms |
| `/media/thumbnail/...`（无 Cookie） | HTTP 401，≈ 120 ms |

即**延迟正常（~120 ms），瓶颈是带宽上限**。而查看器此前直接请求 `/media/source/...`（`src/myqy-web-share/client/Viewer.tsx`），拿到的是**原始文件**——ComfyUI 出图未压缩，12 MB 起步，因此在慢速隧道上体验极差。顺带发现 `web-share-server.ts` 对每个响应强制 `Connection: close`，网格数十张缩略图各自重建连接，在高延迟隧道上额外放大等待。

## 方案（A + B）

- **A：查看器改看有界派生图。** 新增 `/media/view/<lib>/<assetId>?revision=...`，由 Worker 用 Sharp 从**原图**重新编码：最大边 2560 px、质量 82 的 WebP 作为查看器首屏；下载菜单可另选 JPG / WebP / PNG，**每种格式都从原图独立编码**，绝不由 WebP 二次转码（否则叠加两次有损压缩，观感反而更差）。原图仍可下载。
- **B：keep-alive。** 去掉强制 `Connection: close`，改由 Node 默认的 HTTP 超时约束空闲连接。

## 实现

### 1. Worker 编码器（新文件，避开 `library-service.ts`）

`src/worker/web-share-derivative.ts` 的 `createShareDerivative`：

- 通过既有的 `libraryService.getCurrentMediaSource()` 解析源文件绝对路径，并**校验 revision 仍为当前 revision**（陈旧分享链接不能编码已被替换的版本）。
- 输出写到 `mkdtempSync(path.join(tmpdir(), 'serpent-share-derivative-'))` 的**系统临时目录**，绝不写 `.serpent/artifacts`。这一点是刻意的：`.serpent/artifacts` 下没有 `revision_artifacts` 记录的文件会在 5 分钟后被 orphan 清理（`ORPHAN_ARTIFACT_GRACE_MS`），因此不能当缓存；不假称是缓存，也就无需改动库 schema 与其清理不变量。
- 返回 `cleanup`，由 Main 在响应结束（含中途断开）后调用；编码失败路径同样先清理再抛 `INTERNAL_ERROR`。

`src/worker/index.ts` 新增 `media.get-share-derivative` 分支，复用 `library-service.ts` 中原有 `requireSharp()`（现已导出）。

### 2. 协议（追加式，不改动既有命令）

`src/shared/protocol/requests.ts` / `responses.ts` 各追加一个变体；新增 `src/shared/web-share.ts` 的 `WEB_SHARE_DERIVATIVE_MAX_EDGE = 2560`、`WEB_SHARE_DERIVATIVE_QUALITY = 82`、`webShareDerivativeFormatSchema`，供服务端、客户端与单测共用同一组常量。

### 3. HTTP 层

`web-share-server.ts` 新增 `/media/view` 分支与 `#streamDerivative`：

- 格式白名单校验，未知格式返回 400（不静默回退到 WebP）。
- `Content-Disposition` 仅在 `download=1` 时下发，且同样受「允许下载原图」开关约束；被拒绝时**也**清理临时文件。
- 派生文件不做 byte-range：整份文件本身是一次性的。
- `cleanup` 绑定到 `response.on('close')`，该事件在正常完成与中途放弃两种情况下都会触发。
- 缓存头为 `private, no-store`：字节下次请求已不存在，不可缓存。

`web-share-media.ts` 的 `WorkerBackedWebShareMedia.resolveDerivative` 负责调用新命令并组装 `cleanup`（`rmSync` 文件与其所在临时目录）。

### 4. 客户端

- `api.ts` 新增 `viewUrl()`；`Viewer.tsx` 对 `mediaType === 'image'` 使用派生图，视频/音频暂仍走源文件（视频转码是独立工程）。
- 下载入口由单按钮改为 `DownloadMenu`：原图 / JPG / WebP / PNG，均为 `<a download>`；点击外部或 `Escape` 关闭。

## 验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 0 error（5 个既有 warning） |
| `npm run test:library-availability` | 9 文件 / 228 通过 / 1 跳过 |
| `npm run web:build` | 通过 |
| `tests/worker/web-share-derivative.test.ts` | 3 通过（真实 Sharp 编码；含"失败不留临时目录"） |
| `tests/unit/web-share-server.test.ts` | 22 通过（新增 4 项：服务并清理、缺 revision、未知格式、下载开关+清理） |
| `tests/unit/web-share-viewer.test.tsx` | 5 通过（新增派生图 src、下载菜单项） |
| `tests/unit/web-share-contract.test.ts` | 5 通过（新增格式枚举与尺寸上界） |
| `npm run test:unit` | 3875 通过 / 6 失败，全部为**既有失败**（`theme-css-tokens`、`desktop-ingestion`、`audio-extracted-metadata-fixture`、`plugin-install-failure-detail`×2、`plugin-standard-host`）。已用 `git stash` 对照确认与本次改动无关。 |

**未执行**：真实 Electron 运行、隧道实速前后对比、packaged、Windows。因此 WEB-SHARE-002 记为「待人类验收」，不得写「已验证」。

## 已知留白与取舍

- **JPEG 无 alpha**：透明图导出 JPG 会用白底合成；如需保留透明应选 WebP/PNG。
- **PNG 无损**：`quality` 对 PNG 不构成体积上界，2560 px 的 PNG 仍可能数 MB，这是格式特性而非缺陷。
- **无磁盘缓存**：每次请求都重新编码。高并发下会重复占用 CPU；如需优化，应在 Worker 内做**内存** LRU（而非写库），本次未做。
- **视频/音频无派生**：仍走源文件。
- **桌面端排序不可见**：网页端合集排序沿用桌面默认（名称升序），桌面若自定义排序则两者不一致，需要额外管道才能完全对齐。

## 补充记录（2026-09-30）

开发测试页面 `/web-preview/` 的网格密度滑块上界由 **15 列调整为 10 列**（`GRID_COLUMNS_MAX = 10`，范围 5–10，默认 5）。旧行为：上界 15；新行为：上界 10。相应更新 `web-share-app.test.tsx` 的滑块上界断言与测试说明。该滑块仍只在开发测试页面生效，主线页面尚未应用；待验收后通过 `npm run web:build` 应用到主线。

## 补充记录（2026-10-01）：查看器大图分片并发加载

**动机**：单条隧道连接实测只有 ~100–130 KB/s（FRP 与 Cloudflare 节点相近），2MB 大图要 15–20 秒；并发数增加时聚合吞吐明显上升（8 并发约 5 倍）。瓶颈是单连接吞吐，不是节点上限。

**旧行为**：查看器 `GET /media/view?...` 单请求、单连接拉取整张有界 WebP；Worker 每次请求现场重编码到系统临时目录，Main 传完即删；打开查看器时网格仍在后台继续加载缩略图，与大图抢带宽。

**新行为**：
- 服务端：查看器 WebP（非下载）**持久化缓存**于 `<library>/.serpent/share-derivatives/`（文件名 `assetId.revisionId.edge.quality.webp`），命中即复用不重编码；写入用临时文件 + 原子 rename；有界 LRU（上限 1 GiB，超限按最旧 mtime 淘汰）；新命令 `web-share.prune-derivatives` 在缩略图巡检后清理失效条目。`/media/view`（非下载）支持固定 **4 段字节范围**：`?chunk=0..3` → `206` + `Content-Range`，越界 `416`，`HEAD` 返回切片头；下载仍走单请求全分辨率 JPEG。
- 客户端：新模块 `viewer-image.ts` 并发拉取 4 个分片 → 按序拼装 `Blob` → 显示；分片失败重试 2 次，整体失败或服务端返回整文件时回退单请求；内存 LRU（默认 12 张）复用 `objectURL`，淘汰时 revoke。查看器打开期间 `Thumb` 渲染占位符、暂停网格缩略图，缩略图标记 `fetchPriority=low`、大图 `fetchPriority=high`。大图加载时显示「加载中…」。
- 顺带：大图查看器标题栏收窄（垂直内边距 `--ui-space-2`→`--ui-space-1`，栏内按钮 `control-md`→`control-sm`）。

**验证**：
- `npm run typecheck`、`npm run lint` 通过。
- 单测：`web-share-server`（含 4 片 206/416/HEAD/下载忽略 chunk 共 34 项）、`web-share-viewer-image`（分片拼装/重试/整文件回退/LRU）、`web-share-viewer`、`web-share-app`、`web-share-derivative-cache`、`web-share-derivative` 全绿。
- `npm run test:library-availability`（改动 `library-service` 强制）：9 文件 / 228 通过 / 1 跳过。
- 本机 HTTP 实测（共享库内一张 1040×1560 / 源 2.15MB 的 PNG）：整图 WebP `200 image/webp` 160,022 B；`chunk=0..3` 均 `206`，`Content-Range` 连续、四片合计 160,022 B，拼接 SHA256 与整图**完全一致**；`chunk=9` 返回 `416`。本次请求未产生新的系统临时目录（缓存路径生效）。
- **未执行**：真实浏览器/隧道实速前后对比、packaged、Windows。记为待人类验收（`WEB-SHARE-CHUNK-001`）。

## 补充记录（2026-10-01 第二轮）：回退分片、加 Early Hints 与强缓存

用户验收后决定**回退客户端 4 片并发**，因为主线走 Cloudflare 隧道后单请求足够，分片增加复杂度且收益有限；同时追加三项小优化。

**回退（保留优化项）**：
- 客户端查看器恢复为**单请求** `<img src={viewUrl}>`（保留 `fetchPriority="high"` / `decoding="async"`）；删除 `viewer-image.ts` 及其单测、`.viewer-loading` 样式。
- 服务端删除 `?chunk=` 分支、`#streamViewerChunk`、`WEB_SHARE_VIEWER_CHUNK_COUNT` 及相关单测。
- **保留**：缩略图让路（`paused`）、缩略图 `low`/大图 `high` 优先级、查看器标题栏收窄；**服务端大图派生持久缓存**（`.serpent/share-derivatives/` + `prune-derivatives`）——省去每次重编码 CPU。

**新增**：
- 静态内容寻址资源（非 `index.html`）缓存头改为 `public, max-age=31536000, immutable`，配合 Cloudflare 边缘缓存；`index.html` 仍 `no-cache`。
- 入口文档响应新增 **Early Hints** `Link: <...>; rel=preload; as=script|style`：从 HTML 内实际引用的 hash 资源生成，嵌套构建（`/web-preview/`）预加载**自己**的 bundle。配合 Cloudflare 面板 Speed → Content Optimization → Early Hints 生效。
- 缩略图 `decoding="async"` 确认保留。

**验证**：
- `npm run typecheck`、lint 通过；`web-share-server`（含新的 immutable + Early Hints 断言）、`web-share-viewer`、`web-share-app` 全绿。
- 本机 HTTP 实测：`/web-preview/` 返回 4 个 4 片请求已不复存在，只看单次 `/media/view`；`assets/*` 返回 `immutable`；入口 HTML 带 `Link: rel=preload`。
- **未执行**：真实浏览器/Cloudflare 边缘缓存命中、packaged、Windows。

## 补充记录（2026-10-01 第三轮，批次 1）：查看器大图 LOD（82→100）

**新行为**：查看器大图分两档 LOD——默认加载 **webp82**（2560 上限）；访客**放大**（scale>1）后，后台预加载 **webp100**，**解码完成后**才切换显示（双层叠放 + 短淡入，不闪白）；100 未就绪期间继续显示 82；**缩回 1 保留 100 直到关闭查看器**。切换只改 `<img src>`、**不重挂载不重置**，因此缩放比例与拖动位置保持不变。

**实现**：
- `src/shared/web-share.ts`：新增 `WEB_SHARE_DERIVATIVE_QUALITY_HIGH = 100`。
- `web-share-server.ts` `/media/view`：`?quality=100` → 100 档（下载忽略该参数）。缓存 key 含 quality，两档各自持久缓存。
- `api.ts`：`viewUrl(..., { tier: 'low' | 'high' })`。
- `Viewer.tsx` `ZoomImage`：新增 `srcHigh`；`scale>1` 时 `new Image().decode()` 预加载 100，`pendingSrc` 层 `onLoad` 后成为显示层；缩放/位置 state 不动。
- `styles.css`：`.zoom-layer-pending` 叠放 + 140ms 淡入（尊重 `prefers-reduced-motion`）。

**验证**：typecheck/lint 通过；`web-share-viewer`（含低档初始、放大预加载高档、换档后 transform 不变）与 `web-share-server`（`quality=100` 分档）单测全绿；本机 HTTP 实测同一张图 默认档 **160,022 B**、`quality=100` 档 **511,396 B**。
- **未执行**：真实浏览器放大观感、packaged、Windows。

## 补充记录（2026-10-01 第三轮，批次 2）：设置页两档体积统计 + 生成/删除

**新行为**：设置 → 网页分享 新增「大图缓存（WebP 两档）」卡片，显示 **WebP82 / WebP100 各自总大小(MB) 与文件数**，每档带「生成此档 / 删除此档」按钮（生成/删除对象 = 当前分享库；粒度 = 整档）。生成走 Main 分批 sweep，设置页显示进度、完成后按钮回填体积。

**实现**：
- `shared/web-share.ts`：新增 `WEB_SHARE_DERIVATIVE_TIERS=[82,100]`、tier/stats/progress schema；设置请求加 `generate-derivatives`/`delete-derivatives`（带品质）；快照加 `derivativeStats`/`derivativeProgress`。
- `web-share-derivative-cache.ts`：`shareDerivativeStats`（按文件名品质分档求和）、`deleteShareDerivativesByQuality`。
- `library-service.ts`：`shareDerivativeStats`、`deleteShareDerivatives`、`currentRevisionIdFor`。
- `worker/index.ts`：`web-share.derivative-stats` / `generate-derivatives`（复用 `createShareDerivative` destination + LRU）/ `delete-derivatives`。
- `main/index.ts`：`runWebShareDerivativeSweep` / `deleteWebShareDerivatives` / `refreshWebShareDerivativeStats`，settings 分发，`get` 时回填 stats。
- `WebShareSettingsPage.tsx` + 中英文案。

**验证**：typecheck/lint 通过；`web-share-derivative-cache`（分档统计、按档删除）、`web-share-contract`（tier schema 与两个设置动作）、`web-share-server` 单测全绿；`npm run test:library-availability` 9 文件 / 228 通过 / 1 跳过；本机磁盘实测 `.serpent/share-derivatives/` 分档计数正确（82 档 105 文件、100 档 1 文件）。
- **未执行**：设置页 UI 观感、真实生成/删除按钮点击、packaged、Windows。

## 补充记录（2026-10-01 第三轮，批次 3）：访客端后台预取（IndexedDB，持久、暂停式）

**新行为**：访客进入主页面后，浏览器后台把当前分享库**全部图片资产**的两档 LOD（先整个库 webp82，再整个库 webp100）下载进 **IndexedDB 持久缓存**；打开大图（及放大切 100）时**优先命中缓存**，秒显。**用户打开大图即暂停预取、关闭后断点续传**；缩略图仍由现有 visible-window 机制保持最高优先级，预取次之（`fetchPriority: low`）。两档缓存**总上限 1GB**，超出按 LRU 淘汰；`revision` 变化即失效。

**实现**：
- `prefetch-cache.ts`：IndexedDB 存储 `{libraryId,assetId,revisionId,tier,blob,bytes,savedAt}`；`get/has/put`，`put` 后按 `savedAt` 做 LRU 淘汰至 1GB 以内；IndexedDB 不可用时优雅降级为空操作。
- `prefetch-queue.ts`：`start/setAssets/pause/resume/stop`；顺序 low→high、跳过已缓存与非图片；暂停时保留进度、恢复从断点继续。
- `Viewer.tsx`：挂载即 `prefetchQueue.pause()`、卸载 `resume()`；按 asset+revision 从缓存取低/高档 blob → `objectURL`，优先于网络 URL；切换资产时 revoke 旧 URL。
- `App.tsx`：phase=ready 后分页枚举当前分享库全部图片资产交给队列。

**验证**：typecheck/lint 通过；`web-share-prefetch-queue`（low 先于 high、跳过已缓存/非图片、暂停不下载-恢复后继续）与 `web-share-prefetch-cache`（无 IndexedDB 时降级；有则读写/总量/LRU）单测全绿；预览与主线构建产物含 IndexedDB 缓存与暂停逻辑；`/` 与 `/web-preview/` 引用同一 bundle。
- **未执行**：真实浏览器预取/暂停/命中观感、Cloudflare 隧道实测、packaged、Windows。

## 补充记录（2026-10-01 第三轮，追加）：新导入图片自动生成两档大图

**旧行为**：新导入到分享库的图片只自动生成**缩略图**；webp82/100 大图需访客点开或手动点设置页按钮才生成。

**新行为**：`src/main/index.ts` 在 `asset.thumbnail.ready`（当前分享库）时，除缩略图外再排入一个派生生成队列（去抖 500ms、批量 500），对每个新资产**先跑 webp82 再跑 webp100**（复用 `web-share.generate-derivatives`），完成后刷新设置页体积统计。已在磁盘的档跳过，重复导入廉价。

**验证**：typecheck/lint 通过；构建后的 Main（`.vite/build/main.js`）含新钩子（`scheduleWebShareDerivativeGeneration` / `derivative-autogen`）；所调用的命令本身已在批次 2 覆盖。
- **未执行**：真实导入流程触发自动生成、设置页体积随之增长的实测（待人工验收）。

## 补充记录（2026-10-01 第三轮，批次 4）：控制台报错修复 + 预取进度条

**背景**：用户反馈控制台报错，并说"自动下载好像并没有什么作用"。

**诊断（"没作用"的根因）**：headless Chromium（Playwright）对运行中的分享服务（118 张图的库）实测，一次干净会话产生 **236 次 `/media/view` 请求**、IndexedDB 236 条记录（约 67 MB）—— **预取本身正常工作，缺的是可见反馈**。首张图派生编码冷启动较慢，15s 内可能尚未写入第一条记录，20s 后两档全部完成。

**旧行为 → 新行为**：
- 入口 HTML 有一段设置 `<html lang>` 的**内联脚本**，违反 `script-src 'self'`（控制台报错）；改为在 `main.tsx` 用 `PREFERS_CHINESE` 设置，入口文档不再含内联脚本，CSP 无需 hash。计划草案里写的 sha256 与真实构建产物不匹配，故弃用 hash 方案。
- Cloudflare 边缘注入的 `beacon.min.js` 被 CSP 拦；改为在 `script-src` 放行 `https://static.cloudflareinsights.com`、`connect-src` 放行 `https://cloudflareinsights.com https://static.cloudflareinsights.com`。
- Early Hints 的 `Link: rel=preload` 未带 `crossorigin`，与 HTML 中带 `crossorigin` 的 module script/style 凭据模式不符而被浏览器丢弃；现追加 `; crossorigin`。
- 缺失文件（`/favicon.ico`、缺失 `assets/*`）此前被 SPA 回退成**根 `index.html`**，其 Early Hints 又预加载永不被使用的根 bundle（"preloaded but not used" 告警来源）；`resolveStaticFile` 现对带扩展名的路径返回 404，并用 `<link rel="icon" href="data:,">` 抑制 favicon 请求。
- 预取全程无任何界面提示；**新增进度条**：`PrefetchIndicator.tsx` 订阅队列，在顶部工具栏最右显示「自动缓存 82 完成/总数 · 100 完成/总数」两条细进度条，空闲/完成隐藏；`PrefetchProgress` 增加 `images`，`stop()` 复位、`finally` 防旧运行覆盖新进度。

**验证**：
- `npm run typecheck`、改动文件 `npx eslint` 通过。
- 定向单测 6 文件 58 测试全绿；全量 `vitest run tests/unit` 4174 通过 / 5 跳过 / 4 失败（4 个均为 Windows `symlinkSync EPERM`：plugin-install-failure-detail、artifact-response、desktop-ingestion，与本次改动无关）。
- headless Chromium 对重启后的服务实测 `/web-preview/`：控制台 **0 条消息**；进度条采样 `82 18/118 100 0/118` → `82 118/118 100 112/118`；236 次 `/media/view`、IndexedDB 236 条 / 67,356,046 B。
- **未执行**：真实 Cloudflare 隧道下 Insights 表现、packaged、Windows。
- 注：本轮改的是分享服务（Main），需重启 Electron 生效；测试页 `/web-preview/` 已重建，主线 `/` 待用户验收后再 `npm run web:build`。

## 补充记录（2026-10-01 第三轮，批次 4 追加）：预取竞态修复 + 进度条完成态驻留

**背景**：用户在隧道页 `/web-preview/` 仍看不到进度条，Network 里却有 `/media/view` 请求。

**诊断**：无头 Chromium 对隧道实测，多数会话进度条正常出现并推进（控制台 0 消息），但暴露一个真实竞态：`PrefetchQueue.start()` 在已有运行中时因 `if (!this.#running)` 被**静默丢弃**——页面 effect 若重跑（例如启动时一次瞬态 401 导致 phase 抖动，用户控制台确有 `api/state 401`），cleanup 的 `stop()` 会中止当前 run 并复位进度，紧接着的 `start()` 却因旧 run 尚未收尾（`#running` 仍为 true）而不启动，预取从此“假死”，进度条也不再出现。这也解释了「Network 有历史请求、界面无进度」。

**修复**：
- `prefetch-queue.ts` 新增 `#ensureRunning()` 与 `#restart`：运行中的 `start()`/`resume()` 记下重启动请求，旧 run 察觉 generation 被超越后立即以最新资产重新起跑；`stop()` 清除重启动标记。
- `PrefetchIndicator.tsx`：完成态**驻留约 6 秒**再隐藏（`DONE_LINGER_MS`），避免在快网/热缓存下“一闪而过”被用户错过；空闲或驻留结束后隐藏。

**验证**：typecheck/lint 通过；`web-share-prefetch-queue`（新增“运行中 start 会重启并抓取新资产”用例）、`web-share-prefetch-indicator`（新增驻留 6 秒后隐藏用例）共 10 测试全绿；本地 `/web-preview/` 无头实测：进度条出现并推进到 `82 118/118 100 118/118` 时仍驻留、随后隐藏，`/media/view` 236 次全 200、IndexedDB 236 条、控制台 0 消息。
- **未执行**：真实用户浏览器硬刷新后的观感（待用户验收）、packaged、Windows。
- 注：本次仅改客户端（Vite 构建），无需重启 Electron，只需重建测试页。

## 补充记录（2026-10-01 第三轮，批次 4 追加二）：预取准确计数 + 并发加速

**背景**：用户反馈“进度显示完成了，但自动下载到本机后并无帮助，等很久打开图仍慢”。

**诊断**（无头 Chromium + 隧道实测）：
- 缓存链路本身正常：完整隧道跑完 236 次 `/media/view`（全 200）、IndexedDB 235 条；随后打开查看器**不再产生任何网络请求**（命中缓存，解码约 0.9s）。竞品级确认“打开大图命中缓存”成立。
- 真正的体感问题是**预取太慢**：严格顺序下载，隧道 RTT 高，完整 236 张需数分钟；期间一直占用隧道，用户还没等到就已在浏览，自然“感觉没效果”。
- 另发现**计数不诚实**：`#download` 失败（非 2xx / 网络异常 / IndexedDB 写入失败）也被计为 `completed`，于是进度条能显示 100% 而实际没有缓存任何东西。

**修复**：
- `prefetch-cache.ts`：`put()` 返回 `boolean`，只有真正写入成功才算成功。
- `prefetch-queue.ts`：新增 `failed` 计数，仅成功的写入/缓存命中计入 `completed`；`#download` 失败自动重试一次（300ms）；同一档内用 **3 个并发 worker** 下载（`concurrency` 选项，测试默认仍为 1 保证顺序可断言）。
- `PrefetchIndicator.tsx`：完成判定改为 `completed + failed >= total`；有失败时显示「失败 N」，且不再谎报完成。

**验证**：typecheck/lint 通过；队列（新增并发用例）、缓存、指标共 14 测试全绿。隧道无头实测：并发 3 下 42s 内发出约 **170** 次 `/media/view`（此前顺序约 **79**，约 2 倍）；本地完整跑完 236 条、控制台 0 消息。
- **未执行**：真实用户浏览器的体感速度（待用户验收）、packaged、Windows。
- 说明：无痕模式下 IndexedDB 会在关闭无痕窗口时清空，因此每次新的无痕会话都会重新预取。

## 补充记录（2026-10-01 第三轮，批次 4 追加三）：预取在真实浏览器中全部失败（fetch `Illegal invocation`）——根因

**背景**：用户复测截图显示进度条为「82 0/118 · 100 0/118 · 失败 42」——每次下载都失败、什么都没缓存。这正是“自动下载到本机后毫无帮助、等多久都慢”的**根因**。

**根因**：`PrefetchQueue` 在构造时把 `fetch`（或注入实现）**以裸函数存到实例字段**，下载时又以 `this.#fetchImpl(url, …)` 调用，于是浏览器把 `fetch` 的 `this` 绑定成队列实例，随即抛 `TypeError: Illegal invocation`——**在任何网络请求发生之前**就失败。`#download` 把异常静默吞掉，旧代码又把失败计为完成，所以进度条能显示 100% 而 IndexedDB 里一条都没有。真正的大图加载因此始终走网络，慢且与预取无关。

> 为什么此前的验证没发现：本项目所有无头探针（Playwright）都会先 `addInitScript` 给 `window.fetch` 打补丁并 `.bind(window)`，恰好掩盖了这个 `this` 绑定问题；一旦用**不打补丁**的真实流程（登录后自动预取）复现，立即得到 145 次失败 / 0 条记录。

**修复**：构造函数改成 `this.#fetchImpl = (options.fetchImpl ?? globalThis.fetch).bind(globalThis)`，调用时 `this` 恒为全局对象。

**验证**：
- 新增单测：注入一个“`this` 非全局就抛 `Illegal invocation`”的 fetch，回归保护绑定。
- **不打补丁**的真实流程探针（UI 登录）：修复前 4/4 失败（145 失败、0 条、0 请求）；修复后本地 236 请求全 200、236 条记录；隧道 130 请求全 200、记录持续写入。
- typecheck/lint、队列/缓存/指标 15 测试全绿。
- **未执行**：用户真实浏览器硬刷新后的体感（待用户验收）、packaged、Windows。

## 补充记录（2026-10-01 第三轮，批次 4 追加四）：预取实时速度显示

**新行为**：用户要求顶部「自动缓存」进度条前显示实时下载速度（3 路并发合计）。

**实现**：
- `prefetch-queue.ts`：`#download` 成功写入时累加 `#totalBytes`；新增 `#startSpeedSampling()`，每秒采样 `(Δbytes × 1000 / Δms)` 并以 0.5 EMA 平滑，写入 `PrefetchProgress.speed`（字节/秒）；运行开始启动，`finally`/`stop()` 清除。
- `PrefetchIndicator.tsx`：`active && speed > 0` 时显示 `formatBytes(speed)/s`。
- `styles.css`：`.prefetch-speed`（主题 token）。

**验证**：typecheck/lint、队列/缓存/指标 17 测试全绿（新增速度上报与显示用例）；隧道不打补丁探针实测读数 `55 KB/s → 1007 KB/s`；本地因回环过快（<1s 完成）不显示采样属预期。
- **未执行**：用户浏览器的观感（待用户验收）、packaged、Windows。

## 补充记录（2026-10-01 第三轮，批次 4 追加五）：查看器残留 blob 导致破图 + 关闭查看器重载缩略图

**背景**：用户反馈「很多图片显示不出来（破图）」，并发现「关闭大图模式后网格缩略图会重新加载」。

**根因一（破图）**：`Viewer` 用 `cachedLow/cachedHigh` 状态保存上一张图的 `blob:` 对象 URL；切换到下一张时，新一张的 `ZoomImage`（`key=assetId` 会重挂载）在**第一帧**仍从旧状态取到**上一张的 blob URL** 作为初始 `src`，紧接着 effect cleanup 又把该 URL `revoke`；而 `ZoomImage` 的 `displaySrc` 是 `useState(src)` 初值、**从不跟随 `src` 变化**，于是永远停在已 revoke 的 URL → 破图。快速翻图时尤为明显。

**根因二（关闭重载）**：`Thumb` 在 `paused`（查看器打开）时返回占位 `<span>` 而不渲染 `<img>`，关闭时 `<img>` 重新挂载 → 每个可见缩略图重新请求/解码，肉眼可见闪一下。

**修复**：
- `Viewer.tsx`：缓存 URL 改为按 `libraryId+assetId+revisionId` 记录的 `{key, low, high}`，渲染时**仅当 key 与当前资产一致才使用**，杜绝复用上一张的 blob；对象 URL 在资产变化时 revoke。
- `Viewer.tsx` `ZoomImage`：用 React 推荐的渲染期状态调整跟随 `src` 变化，且**不把已显示的高档降回低档**。
- `App.tsx`：`Thumb` 去掉 `paused` 占位分支，查看器打开期间缩略图**保持挂载**（不卸载、不重载）。

**验证**：单测新增「导航后不得复用上一张缓存 blob」「查看器打开时缩略图仍挂载」两用例；typecheck/lint、viewer/app/队列/指标 30 测试全绿。真实浏览器（不打补丁）实测：连续翻 10 张全部命中缓存（`blob:`）且 `naturalWidth>0`，**0 破图**；关闭查看器后 `/media/thumbnail` **0 次新请求**。
- **未执行**：用户浏览器观感（待用户验收）、packaged、Windows。

## 补充记录（2026-10-01 第三轮，批次 4 追加六）：缩略图优先于预取 + 缩略图持久缓存

**背景**：用户要求「缩略图加载高于自动下载」，且缩略图也要像大图一样在用户电脑上**长期缓存**（关机/重启/开关浏览器都不消失）。

**实现**：
- **优先级**：`Thumb` 的 `<img fetchPriority="high">`（预取仍是 `low`），网格缩略图优先于后台预取。
- **持久缓存**：把 `prefetch-cache.ts` 泛化为共享 IndexedDB（`serpent-web-share`，DB 版本升到 2），新增 `thumbnails` store 与 `ThumbnailCache`（`get/put/remember`，256MB LRU）。`Thumb` 先查缓存：命中用 `blob:` 直接显示、**不发网络请求**；未命中才渲染 `<img>`，加载后 `remember(url)` 落库。
- **缓存失效**：缩略图 URL 追加 `?v=<revision>-<thumbnailVersion>`；服务端 `/api/state` 新增 `thumbnailVersion`（由 edge/sharpen/maxKb/format 组成），缩略图响应改为 `Cache-Control: public, max-age=31536000, immutable`。资源版本或缩略图设置变化 → URL 变化 → 自动失效。

**验证**：typecheck/lint、web-share 9 文件 87 测试全绿（新增缩略图缓存读写/URL 失效、缩略图 `fetchpriority=high`、`thumbnailVersion` 随设置变化等用例）。`launchPersistentContext` 模拟浏览器重启实测：首次 110 次 `/media/thumbnail`、缓存 55 条；**重启后 0 次缩略图请求**、55 条缓存持久存在。
- 说明：无痕窗口关闭会清空 IndexedDB（与大图缓存一致），普通窗口跨重启保留。DevTools 勾选「停用缓存」不影响 IndexedDB（这正是选 IDB 而非纯 HTTP 缓存的原因）。
- **未执行**：用户浏览器观感（待用户验收）、packaged、Windows。
