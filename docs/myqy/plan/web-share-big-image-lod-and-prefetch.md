# 计划：网页分享大图 LOD + 预生成/统计 + 访客端后台预取

> 状态：**已完成**（批次 1、2、3 均已实现并本地提交）
> 创建：2026-10-01
> 适用：`docs/myqy/web-share-preview.md` 流程（一切试验在开发测试页 `/web-preview/`，验收后 `npm run web:build` 应用主线；测试页始终跟随主线当前版本）

## 进度

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| 1 | LOD（82→100） | 已完成（typecheck/lint/单测通过；本机实测 82=160KB、100=511KB） |
| 2 | 设置页两档体积 + 生成/删除 | 已完成（typecheck/lint、library-availability 228 通过、缓存单测通过；本机磁盘实测分档计数正确） |
| 3 | 访客端后台预取 | 已完成（typecheck/lint、预取缓存/队列单测通过；构建产物含 IndexedDB 缓存与暂停逻辑） |

> 批次 1–3 全部完成。**未执行**：真实浏览器预取/暂停/命中观感、Cloudflare 隧道实测、packaged、Windows —— 待人工验收。

## 背景与目标

访客看完整个库的大图时，逐个点开、逐个等加载，体验差。目标：

1. **LOD**：打开大图默认低档 **webp82**；用户**放大**后切高档 **webp100**；切换**不闪烁**、**不重置缩放与拖动位置**。
2. **服务端预生成 + 设置页统计**：设置页能看到 **webp82 / webp100 各自占多少 MB**，并能**按质量档生成/删除**（对象=当前分享库）。
3. **访客端后台预取**：访客一打开网页，浏览器**后台自动下载**当前分享库全部 webp82 与 webp100，持久缓存，打开大图时优先命中已下载的。

## 已确认的决策

| 项 | 决定 |
| --- | --- |
| 两档尺寸 | 都 **2560 上限**（只提清晰度，不提分辨率） |
| 默认档 | **webp82** |
| 升档触发 | 用户**放大**（scale>1）才加载 100；100 未到先用 82 |
| 缩回 | **保留 100 直到关闭查看器**（不缩回 82） |
| 切换表现 | **不闪烁**（双层叠放 + 短淡入）、**不重置缩放/位置** |
| 生成/删除对象 | **当前分享库** |
| 生成/删除粒度 | **按当前质量档整档**（82 按钮只动 82，100 按钮只动 100） |
| 访客端持久存储 | **IndexedDB**（http/https 都可用；比 Cache API 更可控） |
| 预取顺序 | **先全库 82 铺完 → 再全库 100** |
| 预取优先级 | **缩略图（现有机制，最高）> 82 预取 > 100 预取** |
| 预取调度 | **用户打开大图 → 暂停预取；关闭 → 断点续**（不做精确限速，用暂停式调度替代） |
| 缓存容量上限 | 访客端两档**合计 1 GB**，超出 LRU 淘汰 |
| 大图复用预取 | 查看器/LOD **优先命中 IndexedDB**，命中即秒显；未命中走网络（用户请求优先） |
| 分批发 | **分 3 批**：1=LOD，2=设置页统计/生成删除，3=访客端后台预取 |

## 批次 1 — LOD（82 → 100）

**服务端**
- `src/shared/web-share.ts`：新增 `WEB_SHARE_DERIVATIVE_QUALITY_HIGH = 100`。
- `src/myqy-web-share/server/web-share-server.ts`：`/media/view` 支持 `?quality=100`（非下载用该档，默认 82；下载逻辑不变）。缓存 key 已含 quality，两档各自持久缓存。

**客户端**
- `src/myqy-web-share/client/api.ts`：`viewUrl(..., { tier: 'low' | 'high' })` → `tier=high` 拼 `quality=100`。
- `src/myqy-web-share/client/Viewer.tsx`（`ZoomImage`）：
  - **双层 `<img>` 叠放**：下层显示当前图，上层显示目标图；顶层 `onLoad` 后再切换可见性（短淡入），旧图保留到新图就绪 → **不闪白**。
  - `scale > 1` 且当前为 82 时，用 `new Image()` + `decode()` **预加载 100**，成功后切换显示；100 未就绪时**继续显示 82**。
  - 缩回 1 **不切回**（保留 100 直到关闭查看器）。
  - **只改 src，不 remount `<img>`、不 reset** → 缩放/位置保留；两档同尺寸(2560)保证 transform 数学不变。
- `src/myqy-web-share/client/styles.css`：双层容器 + 淡入（主题 token、尊重 `prefers-reduced-motion`）。

**测试**
- 服务端：`?quality=100` → 100、无参数 → 82、下载忽略该参数、缓存键分离。
- 查看器：放大请求 100；未就绪仍显示 82；切换后 `transform` 的 scale/offset 不变；缩回 1 仍显示 100。

## 批次 2 — 设置页：两档体积 + 生成/删除

**协议 / 服务端**
- `src/shared/web-share.ts`：
  - 设置请求新增 `{ type:'generate-derivatives', quality: 82|100 }`、`{ type:'delete-derivatives', quality: 82|100 }`。
  - 快照新增 `derivativeStats`（两档 `{count,bytes}`）与 `derivativeProgress`（`{active,total,generated,skipped,failed,quality}`）。
- `src/worker/web-share-derivative-cache.ts`：`shareDerivativeStats(root)`（按文件名里的 quality 分档求和）、`deleteShareDerivativesByQuality(root, quality)`。
- `src/worker/library-service.ts`：`shareDerivativeStats(libraryId)`、`deleteShareDerivatives(libraryId, quality)`（操作 `.serpent/share-derivatives/`；`shareDerivativeCachePath` 已存在）。
- `src/worker/index.ts`：新增 case
  - `web-share.derivative-stats` → 两档统计；
  - `web-share.generate-derivatives` → 对 assetIds 批量生成指定 quality（复用 `createShareDerivative` 的 `destinationAbsolutePath` + `evictShareDerivatives`），返回 generated/skipped/failed；
  - `web-share.delete-derivatives` → `{ removed }`。
- `src/main/index.ts`：`runWebShareDerivativeSweep(server, quality)` + `deleteWebShareDerivatives(server, quality)`（镜像 `runWebShareThumbnailSweep`），设置请求分发，回填 stats 到快照。

**设置页 UI**
- `src/renderer/WebShareSettingsPage.tsx`：缩略图卡后新增卡片，两行显示 **webp82 / webp100 总大小(MB) + 文件数**，各带 **生成 / 删除** 按钮（删除二次确认）+ 进度文案（镜像缩略图 regenerate/delete 写法）。
- `src/renderer/i18n/catalogs/zh-CN.ts` + `en.ts`：新增文案键（区块标题、82/100 标签、大小、生成/删除、进度、确认）。

**测试 / 文档**
- stats 求和、按档删除、schema 校验。
- 开发日志追加；验收清单新增 `WEB-SHARE-DERIV-STATS-001`。

## 批次 3 — 访客端后台预取（持久、暂停式、优先级）

**新增客户端模块**
- `src/myqy-web-share/client/prefetch-cache.ts`：
  - **IndexedDB** 存 `{ libraryId, assetId, revisionId, quality, blob, bytes, savedAt }`；
  - **两档合计 1 GB 上限 + LRU 淘汰**；revision 变化即失效旧条目；
  - 命中查询：给定 URL/tier → 取 blob → `objectURL`。
- `src/myqy-web-share/client/prefetch-queue.ts`：
  - 登录进入主页面后启动；顺序 **全库 82 → 全库 100**；
  - **优先级低于缩略图**（缩略图仍走现有 visible-window 最高优先；预取低优先、少量并发）；
  - **暂停信号**：查看器打开 → `pause()`；关闭 → `resume()`（**断点续，不重来**）；
  - 幂等（已缓存跳过）、失败有限重试。

**联动**
- `src/myqy-web-share/client/Viewer.tsx` / LOD：打开大图**优先命中预取缓存**；打开期间给队列发 `pause`，关闭发 `resume`。
- 资产枚举：复用 `web-share.list-targets`（当前分享库图片资产）。
- `src/myqy-web-share/client/App.tsx`：登录进入后挂载预取（登录前不预取）。

**测试 / 文档**
- 缓存读写/LRU/失效、暂停-续传、查看器命中优先、优先级（缩略图先于预取）。
- 开发日志追加；验收清单新增 `WEB-SHARE-PREFETCH-001`。

## 全局验证（每批）
- `npm run typecheck` + 定向单测；触及 `library-service` 跑 `npm run test:library-availability`。
- `npm run web:build:preview` → 在 `/web-preview/` 实测 → 用户验收后 `npm run web:build` 应用主线（测试页跟随主线）。
- 批次 3 需真实浏览器实测：预取启动/暂停/续传、命中秒显、1 GB 上限淘汰。
- 触及核心体验门禁路径时按 `AGENTS.md` 执行。

## 尚未验证 / 风险
- 真实隧道（Cloudflare）下的预取对即时加载的影响，需实测。
- `?quality=100` 使缓存体积上升到全库约 62MB（两档合计约 80MB，本库 119 张实测：82≈17.9MB、100≈61.6MB）。
- IndexedDB 在访客浏览器可能被隐私模式/清理策略清空（持久性尽力而为）。

## 参考
- 实测数据与旧/新行为：`docs/internal/development/2026-09-23-web-share-derivative-development-log.md`
- 页面流程：`docs/myqy/web-share-preview.md`
- 相关常量：`src/shared/web-share.ts`（`WEB_SHARE_DERIVATIVE_QUALITY`、`WEB_SHARE_DERIVATIVE_MAX_EDGE`）
