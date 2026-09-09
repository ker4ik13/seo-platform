import assert from "node:assert/strict";
import test from "node:test";
import {
  readRankingsPreferences,
  writeRankingsPreferences,
  type RankingsPreferences
} from "./rankings-preferences.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const fallback: RankingsPreferences = {
  dimensionKey: "",
  groupId: "",
  dateFrom: "2026-08-27",
  dateThrough: "2026-09-09",
  sort: "QUERY_ASC",
  queryColumnWidth: 300,
  hiddenDates: []
};

test("keeps all ranking screen controls isolated by user and project", () => {
  const storage = new MemoryStorage();
  const saved: RankingsPreferences = {
    dimensionKey: "YANDEX|RU|213|ru|DESKTOP",
    groupId: "01900000-0000-7000-8000-000000000001",
    dateFrom: "2026-08-01",
    dateThrough: "2026-09-09",
    sort: "POSITION_ASC",
    queryColumnWidth: 420,
    hiddenDates: ["2026-08-18", "2026-08-18", "2026-08-11"]
  };
  writeRankingsPreferences("project-a", "user-a", saved, storage);

  assert.deepEqual(readRankingsPreferences("project-a", "user-a", fallback, storage), {
    ...saved,
    hiddenDates: ["2026-08-18", "2026-08-11"]
  });
  assert.deepEqual(readRankingsPreferences("project-a", "user-b", fallback, storage), fallback);
  assert.deepEqual(readRankingsPreferences("project-b", "user-a", fallback, storage), fallback);
});
