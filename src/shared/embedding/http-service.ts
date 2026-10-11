/**
 * OpenAI-compatible text embedding services. A saved address is not a verified
 * model, and a text endpoint is not an image endpoint.
 */

export const EMBEDDING_HTTP_ADAPTER = "openai-embeddings-v1";
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

export type EmbeddingServiceIssue = "name" | "model" | "url" | "loopback" | "lan" | "https";

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

export function embeddingHttpProfileKey(input: {
  baseUrl: string;
  modelName: string;
  dimensions: number;
}): string {
  return [
    EMBEDDING_HTTP_ADAPTER,
    input.baseUrl,
    input.modelName.trim(),
    String(input.dimensions),
  ].join("\n");
}

export function readEmbeddingHttpBatch(payload: unknown, expected: number): number[][] | null {
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
  const width = rows[0]?.length;
  if (!width || rows.some((row) => row?.length !== width)) return null;
  return rows as number[][];
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
