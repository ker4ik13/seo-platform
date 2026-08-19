import assert from "node:assert/strict";
import test from "node:test";
import {
  clampSemanticColumnWidth,
  clampSemanticGroupSidebarWidth,
  normalizeSemanticKeywordPageSize,
  readSemanticLayoutPreferences,
  semanticColumnDefaultWidth,
  semanticVisibleColumnWidths,
  writeSemanticLayoutPreferences
} from "./semantic-layout-preferences.ts";

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
