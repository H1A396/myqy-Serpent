import { existsSync, mkdirSync, readdirSync, renameSync, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

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
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  renameSync(temporary, destination);
}

export async function downloadMissingTierFiles(
  modelId: SemanticSearchModelId,
  destinationDir: string,
  alreadyFound: ReadonlySet<string>,
): Promise<void> {
  const model = SEMANTIC_SEARCH_MODELS.find((entry) => entry.id === modelId);
  if (!model) throw new Error("Unknown semantic model.");
  const files = EMBEDDING_GEMMA2_TIER_FILES[model.tier];
  for (const fileName of [files.coreFile, files.projectorFile]) {
    if (alreadyFound.has(fileName)) continue;
    await downloadEmbeddingFile(embeddingDownloadUrl(fileName), path.join(destinationDir, fileName));
  }
}
