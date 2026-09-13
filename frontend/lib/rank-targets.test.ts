import assert from "node:assert/strict";
import test from "node:test";
import { rankTargetDraft, rankTargetGroups, uniqueRankTargets } from "./rank-targets.ts";
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
  assert.equal(rankTargetDraft(defaultTrackingContextSettingsDraft(), targets[1]!, false, "en").name, "Moscow · Mobile");
  assert.throws(() => uniqueRankTargets([]));
});
