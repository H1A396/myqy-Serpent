import {
  embeddingRequestBody,
  embeddingServiceEndpoint,
  embeddingsDiffer,
  readEmbeddingResponse,
  type EmbeddingHttpAdapter,
} from "../shared/embedding/http-service";

const PROBE_INPUTS = ["a red bicycle", "quarterly budget meeting"] as const;

export class EmbeddingHttpRequestError extends Error {
  readonly kind: "network" | "auth" | "format";

  constructor(kind: EmbeddingHttpRequestError["kind"]) {
    super(kind);
    this.name = "EmbeddingHttpRequestError";
    this.kind = kind;
  }
}

export async function postEmbeddingHttp(input: {
  baseUrl: string;
  modelName: string;
  inputs: readonly string[];
  apiKey: string | null;
  adapter?: EmbeddingHttpAdapter;
  dimensions?: number | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<number[][]> {
  const adapter = input.adapter ?? "openai-embeddings-v1";
  const dimensions = input.dimensions ?? null;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(embeddingServiceEndpoint(adapter, input.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(embeddingRequestBody({
        adapter,
        modelName: input.modelName,
        inputs: input.inputs,
        dimensions,
      })),
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
    });
  } catch {
    throw new EmbeddingHttpRequestError("network");
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new EmbeddingHttpRequestError("auth");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new EmbeddingHttpRequestError("format");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EmbeddingHttpRequestError("format");
  }
  const vectors = readEmbeddingResponse(payload, input.inputs.length, dimensions);
  if (!vectors) throw new EmbeddingHttpRequestError("format");
  return vectors;
}

export async function probeEmbeddingHttp(input: {
  baseUrl: string;
  modelName: string;
  apiKey: string | null;
  adapter?: EmbeddingHttpAdapter;
  dimensions?: number | null;
  fetchImpl?: typeof fetch;
}): Promise<{ dimensions: number }> {
  const expected = input.dimensions ?? null;
  const vectors = await postEmbeddingHttp({
    ...input,
    inputs: PROBE_INPUTS,
    dimensions: expected,
    timeoutMs: 30_000,
  });
  const [left, right] = vectors;
  if (!left || !right || !embeddingsDiffer(left, right)) throw new EmbeddingHttpRequestError("format");
  if (expected != null && left.length !== expected) throw new EmbeddingHttpRequestError("format");
  return { dimensions: left.length };
}
