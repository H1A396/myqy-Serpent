import { describe, expect, it } from "vitest";

import {
  embeddingBindingIssue,
  parseEmbeddingBindings,
  writeEmbeddingBinding,
} from "../../src/shared/embedding/library-binding";

describe("embedding library binding", () => {
  it("turns a library on for one selection and off when cleared", () => {
    const saved = writeEmbeddingBinding({}, "library-1", "embeddinggemma-2-compact");
    expect(saved["library-1"]).toEqual({ selectionId: "embeddinggemma-2-compact", enabled: true });
    expect(writeEmbeddingBinding(saved, "library-1", null)["library-1"]).toEqual({
      selectionId: null,
      enabled: false,
    });
    expect(writeEmbeddingBinding(saved, "library-1", "not-a-model")).toBe(saved);
  });

  it("reports install, missing, and configure instead of treating every saved id as ready", () => {
    const services = new Map([
      ["svc_readytext", { textStatus: "verified", dimensions: 1024 }],
      ["svc_needstest", { textStatus: "declared", dimensions: 1024 }],
    ]);
    expect(embeddingBindingIssue({
      binding: { selectionId: "embeddinggemma-2-compact", enabled: true },
      services,
      runtimeInstalled: false,
      installedModelIds: new Set(),
    })).toBe("install");
    expect(embeddingBindingIssue({
      binding: { selectionId: "svc_missing1", enabled: true },
      services,
      runtimeInstalled: true,
      installedModelIds: new Set(["embeddinggemma-2-compact"]),
    })).toBe("missing");
    expect(embeddingBindingIssue({
      binding: { selectionId: "svc_needstest", enabled: true },
      services,
      runtimeInstalled: true,
      installedModelIds: new Set(),
    })).toBe("configure");
    expect(embeddingBindingIssue({
      binding: { selectionId: "svc_readytext", enabled: true },
      services,
      runtimeInstalled: true,
      installedModelIds: new Set(),
    })).toBe("ready");
    expect(parseEmbeddingBindings({ "library-1": { selectionId: "nope", enabled: true } })["library-1"])
      .toEqual({ selectionId: null, enabled: false });
  });
});
