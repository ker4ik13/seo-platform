import assert from "node:assert/strict";
import test from "node:test";
import {
  googleRussiaRegionRows,
  resolveSeoRegionLabel,
  yandexRussiaRegionRows
} from "./seo-regions.js";

test("resolves every provider region through its canonical text catalogue", () => {
  for (const [code, label] of yandexRussiaRegionRows) {
    assert.equal(resolveSeoRegionLabel("YANDEX_RANK", code), label);
  }
  for (const [code, label] of googleRussiaRegionRows) {
    assert.equal(resolveSeoRegionLabel("GOOGLE_RANK", code), label);
  }
});

test("rejects bare numeric labels and strips a repeated provider code", () => {
  assert.equal(resolveSeoRegionLabel("YANDEX_RANK", "213", "213"), "Москва");
  assert.equal(resolveSeoRegionLabel("WORDSTAT", "777777", "Казань [777777]"), "Казань");
  assert.equal(resolveSeoRegionLabel("WORDSTAT", "777777", "777777"), undefined);
});
