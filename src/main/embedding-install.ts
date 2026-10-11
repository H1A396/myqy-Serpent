import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, createWriteStream, unlinkSync, rmSync, chmodSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import path from "node:path";
import { open as openZip, type Entry } from "yauzl";

import {
  EMBEDDING_GEMMA2_MODEL_REVISION,
  EMBEDDING_GEMMA2_TIER_FILES,
  SEMANTIC_SEARCH_MODELS,
  type SemanticSearchModelId,
} from "../shared/embedding/profile";

const TARGET_NAMES = new Set([
  "embeddinggemma-2-UD-Q4_K_XL.gguf",
  "embeddinggemma-2-Q8_0.gguf",
  "embeddinggemma-2-BF16.gguf",
  "mmproj-Q8_0.gguf",
  "mmproj-BF16.gguf",
  "llama-server.exe",
  "llama-server",
]);

const SKIP_DIRECTORIES = new Set([
  "$recycle.bin",
  ".git",
  "appdata",
  "node_modules",
  "program files",
  "program files (x86)",
  "system volume information",
  "windows",
]);

const INTERESTING_DIRECTORY = /embed|gemma|gguf|llama|unsloth|huggingface/i;

export type EmbeddingSearchRoot = {
  readonly path: string;
  /** Drive roots only enter folders whose names look like a model cache. */
  readonly restrictNames: boolean;
};

export type EmbeddingInstallInspection = {
  readonly files: ReadonlyMap<string, string>;
  readonly runtimeFound: boolean;
};

export function installedSemanticModels(fileNames: ReadonlySet<string>): SemanticSearchModelId[] {
  return SEMANTIC_SEARCH_MODELS.filter((model) => {
    const files = EMBEDDING_GEMMA2_TIER_FILES[model.tier];
    return fileNames.has(files.coreFile) && fileNames.has(files.projectorFile);
  }).map((model) => model.id);
}

export function inspectEmbeddingTree(
  roots: readonly EmbeddingSearchRoot[],
  maxEntries = 8_000,
): EmbeddingInstallInspection {
  const files = new Map<string, string>();
  let seen = 0;
  let runtimeFound = false;

  const visit = (directory: string, depth: number, restrictNames: boolean): void => {
    if (depth < 0 || seen >= maxEntries) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen >= maxEntries) return;
      seen += 1;
      const fullPath = path.join(directory, entry.name);
      if (entry.isFile() && TARGET_NAMES.has(entry.name)) {
        if (!files.has(entry.name)) files.set(entry.name, fullPath);
        if (entry.name === "llama-server.exe" || entry.name === "llama-server") runtimeFound = true;
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      const interesting = INTERESTING_DIRECTORY.test(entry.name);
      if (restrictNames && !interesting) continue;
      visit(fullPath, interesting ? Math.max(depth, 4) : depth - 1, false);
    }
  };

  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    visit(root.path, root.restrictNames ? 1 : 6, root.restrictNames);
  }
  return { files, runtimeFound };
}

export function listExistingDriveRoots(): string[] {
  const roots: string[] = [];
  for (let code = "C".charCodeAt(0); code <= "Z".charCodeAt(0); code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (existsSync(root)) roots.push(root);
  }
  return roots;
}

export function embeddingSearchRoots(input: { userData: string; home: string }): EmbeddingSearchRoot[] {
  return [
    { path: path.join(input.userData, "embedding-models"), restrictNames: false },
    { path: path.join(input.home, ".cache", "huggingface"), restrictNames: false },
    ...listExistingDriveRoots().map((root) => ({ path: root, restrictNames: true })),
  ];
}

export function embeddingDownloadUrl(fileName: string): string {
  return `https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/${EMBEDDING_GEMMA2_MODEL_REVISION}/${fileName}`;
}

export async function downloadEmbeddingFile(url: string, destination: string): Promise<void> {
  mkdirSync(path.dirname(destination), { recursive: true });
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with status ${response.status}.`);
  }
  const temporary = `${destination}.partial`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    renameSync(temporary, destination);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The partial file is already gone.
    }
    throw error;
  }
}

export async function downloadMissingTierFiles(
  modelId: SemanticSearchModelId,
  destinationDir: string,
  alreadyFound: ReadonlySet<string>,
  downloadFile: (url: string, destination: string) => Promise<void> = downloadEmbeddingFile,
): Promise<void> {
  const model = SEMANTIC_SEARCH_MODELS.find((entry) => entry.id === modelId);
  if (!model) throw new Error("Unknown semantic model.");
  const files = EMBEDDING_GEMMA2_TIER_FILES[model.tier];
  for (const fileName of [files.coreFile, files.projectorFile]) {
    if (alreadyFound.has(fileName)) continue;
    await downloadFile(embeddingDownloadUrl(fileName), path.join(destinationDir, fileName));
  }
}

/** Pinned llama.cpp build that passed the EmbeddingGemma image canary. Not shipped in the app package. */
export const LLAMA_CPP_RELEASE = "b11457";

const TIER_DOWNLOAD_BYTES = {
  Q4_K_XL: 800_000_000,
  Q8_0: 950_000_000,
  BF16: 1_700_000_000,
} as const;

const RUNTIME_DOWNLOAD_BYTES: Partial<Record<NodeJS.Platform, number>> = {
  darwin: 80_000_000,
  win32: 900_000_000,
};

export function pinnedLlamaRuntimeAsset(
  platform: NodeJS.Platform,
  arch: string,
): { fileName: string } | null {
  if (platform === "darwin" && arch === "arm64") return { fileName: "llama-b11457-bin-macos-arm64.tar.gz" };
  if (platform === "darwin" && arch === "x64") return { fileName: "llama-b11457-bin-macos-x64.tar.gz" };
  if (platform === "win32" && arch === "x64") return { fileName: "llama-b11457-bin-win-cuda-12.4-x64.zip" };
  if (platform === "win32" && arch === "arm64") return { fileName: "llama-b11457-bin-win-cpu-arm64.zip" };
  return null;
}

export function pinnedLlamaRuntimeUrl(fileName: string): string {
  return `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_RELEASE}/${fileName}`;
}

export function runtimeArchiveEntryAllowed(entryName: string): boolean {
  const normalized = entryName.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return false;
  return normalized.split("/").every((part) => part !== "..");
}

export function embeddingInstallBytes(input: {
  modelId: SemanticSearchModelId;
  alreadyFound: ReadonlySet<string>;
  runtimeFound: boolean;
  platform: NodeJS.Platform;
  arch: string;
}): number {
  const model = SEMANTIC_SEARCH_MODELS.find((entry) => entry.id === input.modelId);
  if (!model) return 0;
  const files = EMBEDDING_GEMMA2_TIER_FILES[model.tier];
  let bytes = 0;
  for (const fileName of [files.coreFile, files.projectorFile]) {
    if (!input.alreadyFound.has(fileName)) bytes += TIER_DOWNLOAD_BYTES[model.tier];
  }
  if (!input.runtimeFound && pinnedLlamaRuntimeAsset(input.platform, input.arch)) {
    bytes += RUNTIME_DOWNLOAD_BYTES[input.platform] ?? 80_000_000;
  }
  return bytes;
}

export function resolveInstalledEmbeddingLayout(
  inspection: EmbeddingInstallInspection,
  modelId: SemanticSearchModelId,
  platform: NodeJS.Platform = process.platform,
): { modelDirectory: string; runtimePath: string } | null {
  const runtimeName = platform === "win32" ? "llama-server.exe" : "llama-server";
  const runtimePath = inspection.files.get(runtimeName)
    ?? inspection.files.get("llama-server")
    ?? inspection.files.get("llama-server.exe");
  if (!runtimePath) return null;
  const model = SEMANTIC_SEARCH_MODELS.find((entry) => entry.id === modelId);
  if (!model) return null;
  const files = EMBEDDING_GEMMA2_TIER_FILES[model.tier];
  const core = inspection.files.get(files.coreFile);
  const projector = inspection.files.get(files.projectorFile);
  if (!core || !projector) return null;
  if (path.dirname(core) !== path.dirname(projector)) return null;
  return { modelDirectory: path.dirname(core), runtimePath };
}

export class EmbeddingInstallError extends Error {
  readonly kind: "space" | "failed";

  constructor(kind: EmbeddingInstallError["kind"]) {
    super(kind);
    this.name = "EmbeddingInstallError";
    this.kind = kind;
  }
}

const execFileAsync = promisify(execFile);

export async function installEmbeddingFiles(input: {
  modelId: SemanticSearchModelId;
  destinationDir: string;
  alreadyFound: ReadonlySet<string>;
  runtimeFound: boolean;
  platform: NodeJS.Platform;
  arch: string;
  freeBytes?: number;
  downloadFile?: (url: string, destination: string) => Promise<void>;
  extractArchive?: (archivePath: string, destinationDir: string) => Promise<void>;
}): Promise<void> {
  const needed = embeddingInstallBytes({
    modelId: input.modelId,
    alreadyFound: input.alreadyFound,
    runtimeFound: input.runtimeFound,
    platform: input.platform,
    arch: input.arch,
  });
  if (input.freeBytes !== undefined && needed > 0 && input.freeBytes < needed) {
    throw new EmbeddingInstallError("space");
  }
  const downloadFile = input.downloadFile ?? downloadEmbeddingFile;
  await downloadMissingTierFiles(input.modelId, input.destinationDir, input.alreadyFound, downloadFile);
  if (input.runtimeFound) return;
  const asset = pinnedLlamaRuntimeAsset(input.platform, input.arch);
  if (!asset) return;
  const runtimeDir = path.join(input.destinationDir, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const archivePath = path.join(runtimeDir, asset.fileName);
  try {
    await downloadFile(pinnedLlamaRuntimeUrl(asset.fileName), archivePath);
    await (input.extractArchive ?? extractRuntimeArchive)(archivePath, runtimeDir);
  } catch (error) {
    rmSync(archivePath, { force: true });
    if (error instanceof EmbeddingInstallError) throw error;
    throw new EmbeddingInstallError("failed");
  }
  rmSync(archivePath, { force: true });
  markRuntimeExecutable(runtimeDir);
}

function markRuntimeExecutable(directory: string): void {
  if (process.platform === "win32") return;
  const visit = (current: string, depth: number): void => {
    if (depth < 0 || !existsSync(current)) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath, depth - 1);
      else if (entry.name === "llama-server") chmodSync(fullPath, 0o755);
    }
  };
  visit(directory, 4);
}

export async function extractRuntimeArchive(archivePath: string, destinationDir: string): Promise<void> {
  mkdirSync(destinationDir, { recursive: true });
  if (archivePath.endsWith(".zip")) {
    await extractZipArchive(archivePath, destinationDir);
    return;
  }
  await extractTarArchive(archivePath, destinationDir);
}

async function extractTarArchive(archivePath: string, destinationDir: string): Promise<void> {
  const listed = await execFileAsync("tar", ["-tzf", archivePath], { timeout: 60_000, maxBuffer: 8_000_000 });
  const names = listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (names.length === 0 || names.some((name) => !runtimeArchiveEntryAllowed(name))) {
    throw new EmbeddingInstallError("failed");
  }
  await execFileAsync("tar", ["-xzf", archivePath, "-C", destinationDir], { timeout: 120_000 });
}

function extractZipArchive(archivePath: string, destinationDir: string): Promise<void> {
  const root = path.resolve(destinationDir);
  return new Promise((resolve, reject) => {
    openZip(archivePath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new EmbeddingInstallError("failed"));
        return;
      }
      const fail = (cause: unknown) => {
        zip.close();
        reject(cause instanceof Error ? cause : new EmbeddingInstallError("failed"));
      };
      zip.on("error", fail);
      zip.on("entry", (entry: Entry) => {
        if (!runtimeArchiveEntryAllowed(entry.fileName)) {
          fail(new EmbeddingInstallError("failed"));
          return;
        }
        const target = path.resolve(root, entry.fileName);
        if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
          fail(new EmbeddingInstallError("failed"));
          return;
        }
        if (entry.fileName.endsWith("/")) {
          mkdirSync(target, { recursive: true });
          zip.readEntry();
          return;
        }
        mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new EmbeddingInstallError("failed"));
            return;
          }
          const output = createWriteStream(target);
          stream.on("error", fail);
          output.on("error", fail);
          output.on("finish", () => zip.readEntry());
          stream.pipe(output);
        });
      });
      zip.on("end", () => resolve());
      zip.readEntry();
    });
  });
}
