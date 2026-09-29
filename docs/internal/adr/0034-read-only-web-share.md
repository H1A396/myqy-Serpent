# ADR-0034：只读网页分享由 Desktop 内嵌 loopback HTTP 服务提供

- 状态：已接受（2026-09-22）

Serpent 用户希望把资源库通过网页分享给朋友浏览（常见做法是用 frp 等隧道把本机端口映射到公网）。本决策：在 Desktop Main 内嵌一个**只读** HTTP 服务，只绑定 `127.0.0.1`，隧道客户端把该本地端口映射到公网；服务默认关闭，需先设置分享密码才能启用，应用退出即停止，不安装系统服务。

边界与不变量：

- 服务只能读：所有查询经 Library Worker 的查询命令（`library.list`、`folder.list`、`folder.browse-entries`、`asset.list`、`asset.search`、`asset.metadata.get`、`asset.extracted-metadata.get`、`tag.list`、`collection.list`、`media.get-source-path`、`media.get-thumbnail-artifact`、`media.get-artifact-paths`）。媒体字节复用 Main 的 Range 读取路径，绝不返回磁盘绝对路径。
- 只分享**一个**资源库（`sharedLibraryId`，默认第一个已打开的资源库）。
- 鉴权为单一分享密码（scrypt 派生）+ HMAC 签名会话 Cookie（`HttpOnly; SameSite=Lax`），登录限流；修改密码会轮换签名密钥，使旧会话立即失效。Host 头不做白名单，因为隧道会转发访客的公开 Host。
- Web 客户端是与 Electron Renderer 分离的独立轻量 SPA（`src/web`，产物 `dist/web`），不向浏览器暴露 `window.serpent`、IPC 或 `serpent://`。
- 不使用 loopback 之外的绑定；局域网与公网暴露一律交给用户自选的隧道，与 ADR-0029 的 MCP listener 边界一致。

不采用"把现有 Renderer 直接搬到浏览器"的方案：现有 Renderer 依赖 Electron 原生能力（对话框、拖拽、插件 iframe、离屏渲染、`serpent://`），全面降级成本与风险远高于独立只读客户端。
