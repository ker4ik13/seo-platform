import assert from "node:assert/strict";
import test from "node:test";
import {
  clampSemanticColumnWidth,
  clampSemanticGroupSidebarWidth,
  normalizeSemanticKeywordPageSize,
  readSemanticLayoutPreferences,
  semanticAppliedTableLayoutConfig,
  semanticColumnDefaultWidth,
  semanticSavedViewConfigForPersistence,
  semanticVisibleColumnWidths,
  writeSemanticLayoutPreferences
} from "./semantic-layout-preferences.ts";
import {
  defaultSemanticViewConfig,
  semanticColumnOrderFor,
  semanticViewConfigForCurrentSchema
} from "../components/semantic-view-types.ts";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("keeps semantic widths isolated per project", () => {
  const storage = new MemoryStorage();
  writeSemanticLayoutPreferences(
    "project-a",
    {
      groupSidebarWidth: 412,
      columnWidths: { query: 388, priority: 94 },
      pageSize: 500,
      expandedGroupIds: ["group-a", "group-b"]
    },
    storage
  );

  assert.deepEqual(readSemanticLayoutPreferences("project-a", storage), {
    groupSidebarWidth: 412,
    columnWidths: { query: 388, priority: 94 },
    pageSize: 500,
    expandedGroupIds: ["group-a", "group-b"]
  });
  assert.deepEqual(readSemanticLayoutPreferences("project-b", storage), {
    groupSidebarWidth: 230,
    columnWidths: {},
    pageSize: 100,
    expandedGroupIds: null
  });
});

test("clamps corrupted or unsafe layout dimensions", () => {
  assert.equal(clampSemanticGroupSidebarWidth(40), 196);
  assert.equal(clampSemanticGroupSidebarWidth(9_000), 520);
  assert.equal(clampSemanticColumnWidth("query", 20), 180);
  assert.equal(clampSemanticColumnWidth("priority", 900), 640);
  assert.equal(semanticColumnDefaultWidth("custom:traffic"), 168);
  assert.equal(normalizeSemanticKeywordPageSize(1_000), 1_000);
  assert.equal(normalizeSemanticKeywordPageSize(201), 100);
});

test("shows regular and AI result URLs in the default semantic layout", () => {
  assert.deepEqual(
    defaultSemanticViewConfig.columns.slice(5, 13),
    [
      "yandexPosition",
      "yandexRelevantUrl",
      "googlePosition",
      "googleRelevantUrl",
      "yandexAiPosition",
      "yandexAiRelevantUrl",
      "googleAiPosition",
      "googleAiRelevantUrl"
    ]
  );
});

test("migrates v1 saved layouts to regular and AI result URL columns", () => {
  const migrated = semanticViewConfigForCurrentSchema({
    schemaVersion: 1,
    filters: {},
    sort: "CREATED_DESC",
    columns: [
      "query",
      "yandexPosition",
      "googlePosition",
      "yandexAiPosition",
      "googleAiPosition"
    ],
    columnOrder: [
      "query",
      "yandexPosition",
      "googlePosition",
      "yandexAiPosition",
      "googleAiPosition"
    ],
    density: "COMFORTABLE"
  });
  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.columns, [
    "query",
    "yandexPosition",
    "yandexRelevantUrl",
    "googlePosition",
    "googleRelevantUrl",
    "yandexAiPosition",
    "yandexAiRelevantUrl",
    "googleAiPosition",
    "googleAiRelevantUrl"
  ]);
  assert.deepEqual(migrated.columnOrder, migrated.columns);
});

test("migrates v2 layouts only to AI result URLs and respects v3 visibility", () => {
  const migrated = semanticViewConfigForCurrentSchema({
    schemaVersion: 2,
    filters: {},
    sort: "CREATED_DESC",
    columns: ["query", "yandexAiPosition", "googleAiPosition"],
    columnOrder: ["query", "yandexAiPosition", "googleAiPosition"],
    density: "COMFORTABLE"
  });
  assert.deepEqual(migrated.columns, [
    "query",
    "yandexAiPosition",
    "yandexAiRelevantUrl",
    "googleAiPosition",
    "googleAiRelevantUrl"
  ]);
  const current = semanticViewConfigForCurrentSchema({
    ...migrated,
    schemaVersion: 3,
    columns: ["query"]
  });
  assert.equal(current.schemaVersion, 4);
  assert.deepEqual(current.columns, ["query"]);
});

test("persists widths only for columns included in the saved view", () => {
  assert.deepEqual(
    semanticVisibleColumnWidths(
      ["query", "tags", "custom:01900000-0000-7000-8000-000000000001"],
      {
        query: 388,
        tags: 142,
        priority: 94,
        "custom:01900000-0000-7000-8000-000000000001": 176
      }
    ),
    {
      query: 388,
      tags: 142,
      "custom:01900000-0000-7000-8000-000000000001": 176
    }
  );
});

test("applies reordered columns and multiple removals as one valid layout", () => {
  const current = {
    schemaVersion: 1,
    filters: { search: "подшипник" },
    sort: "CREATED_DESC",
    columns: [
      "query",
      "frequency",
      "frequencyExact",
      "tags",
      "priority",
      "source"
    ],
    columnOrder: [
      "query",
      "frequency",
      "frequencyExact",
      "tags",
      "priority",
      "source"
    ],
    density: "COMFORTABLE",
    queryIndicators: ["AI_ANSWER", "MULTIPLE_URLS"],
    columnWidths: {
      query: 388,
      frequency: 92,
      frequencyExact: 86,
      tags: 142,
      priority: 94,
      source: 108
    }
  } as const;
  const draft = {
    ...current,
    columns: ["query", "source", "tags"],
    columnOrder: [
      "query",
      "source",
      "frequency",
      "frequencyExact",
      "tags",
      "priority"
    ],
    density: "COMPACT",
    queryIndicators: ["TARGET_URL_MISMATCH"],
    columnWidths: {
      query: 388,
      source: 132,
      tags: 176
    }
  } as const;

  assert.deepEqual(semanticAppliedTableLayoutConfig(current, draft), {
    ...current,
    columns: ["query", "source", "tags"],
    columnOrder: [
      "query",
      "source",
      "frequency",
      "frequencyExact",
      "tags",
      "priority"
    ],
    density: "COMPACT",
    queryIndicators: ["TARGET_URL_MISMATCH"],
    columnWidths: {
      query: 388,
      source: 132,
      tags: 176
    }
  });
});

test("keeps hidden columns in their drawer positions", () => {
  const available = ["query", "frequency", "tags", "priority"] as const;
  assert.deepEqual(
    semanticColumnOrderFor(
      {
        columns: ["query", "frequency", "priority"],
        columnOrder: ["query", "frequency", "tags", "priority"]
      },
      available
    ),
    ["query", "frequency", "tags", "priority"]
  );
  assert.deepEqual(
    semanticColumnOrderFor(
      { columns: ["query", "priority"] },
      available
    ),
    ["query", "priority", "frequency", "tags"]
  );
});

test("defensively removes hidden widths at the saved-view request boundary", () => {
  assert.deepEqual(
    semanticSavedViewConfigForPersistence({
      schemaVersion: 1,
      filters: {},
      sort: "CREATED_DESC",
      columns: ["query"],
      density: "COMFORTABLE",
      columnWidths: { query: 320, frequency: 92 }
    }),
    {
      schemaVersion: 1,
      filters: {},
      sort: "CREATED_DESC",
      columns: ["query"],
      density: "COMFORTABLE",
      queryIndicators: [
        "AI_ANSWER",
        "MULTIPLE_URLS",
        "TARGET_URL_MISMATCH"
      ],
      columnWidths: { query: 320 }
    }
  );
});

test("preserves an explicit empty query-indicator selection", () => {
  assert.deepEqual(
    semanticSavedViewConfigForPersistence({
      schemaVersion: 1,
      filters: {},
      sort: "CREATED_DESC",
      columns: ["query"],
      density: "COMFORTABLE",
      queryIndicators: []
    }),
    {
      schemaVersion: 1,
      filters: {},
      sort: "CREATED_DESC",
      columns: ["query"],
      density: "COMFORTABLE",
      queryIndicators: []
    }
  );
});

test("falls back when stored layout is malformed", () => {
  const storage = new MemoryStorage();
  storage.setItem("seonorita:semantic-layout:v1:broken", "{");
  assert.deepEqual(readSemanticLayoutPreferences("broken", storage), {
    groupSidebarWidth: 230,
    columnWidths: {},
    pageSize: 100,
    expandedGroupIds: null
  });
});
