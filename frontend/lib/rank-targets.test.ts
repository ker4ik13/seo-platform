import assert from "node:assert/strict";
import test from "node:test";
import { rankTargetDraft, rankTargetGroups, uniqueRankTargets, withRankContextName } from "./rank-targets.ts";
import { defaultTrackingContextSettingsDraft } from "./tracking-contexts.ts";

test("rank targets preserve both devices per city and reject invalid targets", () => {
  const targets = uniqueRankTargets([
    { regionCode: "213", regionLabel: "Москва", device: "DESKTOP" },
    { regionCode: "213", regionLabel: "Москва", device: "MOBILE" },
    { regionCode: "213", regionLabel: "дубликат", device: "DESKTOP" }
  ]);
  assert.equal(targets.length, 2);
  assert.deepEqual(rankTargetGroups(targets), [{ regionCode: "213", regionLabel: "Москва", devices: ["DESKTOP", "MOBILE"] }]);
  assert.match(rankTargetDraft(defaultTrackingContextSettingsDraft(), targets[1]!, true).name, /Конкуренты.+Москва.+Мобильное/u);
  assert.equal(rankTargetDraft(defaultTrackingContextSettingsDraft(), targets[1]!, false, "en").name, "Moscow · Mobile · Top 50");
  assert.throws(() => uniqueRankTargets([]));
});

test("automatic context name follows depth while a custom or saved name stays unchanged", () => {
  const current = defaultTrackingContextSettingsDraft();
  const next = { ...current, depth: 30 as const, regionCode: "2", regionLabel: "Санкт-Петербург" };
  assert.equal(withRankContextName(current, next, false, false).name, "Санкт-Петербург · Десктоп · Топ-30");
  assert.equal(withRankContextName({ ...current, name: "Мой профиль" }, next, true, false).name, "Мой профиль");
});
