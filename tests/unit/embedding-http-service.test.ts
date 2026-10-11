import { describe, expect, it } from "vitest";

import {
  embeddingRequestBody,
  embeddingServiceEndpoint,
  embeddingsDiffer,
  embeddingHttpEndpoint,
  readEmbeddingHttpBatch,
  readEmbeddingResponse,
  validateEmbeddingServiceDraft,
} from "../../src/shared/embedding/http-service";
import {
  markEmbeddingServiceProbe,
  parseEmbeddingServiceCatalog,
  saveEmbeddingService,
  summarizeEmbeddingServices,
  EmbeddingServiceRegistryError,
  type EmbeddingServiceCredentialStore,
} from "../../src/main/embedding-service-registry";
import { loadSemanticSearchPreferences } from "../../src/renderer/semantic-search-preferences";

function memoryCredentials(): EmbeddingServiceCredentialStore & { keys: Map<string, string> } {
  const keys = new Map<string, string>();
  return {
    keys,
    has: (id) => keys.has(id),
    read: (id) => keys.get(id) ?? null,
    write: (id, apiKey) => { keys.set(id, apiKey); },
    delete: (id) => { keys.delete(id); },
  };
}

describe("embedding http services", () => {
  it("accepts a loopback service and rejects a cloud address in the wrong place", () => {
    expect(validateEmbeddingServiceDraft({
      name: "Local",
      modelName: "bge",
      destination: "loopback",
      baseUrl: "http://127.0.0.1:8080",
    })).toBeNull();
    expect(validateEmbeddingServiceDraft({
      name: "Local",
      modelName: "bge",
      destination: "loopback",
      baseUrl: "http://192.168.1.8:8080",
    })).toBe("loopback");
    expect(validateEmbeddingServiceDraft({
      name: "Cloud",
      modelName: "text-embedding-3-small",
      destination: "internet",
      baseUrl: "http://example.com/v1",
    })).toBe("https");
    expect(validateEmbeddingServiceDraft({
      name: "Cloud",
      modelName: "text-embedding-3-small",
      destination: "internet",
      baseUrl: "https://user:secret@example.com/v1",
    })).toBe("url");
  });

  it("builds the embeddings endpoint and maps vectors by index", () => {
    expect(embeddingHttpEndpoint("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080/v1/embeddings");
    expect(embeddingHttpEndpoint("https://example.com/v1")).toBe("https://example.com/v1/embeddings");
    const batch = readEmbeddingHttpBatch({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    }, 2);
    expect(batch?.[0]).toEqual([1, 0]);
    expect(batch?.[1]).toEqual([0, 1]);
    expect(readEmbeddingHttpBatch({ data: [{ index: 0, embedding: [Number.NaN] }] }, 1)).toBeNull();
    expect(embeddingsDiffer([1, 0], [0, 1])).toBe(true);
  });

  it("keeps the api key out of the saved catalog", () => {
    const credentials = memoryCredentials();
    const catalog = saveEmbeddingService({ version: 1, services: [] }, credentials, {
      name: "Cloud",
      destination: "internet",
      baseUrl: "https://example.com/v1",
      modelName: "text-embedding-3-small",
      apiKey: "secret-key",
    });
    expect(JSON.stringify(catalog)).not.toContain("secret-key");
    expect(credentials.keys.values().next().value).toBe("secret-key");
    const [summary] = summarizeEmbeddingServices(parseEmbeddingServiceCatalog(catalog), credentials);
    expect(summary?.hasCredential).toBe(true);
    expect(summary?.textStatus).toBe("declared");
    expect(JSON.stringify(summary)).not.toContain("secret-key");
  });

  it("remembers a tested custom service id", () => {
    const storage = {
      value: JSON.stringify({
        version: 1,
        enabled: true,
        modelId: "svc_abc12345",
      }),
      getItem: () => storage.value,
      setItem: (key: string, item: string) => { void key; storage.value = item; },
    };
    expect(loadSemanticSearchPreferences(storage).modelId).toBe("svc_abc12345");
  });

  it("stores declared modalities and dimensions, and rejects an empty modality list", () => {
    const credentials = memoryCredentials();
    const catalog = saveEmbeddingService({ version: 1, services: [] }, credentials, {
      name: "Cloud",
      adapter: "openai-embeddings-v1",
      destination: "internet",
      baseUrl: "https://example.com/compatible-mode/v1",
      modelName: "text-embedding-v4",
      modalities: ["text"],
      dimensions: 1024,
    });
    expect(catalog.services[0]).toMatchObject({
      adapter: "openai-embeddings-v1",
      modalities: ["text"],
      dimensions: 1024,
      textStatus: "declared",
    });
    expect(() => saveEmbeddingService(catalog, credentials, {
      name: "Cloud",
      destination: "internet",
      baseUrl: "https://example.com/compatible-mode/v1",
      modelName: "text-embedding-v4",
      modalities: [],
    })).toThrow(EmbeddingServiceRegistryError);
    expect(validateEmbeddingServiceDraft({
      name: "Cloud",
      modelName: "text-embedding-v4",
      destination: "internet",
      baseUrl: "https://example.com/v1",
      dimensions: 0,
    })).toBe("dimensions");
  });

  it("keeps a user-entered length when the probe vector does not match", () => {
    const credentials = memoryCredentials();
    const saved = saveEmbeddingService({ version: 1, services: [] }, credentials, {
      name: "Dash",
      adapter: "dashscope-multimodal-v1",
      destination: "internet",
      baseUrl: "https://dashscope.aliyuncs.com",
      modelName: "qwen3-vl-embedding",
      modalities: ["text", "image", "video"],
      dimensions: 1024,
    });
    const id = saved.services[0]?.id ?? "";
    const failed = markEmbeddingServiceProbe(saved, id, { ok: true, dimensions: 2560 });
    expect(failed.services[0]).toMatchObject({ textStatus: "failed", dimensions: 1024 });
    const verified = markEmbeddingServiceProbe(saved, id, { ok: true, dimensions: 1024 });
    expect(verified.services[0]).toMatchObject({ textStatus: "verified", dimensions: 1024 });
  });

  it("sends OpenAI dimensions and DashScope dimension, and rejects the wrong length", () => {
    expect(embeddingRequestBody({
      adapter: "openai-embeddings-v1",
      modelName: "text-embedding-v4",
      inputs: ["a"],
      dimensions: 1024,
    })).toEqual({ model: "text-embedding-v4", input: ["a"], dimensions: 1024 });
    expect(embeddingRequestBody({
      adapter: "dashscope-multimodal-v1",
      modelName: "qwen3-vl-embedding",
      inputs: ["a"],
      dimensions: 1024,
    })).toEqual({
      model: "qwen3-vl-embedding",
      input: { contents: [{ text: "a" }] },
      parameters: { dimension: 1024 },
    });
    expect(embeddingServiceEndpoint("dashscope-multimodal-v1", "https://dashscope.aliyuncs.com"))
      .toBe("https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding");
    expect(embeddingServiceEndpoint(
      "dashscope-multimodal-v1",
      "https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding",
    )).toBe("https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding");
    const dashscope = readEmbeddingResponse({
      output: { embeddings: [{ embedding: [1, 0], type: "text" }] },
    }, 1, 2);
    expect(dashscope).toEqual([[1, 0]]);
    expect(readEmbeddingResponse({
      output: { embeddings: [{ embedding: [1, 0, 0] }] },
    }, 1, 2)).toBeNull();
    expect(readEmbeddingHttpBatch({
      data: [{ index: 0, embedding: [1, 0, 0] }],
    }, 1, 2)).toBeNull();
  });
});
