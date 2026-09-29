import { describe, expect, it } from "vitest";

import {
  resolveInspectorPendingEdits,
  type InspectorEditDraft,
  type InspectorLoadedEditableFields,
} from "../../src/renderer/inspector-pending-edits";

const emptyDraft: InspectorEditDraft = {
  description: "",
  rating: 0,
  favorite: false,
  sourcePageUrl: "",
  author: "",
};

const loaded: InspectorLoadedEditableFields = {
  description: "loaded description",
  rating: 3,
  favorite: true,
  sourcePageUrl: "https://example.test/source",
  author: "Loaded Author",
};

describe("resolveInspectorPendingEdits", () => {
  it("treats every field as untouched when there is no previous row", () => {
    expect(resolveInspectorPendingEdits(undefined, emptyDraft)).toEqual({
      description: false,
      rating: false,
      favorite: false,
      sourcePageUrl: false,
      author: false,
    });
  });

  it("treats every field as untouched when the draft matches the loaded row", () => {
    expect(
      resolveInspectorPendingEdits(loaded, {
        description: loaded.description ?? "",
        rating: loaded.rating,
        favorite: loaded.favorite,
        sourcePageUrl: loaded.sourcePageUrl ?? "",
        author: loaded.author ?? "",
      }),
    ).toEqual({
      description: false,
      rating: false,
      favorite: false,
      sourcePageUrl: false,
      author: false,
    });
  });

  it("flags only the fields the user has changed since the last load", () => {
    expect(
      resolveInspectorPendingEdits(loaded, {
        ...emptyDraft,
        description: "just typed",
        author: "Just Typed",
      }),
    ).toEqual({
      description: true,
      rating: true,
      favorite: true,
      sourcePageUrl: true,
      author: true,
    });
  });

  it("flags a single edited field without touching the others", () => {
    expect(
      resolveInspectorPendingEdits(loaded, {
        description: loaded.description ?? "",
        rating: loaded.rating,
        favorite: loaded.favorite,
        sourcePageUrl: loaded.sourcePageUrl ?? "",
        author: "While extraction runs",
      }),
    ).toEqual({
      description: false,
      rating: false,
      favorite: false,
      sourcePageUrl: false,
      author: true,
    });
  });

  it("compares nullable columns against an empty draft", () => {
    expect(
      resolveInspectorPendingEdits(
        {
          description: null,
          rating: 0,
          favorite: false,
          sourcePageUrl: null,
          author: null,
        },
        emptyDraft,
      ),
    ).toEqual({
      description: false,
      rating: false,
      favorite: false,
      sourcePageUrl: false,
      author: false,
    });
  });
});
