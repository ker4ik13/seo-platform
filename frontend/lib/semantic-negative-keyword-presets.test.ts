import assert from "node:assert/strict";
import test from "node:test";
import { semanticNegativeKeywordWordLimit } from "@seo-platform/contracts";
import { russianCityNames } from "./russian-city-names.generated.ts";
import { builtInNegativeKeywordPresets } from "./semantic-negative-keyword-presets.ts";

test("built-in negative keyword presets stay within the server limit", () => {
  assert.equal(
    new Set(builtInNegativeKeywordPresets.map(({ id }) => id)).size,
    builtInNegativeKeywordPresets.length
  );
  for (const preset of builtInNegativeKeywordPresets) {
    assert.ok(preset.rules.words.length > 0, preset.name);
    assert.ok(
      preset.rules.words.length <= semanticNegativeKeywordWordLimit,
      preset.name
    );
    const normalized = preset.rules.words.map((word) =>
      word.normalize("NFKC").toLocaleLowerCase("ru-RU")
    );
    assert.equal(new Set(normalized).size, normalized.length, preset.name);
  }
});

test("the Russian cities preset contains every unique city in one list", () => {
  const cityWords = builtInNegativeKeywordPresets.find(
    ({ id }) => id === "builtin:russian-cities"
  )?.rules.words;

  assert.equal(cityWords?.length, russianCityNames.length);
  assert.deepEqual(
    [...(cityWords ?? [])].sort((left, right) => left.localeCompare(right, "ru-RU")),
    [...russianCityNames].sort((left, right) => left.localeCompare(right, "ru-RU"))
  );
});

test("standard presets include regions and narrow optional intent lists", () => {
  const regions = builtInNegativeKeywordPresets.find(
    ({ id }) => id === "builtin:russian-regions"
  );
  assert.equal(regions?.rules.words.length, 85);
  assert.ok(regions?.rules.words.includes("Московская область"));
  assert.ok(regions?.rules.words.includes("Республика Татарстан"));
  assert.ok(builtInNegativeKeywordPresets.some(({ id }) => id === "builtin:jobs"));
  assert.ok(builtInNegativeKeywordPresets.some(({ id }) => id === "builtin:free-downloads"));
});

test("the combined Russian geo preset contains all cities and regions without duplicates", () => {
  const cities = builtInNegativeKeywordPresets.find(
    ({ id }) => id === "builtin:russian-cities"
  );
  const regions = builtInNegativeKeywordPresets.find(
    ({ id }) => id === "builtin:russian-regions"
  );
  const combined = builtInNegativeKeywordPresets.find(
    ({ id }) => id === "builtin:russian-cities-regions"
  );
  const expected = new Set(
    [...(cities?.rules.words ?? []), ...(regions?.rules.words ?? [])].map((word) =>
      word.normalize("NFKC").toLocaleLowerCase("ru-RU")
    )
  );

  assert.equal(combined?.rules.words.length, expected.size);
  assert.deepEqual(
    new Set((combined?.rules.words ?? []).map((word) =>
      word.normalize("NFKC").toLocaleLowerCase("ru-RU")
    )),
    expected
  );
});
