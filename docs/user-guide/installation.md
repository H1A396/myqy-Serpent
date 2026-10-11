# 安装

最新安装包见 [Serpent Releases](https://github.com/dolag233/Serpent/releases)。

## 系统要求

- macOS：Apple Silicon（arm64）或 Intel（x64），macOS 11 或更高版本
- Windows：64 位 Windows 10 或 Windows 11
- Linux：64 位 x86_64（发布资产为 AppImage；建议较新的发行版，glibc ≥ 2.35 可运行 Ubuntu 22.04 基线构建）
- 应用本身约需 500 MB；资源库数据另占空间

安装包与版本说明以 [Serpent Releases](https://github.com/dolag233/Serpent/releases) 为准。

## macOS

1. 下载对应架构的 `Serpent-darwin-arm64-<版本>-package.dmg`（或 Intel 架构对应安装包）。
2. 打开 DMG，将 Serpent 拖到「应用程序」。

当前开发版若未签名公证，首次打开时右键应用选择「打开」并确认。若系统仍阻止，可以在终端清除隔离属性：

```bash
xattr -cr /Applications/Serpent.app
```

卸载只需将应用移入废纸篓；资源库位于创建时选择的位置，不会因删除应用而删除。

## Windows

1. 从发布页下载 Windows 安装包 `Serpent-win-x86-64-<版本>-setup.zip`（解压运行内含的安装向导进行安装），或下载便携版 `Serpent-win-x86-64-<版本>-portable.zip`（解压到任意本地目录即可直接运行）。
2. 运行安装程序并按向导选择安装路径、语言等偏好完成安装。

未签名开发包可能触发 SmartScreen，请核对来源后选择「更多信息 → 仍要运行」。通过系统「设置 → 应用」卸载，卸载程序会干净移除安装文件。

## Linux

1. 从发布页下载 `Serpent-linux-x86-64-<版本>.AppImage`。
2. 赋予执行权限并运行：

```bash
chmod +x Serpent-linux-x86-64-<版本>.AppImage
./Serpent-linux-x86-64-<版本>.AppImage
```

运行依赖：

- **FUSE**（`libfuse2`）。没有 FUSE 时加 `--appimage-extract-and-run`。
- **系统 `ffmpeg` / `ffprobe`**（视频缩略图与代理）。可选安装 `openimageio-tools`（`oiiotool`）以支持 EXR/RAW/PSD 等专业图像格式。
- Debian/Ubuntu 示例：`sudo apt install libfuse2 ffmpeg`（可选 `openimageio-tools`）。

当前 Linux 行为与限制：

- 界面沿用 Windows 风格：无边框窗口、应用内主菜单（≡）、有合成器时圆角。
- **没有系统托盘**：关闭窗口会退出应用（不会像 Windows 那样隐藏到通知区域）。
- 不内置媒体二进制；需本机安装上述系统工具。
- 已在 Debian 13（X11）和嵌套 Wayland 合成器下测试；原生 Wayland 会话仍待专项验收。
- 无可用 GPU / GL 时可设置 `SERPENT_SOFTWARE_GL=1` 启用软件 WebGL。圆角可用 `SERPENT_LINUX_ROUNDED_CORNERS=0` / `1` 强制关闭或开启。

卸载：删除 AppImage 文件即可。资源库目录独立于应用文件，不会随之删除。

## 浏览器扩展

从[扩展发布页](https://github.com/dolag233/Serpent-Extension/releases)下载浏览器扩展（Chrome / Edge / Firefox），安装与使用见[浏览器扩展](browser-extension.md)。

## 升级

macOS 用新 DMG 替换应用，Windows 运行新版安装程序覆盖安装，Linux 用新版 AppImage 替换旧文件（可先保留旧文件以便回退）。资源库目录和用户配置独立于应用安装目录，通常会保留；升级前建议备份资源库。跨版本迁移和平台差异请以发布说明为准。

应用内「帮助 → 关于 → 检查更新」在 Linux 上会识别 `Serpent-linux-x86-64-<版本>.AppImage` 便携资产；下载校验后需自行 `chmod +x` 再运行。
