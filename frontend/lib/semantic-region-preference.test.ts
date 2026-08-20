import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSemanticRegion,
  defaultSemanticSearchRegions,
  readLastSemanticRegion,
  readLastSemanticSearchRegions,
  writeLastSemanticRegion
} from "./semantic-region-preference.ts";

test("uses Russia for frequency and Moscow for both rank engines", () => {
  assert.deepEqual(defaultSemanticRegion("WORDSTAT"), {
    code: "225",
    label: "Россия"
  });
  assert.deepEqual(defaultSemanticSearchRegions(), {
    YANDEX: { code: "213", label: "Москва" },
    GOOGLE: { code: "1011969", label: "Москва" }
  });
});

test("stores the last successful region per project, tool and engine", () => {
  const storage = memoryStorage();
  writeLastSemanticRegion(
    storage,
    "project-a",
    "CLUSTERING",
    "YANDEX_RANK",
    "2"
  );
  writeLastSemanticRegion(
    storage,
    "project-a",
    "CLUSTERING",
    "GOOGLE_RANK",
    "1012040"
  );
  writeLastSemanticRegion(
    storage,
    "project-a",
    "AI_ANSWERS",
    "YANDEX_RANK",
    "213"
  );

  assert.deepEqual(
    readLastSemanticSearchRegions(storage, "project-a", "CLUSTERING"),
    {
      YANDEX: { code: "2", label: "Санкт-Петербург" },
      GOOGLE: { code: "1012040", label: "Санкт-Петербург" }
    }
  );
  assert.equal(
    readLastSemanticRegion(
      storage,
      "project-a",
      "AI_ANSWERS",
      "YANDEX_RANK"
    ).code,
    "213"
  );
  assert.equal(
    readLastSemanticRegion(
      storage,
      "project-b",
      "CLUSTERING",
      "YANDEX_RANK"
    ).code,
    "213"
  );
});

test("keeps the explicit Wordstat all-regions option", () => {
  const storage = memoryStorage();
  writeLastSemanticRegion(
    storage,
    "project-a",
    "FREQUENCY",
    "WORDSTAT",
    "ALL"
  );

  assert.deepEqual(
    readLastSemanticRegion(
      storage,
      "project-a",
      "FREQUENCY",
      "WORDSTAT"
    ),
    { code: "ALL", label: "Без ограничения" }
  );
});

test("drops an unavailable stored code and falls back safely", () => {
  const storage = memoryStorage();
  storage.setItem(
    "seo:last-semantic-region:POSITIONS:project-a:YANDEX_RANK",
    "999999999"
  );

  assert.deepEqual(
    readLastSemanticRegion(
      storage,
      "project-a",
      "POSITIONS",
      "YANDEX_RANK"
    ),
    { code: "213", label: "Москва" }
  );
  assert.equal(
    storage.getItem(
      "seo:last-semantic-region:POSITIONS:project-a:YANDEX_RANK"
    ),
    null
  );
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
}
