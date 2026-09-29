# 只读网页分享浏览器端缺陷修复（缩略图 / 查看器 / 选择闪烁）

日期：2026-09-22

工单：`Serpent-0cc23f`、`Serpent-f4560e`、`Serpent-6a8c9a`

## 背景

用户在打包版开启「网页分享」后用浏览器实测，报告三个缺陷：

1. 部分卡片无缩略图；换浏览器（HTTP 缓存清空）后全部无缩略图。
2. 大图查看模式下图片上下被裁切，看不到完整图片。
3. 右侧详情栏已显示时，点击别的图片或再次点击当前图片，网格与侧栏整体闪烁。

此前 WEB-SHARE-001 只跑过单测与前端构建，真实 Electron、packaged 与浏览器联调均未执行，因此这些缺陷未被发现。

## 根因

### 1. 缩略图 404（相对路径被当作绝对路径）

Worker 命令 `media.get-thumbnail-artifact` 返回的 `filePath` 是数据库 `revision_artifacts.file_path`，即相对 `.serpent/artifacts` 的路径；只有 `getArtifactAbsolutePath(s)` 才会把它解析成绝对路径。`src/main/web-share-media.ts` 的 `resolveThumbnail` 却把该 `filePath` 直接作为 `absolutePath` 交给 HTTP 服务器，`stat()` / `createReadStream()` 按进程工作目录解析失败，返回 404。

关键放大效应：该分支被判定为"成功"，因此**不会**回退到按需生成。结果是已生成的缩略图永远 404；只有尚未生成的资产经 `media.get-artifact-paths`（绝对路径）正常显示。这正是"一部分能显示、缓存失效后全不显示"的来源。

### 2. 查看器图片被裁切

`src/web/styles.css` 的 `.zoom-stage` 是 flex item：宽度由 flex 布局确定为 definite，但高度仍是内容高度（indefinite）。`img` 的 `max-height: 100%` 相对不确定高度的包含块按 CSS 规则视为 `none`，图片以原始像素尺寸渲染，再被 `.viewer-body` 的 `overflow: hidden` 裁掉上下。

### 3. 切换选择闪烁

`src/web/App.tsx` 的 `selectAsset` 每次点击（含点当前图片）都先 `setDetail(null)`，`DetailPanel` 因此卸载；`.content` 网格第二列 `auto` 塌缩，`.grid-scroll` 变宽并整网格重排，请求返回后再次收窄。一次点击两次全网格重排。

## 修改

- `src/main/web-share-media.ts`：`resolveThumbnail` 不再使用 `media.thumbnail-artifact.filePath`。先取 `artifactId`（缺失时按需 `media.generate-thumbnail`），再统一经 `media.get-artifact-paths`（`usage: 'preview'`）解析绝对路径；`resolveArtifact` 复用同一路径解析私有方法。
- `src/web/styles.css`：`.zoom-stage` 改为 `width: 100%; height: 100%`，使 `img` 的 `max-height: 100%` 生效，图片按 `object-fit: contain` 完整适配。
- `src/web/App.tsx`：详情栏改为随 `selectedIndex` 始终挂载；`selectAsset` 点当前图片直接返回、不再重复请求；详情请求带 `requestId` 防止旧响应覆盖新选择。
- `src/web/DetailPanel.tsx`：改为 `summary: AssetSummary` + `detail: AssetDetail | null`，先用网格已有的 summary 渲染标题/尺寸/大小/时间/路径/评分，`detail` 到达后补齐标签/描述/拍摄信息，并按 `assetId` 校验，避免显示上一个资产的数据。

## 验证

```text
npx vitest run --config vitest.config.ts tests/unit/web-share-data.test.ts tests/unit/web-share-app.test.tsx
通过：2 个文件，11 passed（含缩略图相对路径回归、详情栏跨选择保持挂载、点当前图片不重复请求）。

npx vitest run --config vitest.config.ts tests/unit/web-share-server.test.ts
通过：1 个文件，18 passed。

npm run typecheck
通过（退出码 0）。

npm run lint
0 errors（5 个既有 warning，均不在本次改动文件）。

npm run web:build
通过，产物 dist/web。
```

未执行：真实 Electron / packaged / Windows 的浏览器联调与 Computer Use 视觉验收；查看器适配为纯 CSS 修复，需在真实浏览器中目视确认。WEB-SHARE-001 人类验收保持"不通过"，待用户复验。

## 追加：网格卡片对齐/居中与大图查看器交互（`Serpent-43cbe0`）

用户在打包版复验后继续提出 8 条，已全部实现：

- **网格卡片高度不齐 / 缩略图不居中**：根因是 `.card-thumb` 作为 flex item 的 `min-height: auto` 被图片固有高度撑开，压过 `aspect-ratio: 1`，卡片高度随图片比例变化。修复：`.card-thumb` 加 `min-height: 0` 与 `overflow: hidden`，正方形生效后所有卡片等高、文件名对齐，缩略图按 `object-fit: cover` 填满（用户选 cover）。
- **查看器标题栏**：改为 `1fr auto 1fr` 网格——左：关闭按钮 + 操作提示（滚轮缩放 · 左键拖动 · 双击缩放）；中：文件名，下一行居中显示页数；右：下载原图。标题栏加 `--ui-surface-overlay` 背景与底部分隔线，解决关闭/下载按钮叠在模糊背景上看不清的问题。
- **点击空白退出**：`.viewer-body` 增加背景点击处理，点图片以外的空白（左右/上下）退出查看器；点图片、按钮、视频/音频、拖动结束的点击不退出（`ZoomImage` 通过 `dragMovedRef` 上报是否发生平移）。
- 放大到没有空白区域时仍可用关闭按钮或 Esc 退出（`Esc` 已有）。

验证：

```text
npx vitest run --config vitest.config.ts tests/unit/web-share-data.test.ts tests/unit/web-share-app.test.tsx tests/unit/web-share-viewer.test.tsx tests/unit/web-share-server.test.ts
通过：4 个文件，32 passed（新增查看器空白点击关闭 / 点图片不关闭 / 标题栏名称与页数）。

npm run typecheck
通过（退出码 0）。

npm run lint
0 errors（5 个既有 warning，均不在本次改动文件）。

npm run web:build
通过，产物 dist/web（index-8KZZGTR0.css / index-DfBUqG_1.js）。
```

真实浏览器与 packaged 目视验收仍待用户复验。
