import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createSemanticSavedViewInput,
  updateSemanticSavedViewInput
} from "./semantic-saved-view-input.js";

const config = {
  schemaVersion: 1,
  filters: {
    search: "  SEO аудит  ",
    intent: "COMMERCIAL",
    isFavorite: false,
    priorityMin: 10,
    priorityMax: 50
  },
  sort: "PRIORITY_DESC",
  columns: ["query", "priority", "intent"],
  density: "COMPACT"
};

test("normalizes an exact versioned semantic saved view", () => {
  assert.deepEqual(
    createSemanticSavedViewInput({
      name: "  Коммерческие запросы  ",
      scope: "PROJECT_SHARED",
      config
    }),
    {
      name: "Коммерческие запросы",
      scope: "PROJECT_SHARED",
      config: {
        ...config,
        filters: { ...config.filters, search: "SEO аудит" }
      }
    }
  );
  assert.deepEqual(updateSemanticSavedViewInput({ name: "Личное" }), {
    name: "Личное"
  });
});

test("rejects unknown DSL fields, invalid ranges and unsafe columns", () => {
  assert.throws(
    () =>
      createSemanticSavedViewInput({
        name: "Broken",
        scope: "PRIVATE",
        config: { ...config, sql: "DROP TABLE keywords" }
      }),
    DomainError
  );
  assert.throws(
    () =>
      createSemanticSavedViewInput({
        name: "Broken",
        scope: "PRIVATE",
        config: {
          ...config,
          filters: { priorityMin: 90, priorityMax: 10 }
        }
      }),
    DomainError
  );
  assert.throws(
    () =>
      createSemanticSavedViewInput({
        name: "Broken",
        scope: "PRIVATE",
        config: { ...config, columns: ["query", "query"] }
      }),
    DomainError
  );
  assert.throws(() => updateSemanticSavedViewInput({}), DomainError);
});
