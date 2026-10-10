import assert from "node:assert/strict";
import test from "node:test";
import {
  readRankingsPreferences,
  readPreferredSeoDimensionKey,
  preferredProjectRankDimensionKey,
  writePreferredSeoDimensionKey,
  writeRankingsPreferences,
  type RankingsPreferences
} from "./rankings-preferences.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const fallback: RankingsPreferences = {
  mode: "SEO",
  seoDimensionKey: "",
  aiDimensionKey: "",
  groupId: "",
  dateFrom: "2026-08-27",
  dateThrough: "2026-09-09",
  sort: "QUERY_ASC",
  queryColumnWidth: 300,
  hiddenDates: [],
  includeUntracked: false
};

test("URL filters and the number-column width survive reload only in their own scope", () => {
  const storage = new MemoryStorage();
  writeRankingsPreferences("project-a", "user-a", { ...fallback, targetUrlState: "EMPTY", multipleUrlsState: "NOT_MULTIPLE", sort: "TARGET_URL_EMPTY_FIRST", numberColumnWidth: 70 }, storage);
  const loaded = readRankingsPreferences("project-a", "user-a", fallback, storage);
  assert.equal(loaded.targetUrlState, "EMPTY");
  assert.equal(loaded.multipleUrlsState, "NOT_MULTIPLE");
  assert.equal(loaded.numberColumnWidth, 70);
  assert.equal(loaded.sort, "TARGET_URL_EMPTY_FIRST");
  assert.deepEqual(readRankingsPreferences("project-a", "user-b", fallback, storage), fallback);
});

test("obsolete density is ignored without losing saved dates or column widths", () => {
  const storage = new MemoryStorage();
  storage.setItem("seonorita:rankings-view:v1:user-a:project-a", JSON.stringify({
    ...fallback, density: "COMFORTABLE", hiddenDates: ["2026-08-18"], queryColumnWidth: 360,
  }));
  assert.deepEqual(readRankingsPreferences("project-a", "user-a", fallback, storage), {
    ...fallback, hiddenDates: ["2026-08-18"], queryColumnWidth: 360,
  });
});

test("keeps all ranking screen controls isolated by user and project", () => {
  const storage = new MemoryStorage();
  const saved: RankingsPreferences = {
    mode: "AI",
    seoDimensionKey: "YANDEX|RU|213|ru|DESKTOP",
    aiDimensionKey: "GOOGLE|RU|213|ru|MOBILE",
    groupId: "01900000-0000-7000-8000-000000000001",
    dateFrom: "2026-08-01",
    dateThrough: "2026-09-09",
    sort: "POSITION_ASC",
    includeUntracked: true,
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

test("migrates the old shared dimension into the SEO view", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    "seonorita:rankings-view:v1:user-a:project-a",
    JSON.stringify({ dimensionKey: "YANDEX|RU|2|ru|MOBILE" })
  );
  assert.deepEqual(
    readRankingsPreferences("project-a", "user-a", fallback, storage),
    {
      ...fallback,
      seoDimensionKey: "YANDEX|RU|2|ru|MOBILE"
    }
  );
});

test("dashboard reuses and updates the exact project SEO slice", () => {
  const storage = new MemoryStorage();
  writeRankingsPreferences("project-a", "user-a", fallback, storage);
  writePreferredSeoDimensionKey(
    "project-a",
    "user-a",
    "GOOGLE|RU|1011969|ru|MOBILE",
    storage
  );
  assert.equal(
    readPreferredSeoDimensionKey("project-a", "user-a", storage),
    "GOOGLE|RU|1011969|ru|MOBILE"
  );
  assert.equal(
    readRankingsPreferences("project-a", "user-a", fallback, storage).dateFrom,
    fallback.dateFrom
  );
});

test("project city chooses a desktop exact slice when no saved slice exists", () => {
  const dimensions = [
    { key: "GOOGLE|RU|1011969|ru|MOBILE", searchEngine: "GOOGLE", countryCode: "RU", regionCode: "1011969", language: "ru", device: "MOBILE" },
    { key: "YANDEX|RU|213|ru|DESKTOP", searchEngine: "YANDEX", countryCode: "RU", regionCode: "213", language: "ru", device: "DESKTOP" }
  ] as const;
  assert.equal(
    preferredProjectRankDimensionKey(dimensions, "", {
      name: "Москва",
      yandexRegionCode: "213",
      googleRegionCode: "1011969"
    }),
    "YANDEX|RU|213|ru|DESKTOP"
  );
  assert.equal(
    preferredProjectRankDimensionKey(dimensions, dimensions[0].key),
    dimensions[0].key
  );
});
