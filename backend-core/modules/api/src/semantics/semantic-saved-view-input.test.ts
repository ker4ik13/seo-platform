import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createSemanticSavedViewInput,
  updateSemanticSavedViewInput
} from "./semantic-saved-view-input.js";

const groupId = "01900000-0000-7000-8000-000000000010";
const appliedViewId = "01900000-0000-7000-8000-000000000011";

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
  columnOrder: ["query", "frequency", "priority", "intent"],
  density: "COMPACT",
  queryIndicators: ["AI_ANSWER", "TARGET_URL_MISMATCH"],
  columnWidths: { query: 420, priority: 90 },
  pageSize: 200,
  groupSidebarWidth: 280,
  expandedGroupIds: [groupId],
  selectedGroupIds: [groupId],
  appliedViewId
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
  assert.deepEqual(
    createSemanticSavedViewInput({
      name: "Без индикаторов",
      scope: "PRIVATE",
      config: { ...config, queryIndicators: [] }
    }).config.queryIndicators,
    []
  );
  assert.equal(
    createSemanticSavedViewInput({
      name: "URL выдачи",
      scope: "PRIVATE",
      config: { ...config, schemaVersion: 3 }
    }).config.schemaVersion,
    3
  );
  const dimension = "GOOGLE|RU|1011973|ru|MOBILE";
  assert.equal(
    createSemanticSavedViewInput({
      name: "Санкт-Петербург · телефон",
      scope: "PRIVATE",
      config: {
        ...config,
        schemaVersion: 4,
        sort: "RANK_POSITION_ASC",
        rankSortDimensionKey: dimension
      }
    }).config.rankSortDimensionKey,
    dimension
  );
  assert.throws(() => createSemanticSavedViewInput({
    name: "Нет среза",
    scope: "PRIVATE",
    config: { ...config, schemaVersion: 4, sort: "RANK_POSITION_ASC" }
  }));
  assert.throws(() => createSemanticSavedViewInput({
    name: "Будущая схема",
    scope: "PRIVATE",
    config: { ...config, schemaVersion: 5 }
  }));
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
        config: { ...config, columnOrder: ["query", "priority"] }
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
  assert.throws(
    () =>
      createSemanticSavedViewInput({
        name: "Broken",
        scope: "PRIVATE",
        config: { ...config, groupSidebarWidth: 900 }
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
          queryIndicators: ["AI_ANSWER", "AI_ANSWER"]
        }
      }),
    DomainError
  );
  assert.throws(
    () =>
      createSemanticSavedViewInput({
        name: "Broken",
        scope: "PRIVATE",
        config: { ...config, queryIndicators: ["UNKNOWN"] }
      }),
    DomainError
  );
  assert.throws(() => updateSemanticSavedViewInput({}), DomainError);
});
