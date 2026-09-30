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
