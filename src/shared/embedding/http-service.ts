/**
 * Custom embedding HTTP services.
 * `openai-embeddings-v1` posts to `/v1/embeddings` and may send `dimensions`.
 * `dashscope-multimodal-v1` posts to DashScope's multimodal embedding API
 * (`parameters.dimension`). qwen3-vl-embedding is not served by `/v1/embeddings`.
 * A saved address is not a verified model.
 */

import { explicitEmbeddingModalities } from "./modalities";

export const EMBEDDING_HTTP_ADAPTERS = ["openai-embeddings-v1", "dashscope-multimodal-v1"] as const;
export type EmbeddingHttpAdapter = (typeof EMBEDDING_HTTP_ADAPTERS)[number];
export const EMBEDDING_HTTP_ADAPTER = "openai-embeddings-v1";
export const DASHSCOPE_MULTIMODAL_PATH = "/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding";
export const EMBEDDING_DIMENSION_MAX = 8192;
export const EMBEDDING_SERVICE_DESTINATIONS = ["loopback", "lan", "internet"] as const;
export type EmbeddingServiceDestination = (typeof EMBEDDING_SERVICE_DESTINATIONS)[number];
export const EMBEDDING_TEXT_STATUSES = ["unsupported", "declared", "verified", "failed"] as const;
export type EmbeddingTextStatus = (typeof EMBEDDING_TEXT_STATUSES)[number];

export const EMBEDDING_SELECTION_ID = /^(?:embeddinggemma-2-(?:compact|balanced|quality)|svc_[a-z0-9]{8,40})$/;

export function isEmbeddingSelectionId(value: string): boolean {
  return EMBEDDING_SELECTION_ID.test(value);
}

export function isEmbeddingServiceSelectionId(value: string): boolean {
  return /^svc_[a-z0-9]{8,40}$/.test(value);
}

export type EmbeddingServiceIssue = "name" | "model" | "url" | "loopback" | "lan" | "https" | "modalities" | "dimensions";

export function isEmbeddingHttpAdapter(value: string): value is EmbeddingHttpAdapter {
  return (EMBEDDING_HTTP_ADAPTERS as readonly string[]).includes(value);
}

/** Blank means the probe may read the returned length. A filled value must be a positive integer. */
export function parseEmbeddingDimensions(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > EMBEDDING_DIMENSION_MAX) return null;
  return value;
}

export type NormalizedEmbeddingServiceUrl = {
  baseUrl: string;
  protocol: "http:" | "https:";
  hostname: string;
  place: EmbeddingServiceDestination;
};

const NAME_MAX = 80;
const MODEL_MAX = 120;

export function normalizeEmbeddingServiceUrl(value: string): NormalizedEmbeddingServiceUrl | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const hostname = url.hostname.toLowerCase();
  if (!hostname) return null;
  url.hash = "";
  url.search = "";
  url.hostname = hostname;
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    protocol: url.protocol,
    hostname,
    place: classifyEmbeddingHost(hostname),
  };
}

export function classifyEmbeddingHost(hostname: string): EmbeddingServiceDestination {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "loopback";
  if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return "lan";
  if (isPrivateIpv4(host)) return "lan";
  if (host.includes(":") && (host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd"))) {
    return "lan";
  }
  return "internet";
}

export function validateEmbeddingServiceDraft(input: {
  name: string;
  modelName: string;
  destination: EmbeddingServiceDestination;
  baseUrl: string;
  modalities?: readonly string[];
  dimensions?: number | null;
}): EmbeddingServiceIssue | null {
  const name = input.name.trim();
  const modelName = input.modelName.trim();
  if (!name || name.length > NAME_MAX) return "name";
  if (!modelName || modelName.length > MODEL_MAX) return "model";
  const url = normalizeEmbeddingServiceUrl(input.baseUrl);
  if (!url) return "url";
  if (input.destination === "loopback" && url.place !== "loopback") return "loopback";
  if (input.destination === "lan" && url.place !== "lan") return "lan";
  if (input.destination === "internet" && url.place !== "internet") return "lan";
  if (input.destination === "internet" && url.protocol !== "https:") return "https";
  if (input.modalities !== undefined && explicitEmbeddingModalities(input.modalities) === null) return "modalities";
  if (input.dimensions != null && parseEmbeddingDimensions(input.dimensions) === null) return "dimensions";
  return null;
}

/** llama-server uses `/v1/embeddings`. A base that already ends in `/v1` only adds `/embeddings`. */
export function embeddingHttpEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? `${path}/embeddings` : `${path}/v1/embeddings`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function embeddingServiceEndpoint(adapter: EmbeddingHttpAdapter, baseUrl: string): string {
  if (adapter === "openai-embeddings-v1") return embeddingHttpEndpoint(baseUrl);
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  if (!url.pathname.includes("multimodal-embedding")) url.pathname = DASHSCOPE_MULTIMODAL_PATH;
  return url.toString();
}

export function embeddingRequestBody(input: {
  adapter: EmbeddingHttpAdapter;
  modelName: string;
  inputs: readonly string[];
  dimensions: number | null;
}): Record<string, unknown> {
  if (input.adapter === "dashscope-multimodal-v1") {
    const body: Record<string, unknown> = {
      model: input.modelName,
      input: { contents: input.inputs.map((text) => ({ text })) },
    };
    if (input.dimensions) body.parameters = { dimension: input.dimensions };
    return body;
  }
  const body: Record<string, unknown> = {
    model: input.modelName,
    input: [...input.inputs],
  };
  if (input.dimensions) body.dimensions = input.dimensions;
  return body;
}

export function embeddingHttpProfileKey(input: {
  adapter: EmbeddingHttpAdapter;
  baseUrl: string;
  modelName: string;
  dimensions: number;
}): string {
  return [
    input.adapter,
    input.baseUrl,
    input.modelName.trim(),
    String(input.dimensions),
  ].join("\n");
}

export function readEmbeddingResponse(
  payload: unknown,
  expected: number,
  expectedDimensions: number | null,
): number[][] | null {
  return readEmbeddingHttpBatch(payload, expected, expectedDimensions)
    ?? readDashScopeEmbeddings(payload, expected, expectedDimensions);
}

export function readEmbeddingHttpBatch(
  payload: unknown,
  expected: number,
  expectedDimensions: number | null = null,
): number[][] | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== expected) return null;
  const rows: Array<number[] | undefined> = new Array(expected);
  for (const item of data) {
    if (!item || typeof item !== "object") return null;
    const row = item as { index?: unknown; embedding?: unknown };
    if (typeof row.index !== "number" || !Number.isInteger(row.index)) return null;
    if (row.index < 0 || row.index >= expected || rows[row.index]) return null;
    if (!Array.isArray(row.embedding) || row.embedding.length === 0) return null;
    if (row.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
    let norm = 0;
    for (const value of row.embedding) norm += value * value;
    if (norm === 0) return null;
    rows[row.index] = row.embedding as number[];
  }
  if (rows.some((row) => !row)) return null;
  return acceptEmbeddingRows(rows as number[][], expectedDimensions);
}

function readDashScopeEmbeddings(
  payload: unknown,
  expected: number,
  expectedDimensions: number | null,
): number[][] | null {
  if (!payload || typeof payload !== "object") return null;
  const output = (payload as { output?: unknown }).output;
  if (!output || typeof output !== "object") return null;
  const embeddings = (output as { embeddings?: unknown }).embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== expected) return null;
  const rows: Array<number[] | undefined> = new Array(expected);
  for (const [position, item] of embeddings.entries()) {
    if (!item || typeof item !== "object") return null;
    const record = item as { index?: unknown; embedding?: unknown };
    if (!Array.isArray(record.embedding) || record.embedding.length === 0) return null;
    if (record.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
    let norm = 0;
    for (const value of record.embedding) norm += value * value;
    if (norm === 0) return null;
    const index = typeof record.index === "number" ? record.index : position;
    if (!Number.isInteger(index) || index < 0 || index >= expected || rows[index]) return null;
    rows[index] = record.embedding as number[];
  }
  if (rows.some((row) => !row)) return null;
  return acceptEmbeddingRows(rows as number[][], expectedDimensions);
}

function acceptEmbeddingRows(rows: number[][], expectedDimensions: number | null): number[][] | null {
  const width = rows[0]?.length;
  if (!width || rows.some((row) => row.length !== width)) return null;
  if (expectedDimensions != null && width !== expectedDimensions) return null;
  return rows;
}

export function embeddingsDiffer(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return true;
  return left.some((value, index) => Math.abs(value - (right[index] ?? 0)) > 1e-6);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = numbers;
  if (first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second !== undefined && second >= 16 && second <= 31) return true;
  if (first === 169 && second === 254) return true;
  return false;
}
