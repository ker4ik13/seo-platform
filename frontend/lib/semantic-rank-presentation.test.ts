import assert from "node:assert/strict";
import test from "node:test";
import {
  primaryRankContextIds,
  rankChangePresentation,
  rankEngineLabel,
  rankHistoryProviderLabel,
  rankSearchSystemLabel
} from "./semantic-rank-presentation.ts";

test("selects one most recently updated context for each search engine", () => {
  const selected = primaryRankContextIds([
    { trackingContextId: "yandex-old", searchEngine: "YANDEX", observedAt: "2026-08-01T00:00:00.000Z" },
    { trackingContextId: "yandex-new", searchEngine: "YANDEX", observedAt: "2026-08-03T00:00:00.000Z" },
    { trackingContextId: "google", searchEngine: "GOOGLE", observedAt: "2026-08-02T00:00:00.000Z" }
  ]);

  assert.equal(selected.get("YANDEX"), "yandex-new");
  assert.equal(selected.get("GOOGLE"), "google");
});

test("breaks equal timestamps by history size and then stable context id", () => {
  const selected = primaryRankContextIds([
    { trackingContextId: "b", searchEngine: "YANDEX", observedAt: "2026-08-03T00:00:00.000Z" },
    { trackingContextId: "a", searchEngine: "YANDEX", observedAt: "2026-08-03T00:00:00.000Z" },
    { trackingContextId: "a", searchEngine: "YANDEX", observedAt: "2026-08-02T00:00:00.000Z" }
  ]);

  assert.equal(selected.get("YANDEX"), "a");
});

test("uses compact engine labels for the two inspector rows", () => {
  assert.equal(rankEngineLabel("YANDEX"), "Яндекс");
  assert.equal(rankEngineLabel("GOOGLE"), "Google");
});

test("presents rank movement as a compact accessible delta", () => {
  assert.deepEqual(rankChangePresentation(1, 2), {
    ariaLabel: "Текущая позиция 1. Рост на 1. Было 2",
    label: "▲1",
    title: "Было 2 · рост на 1",
    tone: "improved"
  });
  assert.equal(rankChangePresentation(8, 6).label, "▼2");
  assert.equal(rankChangePresentation(3, 3).label, "—");
  assert.equal(rankChangePresentation(5, undefined).label, "Новая");
});

test("names the exact search result source when history contains it", () => {
  assert.equal(rankSearchSystemLabel("YANDEX", "SEARCH_API"), "Яндекс XML");
  assert.equal(rankSearchSystemLabel("YANDEX", "LIVE"), "Яндекс Live");
  assert.equal(rankSearchSystemLabel("GOOGLE", "LIVE"), "Google Live");
});

test("labels imported Key Collector history without treating it as a live provider", () => {
  assert.equal(rankHistoryProviderLabel("KEY_COLLECTOR"), "Key Collector · импорт");
  assert.equal(rankHistoryProviderLabel("XMLSTOCK"), "XMLStock");
});
