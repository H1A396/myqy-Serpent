# 环境搭建

## 要求

- Node.js **24.15.0**（`.nvmrc` 锁定，用 `nvm use` 切换）
- npm（国内网络建议 `--registry=https://registry.npmjs.org`）
- 原生开发目标：macOS arm64、Windows x64、Linux x64
- **不要在 SMB/NAS 挂载目录上构建或运行**——Electron 在挂载盘上无法正常启动（`icudtl.dat not found`），打包产物也不能从挂载盘运行

### macOS

- Xcode Command Line Tools（原生模块编译需要）
- 媒体组件构建（仅需要重建时）：`scripts/media-build/darwin-arm64.sh`（vcpkg，耗时数小时）

### Windows

- Git、PowerShell
- Visual Studio Build Tools：勾选“使用 C++ 的桌面开发”（Desktop development with C++）工作负载及 Windows SDK（原生模块 `better-sqlite3` 编译必需）
- **Inno Setup 6**（构建 Windows 安装包 `SerpentSetup.exe` 时必需）：
  - 推荐方式（免管理员）：通过 NuGet 获取 `Tools.InnoSetup`，解压提取 `ISCC.exe` 放置于 `%LOCALAPPDATA%\SerpentTools\inno\tools\` 目录；
  - 官网安装方式：安装官方 Inno Setup 6 并将环境变量 `SERPENT_INNO_TOOLS` 指向 `ISCC.exe` 所在目录（或加入系统 `PATH`）；
  - 若仅在开发态运行（`npm start`）或生成便携版（`npm run package`），则无需安装 Inno Setup。
- 媒体组件构建（仅需要重建底层二进制时）：`scripts/media-build/win32-x64.ps1`（vcpkg）

### Linux

- 编译工具链与 Python（`better-sqlite3`）：Debian/Ubuntu 可用 `sudo apt install build-essential python3`
- **媒体工具**：linux-x64 的 pinned bundle 已在 `bundle-lock.json` 中就绪。linux-arm64 走同一获取/校验路径，但锁条目仍是 `build-required`（还没有晋升的 zip）。`npm ci` 不会安装媒体包；未运行 `media:ensure` 或 `release:media` 时，`npm start` 仍使用 PATH 上的 `ffmpeg` / `ffprobe`，可选 `openimageio-tools`（`oiiotool`）处理 EXR/RAW/PSD。发布用 AppImage 会打入该 bundle。
- AppImage 发布构建建议安装 Docker（`npm run make:appimage:docker` 使用 Ubuntu 22.04 / glibc 2.35 基线，容器架构跟随宿主机，x86_64 与 aarch64 相同）；无 Docker 时可本机 `npm run make:appimage`。FUSE、X11/Wayland 限制两条架构相同。
- 常用环境变量：`SERPENT_SOFTWARE_GL=1`（无 GPU 时软件 WebGL）、`SERPENT_LINUX_ROUNDED_CORNERS=0|1`（强制直角/圆角）、`SERPENT_FFMPEG_PATH` / `SERPENT_OIIO_PATH`（覆盖 PATH 查找）

## 首次构建

```bash
npm ci --registry=https://registry.npmjs.org
npm run rebuild:native
npm start
```

`rebuild:native` 把 `better-sqlite3` 编译为 Electron ABI 并实测 FTS5。Windows 上**不要**裸跑 `@electron/rebuild` 或 `node-gyp`——本机 vcpkg 的 MSBuild 集成可能链接到无 FTS5 的 sqlite3.dll；项目脚本已强制禁用。

## 媒体组件

`npm ci` **不安装** FFmpeg/ffprobe/OpenImageIO。缺组件时普通开发与图片导入不受影响；视频缩略图/代理生成会报 `FFMPEG_REQUIRED`，EXR/TGA/复杂 TIFF 需要 OpenImageIO。

打包产物使用受控媒体包（FFmpeg 8.1 LGPL-only + OpenImageIO 3.1.12.0），门禁校验产物哈希与来源（`bundle-lock.json` 的晋升状态 + `source-lock.json` 的版本匹配）。本地开发可用 `SERPENT_FFMPEG_PATH` 指向任意可信 FFmpeg（需含所需滤镜/编码器，且 `ffprobe` 同目录；GPL 构建仅限本地覆盖）：

```bash
# macOS
export SERPENT_FFMPEG_PATH="$HOME/tools/ffmpeg/ffmpeg"
npm start
```

```powershell
# Windows
$env:SERPENT_FFMPEG_PATH = 'C:\tools\ffmpeg\ffmpeg.exe'
npm start
```

```bash
# Linux（也可直接依赖 PATH 中的发行版 ffmpeg）
export SERPENT_FFMPEG_PATH=/usr/bin/ffmpeg
npm start
```

更换后需完全退出 Serpent 再启动（单实例锁，二次 `npm start` 不会替换已运行进程）。

## 常见开发命令

```bash
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # 单元 + Worker 集成（Electron 内运行）
npm run test:unit        # 仅单元
npm run test:worker      # 仅 Worker 集成
npm run test:e2e         # Playwright E2E
npm start                # 开发启动
npm run start:multi      # 双实例
```

## 开发注意事项

- 测试跑在 Electron ABI 下（`test:worker`/`test` 经 `run-vitest-with-electron.mjs`）；`npm run package` 后需 `npm run rebuild:native` 恢复 dev native 模块
- `npm start` 自动避开被占用的 Vite 端口
