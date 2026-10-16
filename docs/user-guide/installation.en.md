# Installation

Download the latest installer from [Serpent Releases](https://github.com/dolag233/Serpent/releases).

## Requirements

- macOS: Apple Silicon (arm64) or Intel (x64), macOS 11 or newer
- Windows: 64-bit Windows 10 or Windows 11
- Linux: 64-bit x86_64 or aarch64 (release asset is an AppImage; newer distros recommended — both architectures use the Ubuntu 22.04 / glibc ≥ 2.35 baseline)
- The app uses about 500 MB; library data needs additional space

Use [Serpent Releases](https://github.com/dolag233/Serpent/releases) for current installers and version notes.

## macOS

1. Download the matching `Serpent-darwin-arm64-<version>-package.dmg` (or Intel build).
2. Open the DMG and drag Serpent to Applications.

Unsigned development builds may trigger Gatekeeper. Verify the source, then right-click the app, choose Open, and confirm. If it is still blocked, clear quarantine from Terminal:

```bash
xattr -cr /Applications/Serpent.app
```

To uninstall, move the app to the Trash. Libraries live where you created them and are not removed with the app.

## Windows

1. Download the Windows installer package `Serpent-win-x86-64-<version>-setup.zip` (extract and run the setup wizard), or download the portable build `Serpent-win-x86-64-<version>-portable.zip` (extract and run directly from any local directory).
2. Run the installer and follow the wizard to choose install path, language, and shortcut preferences.

Unsigned development builds may trigger SmartScreen. Verify the source, then choose **More info → Run anyway**. Uninstall from **Settings → Apps**; the uninstaller will cleanly remove application files.

## Linux

1. Download the AppImage that matches the machine: `Serpent-linux-x86-64-<version>.AppImage` for x86_64, or `Serpent-linux-arm64-<version>.AppImage` for aarch64.
2. Make it executable and run:

```bash
chmod +x Serpent-linux-x86-64-<version>.AppImage
./Serpent-linux-x86-64-<version>.AppImage
# On aarch64, use Serpent-linux-arm64-<version>.AppImage instead.
```

Runtime dependencies:

- **FUSE** (`libfuse2`). Without FUSE, add `--appimage-extract-and-run`. The same requirement applies to x86_64 and aarch64.
- The released AppImage ships the same `ffmpeg`, `ffprobe`, and `oiiotool` binaries as macOS and Windows (`oiiotool` includes LibRaw / OCIO). Video previews and professional image formats do not normally need those tools installed on the system. `SERPENT_FFMPEG_PATH` and `SERPENT_OIIO_PATH` can still point at another copy. The aarch64 asset appears on Releases after its media bundle is promoted.
- Debian/Ubuntu example: `sudo apt install libfuse2`. A source checkout that has not acquired the media bundle still needs system `ffmpeg`.

Current Linux behavior and limits:

- Windows-style shell: frameless window, in-app main menu (≡), rounded corners when a compositor is present.
- **No system tray**: closing the window quits the app (unlike Windows, which hides to the notification area).
- **Launch at login** is not offered yet. See [Basics](basics.md).
- Tested on Debian 13 (X11) and under a nested Wayland compositor; native Wayland sessions still need dedicated acceptance. x86_64 and aarch64 share these limits.
- Set `SERPENT_SOFTWARE_GL=1` for software WebGL when no usable GPU / GL driver is available. Force square / rounded corners with `SERPENT_LINUX_ROUNDED_CORNERS=0` / `1`.

To uninstall, delete the AppImage. Library directories are separate from the app file and are not removed with it.

## Browser extension

Download the browser extension (Chrome / Edge / Firefox) from the [extension releases](https://github.com/dolag233/Serpent-Extension/releases). Installation and usage: see [Browser extension](browser-extension.md).

## Upgrading

Replace the macOS app with the new DMG, run the new Windows installer over the existing install, or replace the Linux AppImage with the newer file (keep the old file until you confirm the upgrade). Libraries and user configuration live outside the application install directory and normally remain; back up a library before upgrading. Follow the release notes for migrations and platform-specific caveats.

In-app **Help → About → Check for updates** on Linux selects `Serpent-linux-x86-64-<version>.AppImage` or `Serpent-linux-arm64-<version>.AppImage` for the running architecture; after download and checksum verification, run `chmod +x` before launching.
