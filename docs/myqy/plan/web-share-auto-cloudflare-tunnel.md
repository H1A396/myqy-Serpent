# 计划（交接）：网页分享自动云转发（Cloudflare 隧道）

> 状态：**已完成（批次 1–3 已本地提交；批次 4 验证与文档进行中）**
> 创建：2026-10-08
> 前置计划：[`web-share-prefetch-progress-and-csp.md`](./web-share-prefetch-progress-and-csp.md)（已完成）
> 规则：[`../web-share-preview.md`](../web-share-preview.md)、[`../git-rules.md`](../git-rules.md)

## 一、用户原始诉求

1. 在**网页分享设置页**开启「启用网页分享」时，**自动启用云转发**（本机已配置好的 Cloudflare 命名隧道），无需再手动开命令行。
2. 设置页里可以**设置 Cloudflare 里已经弄好的域名**（隧道 hostname），并显示固定公网地址。
3. 页面提供一个**安装按钮**：自动**检测 cloudflared 是否已安装**；没有安装时可**一键安装**。

## 二、已确认决策（问答）

- 隧道类型：**命名隧道**（读取本机已有 `~/.cloudflared/config.yml` 与凭据，公网地址固定）。
- 信息来源：**自动解析 config.yml + 允许在设置里手动覆盖**（隧道名/域名/cloudflared 路径）。
- 端口：**Serpent 生成托管配置**（ingress 端口始终指向当前分享端口），不改动用户原 config.yml。
- 失败行为：**保留本地分享并提示**；新增独立「云转发」开关（默认开）。
- cloudflared 缺失：设置页显示未安装，并提供**安装按钮**（Windows 用 `winget`，macOS 用 `brew`）。

## 三、设计

### 3.1 隧道控制器 `src/myqy-web-share/server/cloudflare-tunnel.ts`

- `CloudflareTunnelManager`（`spawn`/`stat`/`homedir`/`platform` 可注入，便于单测）：
  - **定位 cloudflared**：手动覆盖 → PATH → 常见安装目录（Windows `Program Files`/`Program Files (x86)`；macOS `/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`）。
  - **解析 `~/.cloudflared/config.yml`**：轻量解析顶层 `tunnel:`、`credentials-file:`、第一个 `ingress` 的 `hostname`（不引入 YAML 依赖）。
  - **托管配置**：写到 `<userData>/cloudflared/serpent-tunnel.yml`，含正确 ingress 端口；用 `cloudflared tunnel --config <托管> --no-autoupdate run <名称或ID>` 启动。
  - **状态机**：`off | starting | running(publicUrl) | error(reason)`；就绪判定日志 `Registered tunnel connection`；stderr 环形缓冲约 40 行；异常退出转 error。
  - **停止**：只杀自己启动的进程（win32 `taskkill /pid <pid> /T /F`；其它 `SIGTERM`→force）。
  - 安装检测 / 安装：`detect()` 返回是否可用与版本；`install()` 走平台包管理器（可注入命令）。

### 3.2 共享契约 `src/shared/web-share.ts` + `web-share-settings-store.ts`

- 偏好新增：`autoTunnel`（默认 `true`）、`cloudflaredPath`/`tunnelName`/`tunnelHostname`（默认 `null`=自动）。
- 新增 `webShareTunnelStateSchema`；快照增加 `tunnel` 与 `tunnelInfo`（生效路径/域名/是否检测到配置）。
- 新增请求：`set-auto-tunnel`、`set-tunnel-config`、`restart-tunnel`、`detect-cloudflared`、`install-cloudflared`（可选 `pick-cloudflared-path`）。
- 持久化 schema 新键 `.optional()`，旧 `web-share-settings.json` 仍可读取。

### 3.3 服务集成 `web-share-server.ts`

- 可选注入 `tunnel`；`snapshot()` 带上隧道状态。
- `#startInternal()` 监听成功后 `tunnel.start(port)`（失败→隧道 error，分享仍 running）；`stop()`/`close()` 停隧道；`setPort()` 用新端口重启隧道。
- `setAutoTunnel()`/`setTunnelConfig()` 持久化并按需启动/停止/重启。

### 3.4 主进程 `src/main/index.ts:5216`

- 构造 `CloudflareTunnelManager` 注入 `WebShareServer`；新增对应 IPC；`pick-cloudflared-path` 用 `dialog.showOpenDialog`。

### 3.5 设置界面 `src/renderer/WebShareSettingsPage.tsx`

- 新增「云转发（Cloudflare 隧道）」卡片：`autoTunnel` 开关、状态点、公网地址 + 复制/打开、**域名输入**、隧道名、cloudflared 路径（选择文件/重新检测）、**安装按钮（未安装时）**、重新启动按钮。
- 更新 `webShareEnabledHint` 文案；新增 `settings.webShareTunnel*` 中英键。

## 四、批次

1. 共享 schema + 存储偏好 + 隧道控制器核心（含检测/安装）+ 单测。
2. `WebShareServer` 集成 + 主进程接线/IPC + 服务测试。
3. 渲染层设置卡 + 中英文案。
4. 真机端到端验证 + 文档/验收清单 + 提交。

## 五、验证

- typecheck / eslint / 定向 vitest。
- 真机：开启分享→cloudflared 启动、公网地址出现；关闭分享→进程消失；退出应用→进程消失；未安装路径显示安装按钮。
- timestamped 证据写入开发日志；packaged/Windows/macOS 除非实跑否则标注「未执行」。

## 六、隐私

跟踪文件不写真实域名/路径/凭据；解析与测试使用明显虚构的示例值。
