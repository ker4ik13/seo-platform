import assert from "node:assert/strict";
import test from "node:test";
import {
  googleRussiaSeoRegions,
  searchContextDisplayName,
  searchRegionDisplayName,
  seoRegionDisplayName,
  seoRegionOptions,
  yandexRussiaSeoRegions
} from "./seo-regions.ts";

test("keeps Russia, Moscow and Saint Petersburg first in provider region choices", () => {
  assert.deepEqual(
    yandexRussiaSeoRegions.slice(0, 3),
    [
      { code: "225", label: "Россия" },
      { code: "213", label: "Москва" },
      { code: "2", label: "Санкт-Петербург" }
    ]
  );
  assert.deepEqual(
    googleRussiaSeoRegions.slice(0, 3),
    [
      { code: "2643", label: "Россия" },
      { code: "1011969", label: "Москва" },
      { code: "1012040", label: "Санкт-Петербург" }
    ]
  );
});

test("contains every Russian region supported by the current providers", () => {
  assert.equal(yandexRussiaSeoRegions.length, 638);
  assert.equal(googleRussiaSeoRegions.length, 504);
  assert.equal(seoRegionOptions("WORDSTAT"), yandexRussiaSeoRegions);
  assert.equal(seoRegionOptions("YANDEX_RANK"), yandexRussiaSeoRegions);
  assert.equal(seoRegionOptions("GOOGLE_RANK"), googleRussiaSeoRegions);
});

test("provider region codes are unique numeric identifiers", () => {
  for (const regions of [yandexRussiaSeoRegions, googleRussiaSeoRegions]) {
    assert.equal(new Set(regions.map(({ code }) => code)).size, regions.length);
    assert.equal(regions.every(({ code }) => /^\d+$/u.test(code)), true);
  }
});

test("disambiguates localities with their Russian parent region", () => {
  assert.equal(
    yandexRussiaSeoRegions.find(({ code }) => code === "10742")?.label,
    "Ногинск · Богородский (городской округ) · Москва и область"
  );
  assert.equal(
    googleRussiaSeoRegions.find(({ code }) => code === "1011852")?.label,
    "Майкоп · Адыгея"
  );
});

test("uses canonical city names instead of legacy numeric labels", () => {
  assert.equal(searchRegionDisplayName("YANDEX", "213"), "Москва");
  assert.equal(searchRegionDisplayName("YANDEX", 213, "213"), "Москва");
  assert.equal(searchRegionDisplayName("GOOGLE", "1012040"), "Санкт-Петербург");
  assert.equal(seoRegionDisplayName("WORDSTAT", "225", "Россия [225]"), "Россия");
});

test("never exposes an unknown provider code as a region name", () => {
  assert.equal(seoRegionDisplayName("WORDSTAT", "999999999", "999999999"), "Другой регион");
  assert.equal(seoRegionDisplayName("WORDSTAT", "ALL"), "Все регионы");
});

test("repairs only a standalone numeric region segment in legacy context names", () => {
  assert.equal(
    searchContextDisplayName("Конкуренты · Яндекс · 213 · Десктоп", "YANDEX", "213"),
    "Конкуренты · Яндекс · Москва · Десктоп"
  );
  assert.equal(
    searchContextDisplayName("Профиль 213", "YANDEX", "213"),
    "Профиль 213"
  );
});
