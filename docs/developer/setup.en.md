# Setup

## Requirements

- Node.js **24.15.0** (locked in `.nvmrc`; use `nvm use`)
- npm
- Native development targets: macOS arm64, Windows x64, Linux x64
- **Do not build or run from an SMB/NAS-mounted path** — Electron fails to start on mounted volumes (`icudtl.dat not found`) and packaged apps cannot run from them either

### macOS

- Xcode Command Line Tools (for native module builds)
- Media component builds (only when rebuilding): `scripts/media-build/darwin-arm64.sh` (vcpkg, takes hours)

### Windows

- Git, PowerShell
- Visual Studio Build Tools: "Desktop development with C++" workload + Windows SDK (required to compile native module `better-sqlite3`)
- **Inno Setup 6** (required when building the Windows installer package `SerpentSetup.exe`):
  - Recommended (no admin rights required): Fetch `Tools.InnoSetup` via NuGet, extract `ISCC.exe` into `%LOCALAPPDATA%\SerpentTools\inno\tools\`;
  - Official installer: Install official Inno Setup 6 and set environment variable `SERPENT_INNO_TOOLS` to the directory containing `ISCC.exe` (or add it to system `PATH`);
  - Not needed if only running dev mode (`npm start`) or creating portable builds (`npm run package`).
- Media component builds (only when rebuilding underlying binaries): `scripts/media-build/win32-x64.ps1` (vcpkg)

### Linux

- Compiler toolchain and Python (`better-sqlite3`): on Debian/Ubuntu, `sudo apt install build-essential python3`
- **Media tools**: the linux-x64 pinned bundle is ready in `bundle-lock.json`. `npm ci` does not install it. Until `media:ensure` or `release:media` has run, `npm start` still uses `ffmpeg` / `ffprobe` from `PATH`, with optional `openimageio-tools` (`oiiotool`) for EXR/RAW/PSD. The release AppImage packs that bundle in, so it depends less on the system PATH. linux-arm64 still has no bundle.
- AppImage release builds should use Docker (`npm run make:appimage:docker` targets Ubuntu 22.04 / glibc 2.35); without Docker use host `npm run make:appimage`
- Useful env vars: `SERPENT_SOFTWARE_GL=1` (software WebGL without a GPU), `SERPENT_LINUX_ROUNDED_CORNERS=0|1` (force square/rounded corners), `SERPENT_FFMPEG_PATH` / `SERPENT_OIIO_PATH` (override PATH lookup)

## First build

```bash
npm ci --registry=https://registry.npmjs.org
npm run rebuild:native
npm start
```

`rebuild:native` compiles `better-sqlite3` for Electron's ABI and verifies FTS5. On Windows, **do not** run a bare `@electron/rebuild` or `node-gyp` — machine-wide vcpkg MSBuild integration can link against a non-FTS5 sqlite3.dll; the project script disables it.

## Media components

`npm ci` does **not** install FFmpeg/ffprobe/OpenImageIO. Without them, normal development and image import still work; video thumbnails/proxies fail with `FFMPEG_REQUIRED`, and EXR/TGA/complex TIFF need OpenImageIO.

Packaged builds use the controlled media bundle (FFmpeg 8.1 LGPL-only + OpenImageIO 3.1.12.0); gates verify provenance and hashes (`bundle-lock.json` promotion status + `source-lock.json` version match). For local development you can point at any trusted FFmpeg via `SERPENT_FFMPEG_PATH` (needs the required filters/encoders; `ffprobe` in the same directory; GPL builds are local-dev only):

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
# Linux (or rely on distro ffmpeg already on PATH)
export SERPENT_FFMPEG_PATH=/usr/bin/ffmpeg
npm start
```

Quit Serpent completely before retrying (single-instance lock; a second `npm start` does not replace a running process).

## Common commands

```bash
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # unit + worker integration (runs in Electron)
npm run test:unit        # unit only
npm run test:worker      # worker integration only
npm run test:e2e         # Playwright E2E
npm start                # development launch
npm run start:multi      # two instances
```

## Notes

- Tests run under Electron's ABI (`test:worker`/`test` go through `run-vitest-with-electron.mjs`); after `npm run package`, run `npm run rebuild:native` to restore the dev native module
- `npm start` auto-avoids occupied Vite ports
