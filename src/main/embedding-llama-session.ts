import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_AUDIO_WAV_BYTES = 8 * 1024 * 1024;
const MIME_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

export type LlamaEmbeddingFiles = {
  corePath: string;
  projectorPath: string;
};

export type LlamaEmbeddingSession = {
  embedText: (text: string) => Promise<number[]>;
  embedImage: (imagePath: string) => Promise<number[]>;
  embedAudio: (wavPath: string) => Promise<number[]>;
  close: () => Promise<void>;
};

/** OpenAI-style audio block. The WAV is mono 16 kHz PCM, with no text prefix. */
export function embeddingAudioRequestBody(wavBase64: string): {
  model: string;
  input: Array<{ content: Array<{ type: "input_audio"; input_audio: { data: string; format: "wav" } }> }>;
} {
  return {
    model: "embeddinggemma-2",
    input: [{
      content: [{
        type: "input_audio",
        input_audio: { data: wavBase64, format: "wav" },
      }],
    }],
  };
}

async function chooseLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a local inference port.");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function processHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function stopProcessTree(child: ChildProcess): Promise<void> {
  if (processHasExited(child) || !child.pid) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 10_000,
      });
      return;
    } catch {
      child.kill();
      return;
    }
  }
  child.kill("SIGTERM");
}

async function waitForHealth(input: {
  child: ChildProcess;
  baseUrl: string;
  spawnFailed: () => boolean;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < input.timeoutMs) {
    if (input.spawnFailed() || processHasExited(input.child)) {
      throw new Error("llama-server exited before it was ready.");
    }
    try {
      const response = await fetch(`${input.baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Health stays down until the weights finish loading.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("llama-server did not become ready.");
}

async function postEmbedding(input: {
  baseUrl: string;
  body: unknown;
  timeoutMs: number;
}): Promise<number[]> {
  const response = await fetch(`${input.baseUrl}/v1/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`llama-server returned HTTP ${response.status}.`);
  }
  const payload = await response.json() as { data?: Array<{ embedding?: unknown }> };
  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.some((value) => typeof value !== "number")) {
    throw new Error("llama-server did not return an embedding.");
  }
  return embedding as number[];
}

export async function startLlamaEmbeddingSession(input: {
  executable: string;
  files: LlamaEmbeddingFiles;
  gpuLayers: number;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
}): Promise<LlamaEmbeddingSession> {
  const port = await chooseLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const startupTimeoutMs = input.startupTimeoutMs ?? 180_000;
  const requestTimeoutMs = input.requestTimeoutMs ?? 180_000;
  const child = spawn(input.executable, [
    "--model", input.files.corePath,
    "--mmproj", input.files.projectorPath,
    "--embedding",
    "--pooling", "mean",
    "--ctx-size", "4096",
    "--batch-size", "4096",
    "--ubatch-size", "4096",
    "--n-gpu-layers", String(input.gpuLayers),
    input.gpuLayers > 0 ? "--mmproj-offload" : "--no-mmproj-offload",
    "--host", "127.0.0.1",
    "--port", String(port),
  ], {
    cwd: path.dirname(input.executable),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let spawnFailed = false;
  child.once("error", () => {
    spawnFailed = true;
  });
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", () => undefined);
  try {
    await waitForHealth({
      child,
      baseUrl,
      spawnFailed: () => spawnFailed,
      timeoutMs: startupTimeoutMs,
    });
  } catch (error) {
    await stopProcessTree(child);
    throw error;
  }

  let closed = false;
  return {
    embedText: (text) => postEmbedding({
      baseUrl,
      timeoutMs: requestTimeoutMs,
      body: { model: "embeddinggemma-2", input: [text] },
    }),
    embedImage: async (imagePath) => {
      const fileInfo = await stat(imagePath);
      if (fileInfo.size > MAX_IMAGE_BYTES) throw new Error("Image is too large to embed.");
      const mimeType = MIME_TYPES.get(path.extname(imagePath).toLowerCase());
      if (!mimeType) throw new Error("Image format is not supported.");
      const dataUrl = `data:${mimeType};base64,${(await readFile(imagePath)).toString("base64")}`;
      return postEmbedding({
        baseUrl,
        timeoutMs: requestTimeoutMs,
        body: {
          model: "embeddinggemma-2",
          input: [{
            content: [{ type: "image_url", image_url: { url: dataUrl } }],
          }],
        },
      });
    },
    embedAudio: async (wavPath) => {
      const fileInfo = await stat(wavPath);
      if (fileInfo.size <= 0 || fileInfo.size > MAX_AUDIO_WAV_BYTES) {
        throw new Error("Audio window is too large to embed.");
      }
      return postEmbedding({
        baseUrl,
        timeoutMs: requestTimeoutMs,
        body: embeddingAudioRequestBody((await readFile(wavPath)).toString("base64")),
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await stopProcessTree(child);
    },
  };
}
