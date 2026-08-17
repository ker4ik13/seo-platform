import assert from "node:assert/strict";
import test from "node:test";
import {
  latestSemanticRankHistory,
  primaryRankContextIds,
  rankChangePresentation,
  rankEngineLabel,
  rankHistoryProviderLabel,
  rankSearchSystemLabel,
  semanticRankHistoryByEngine
} from "./semantic-rank-presentation.ts";

test("keeps the latest 14 keyword snapshots across every technical context", () => {
  const points = Array.from({ length: 17 }, (_, index) => ({
    snapshotId: `snapshot-${String(index).padStart(2, "0")}`,
    trackingContextId: `context-${index % 4}`,
    searchEngine: "YANDEX" as const,
    observedAt: new Date(Date.UTC(2026, 7, index + 1)).toISOString()
  }));

  const result = latestSemanticRankHistory(points);

  assert.equal(result.length, 14);
  assert.equal(result[0]?.snapshotId, "snapshot-16");
  assert.equal(result.at(-1)?.snapshotId, "snapshot-03");
  assert.deepEqual(
    new Set(result.map(({ trackingContextId }) => trackingContextId)),
    new Set(["context-0", "context-1", "context-2", "context-3"])
  );
});

test("builds one engine history from snapshots of every technical context", () => {
  const result = semanticRankHistoryByEngine([
    {
      snapshotId: "new",
      trackingContextId: "context-new",
      searchEngine: "YANDEX",
      observedAt: "2026-08-17T10:00:00.000Z"
    },
    {
      snapshotId: "old",
      trackingContextId: "context-old",
      searchEngine: "YANDEX",
      observedAt: "2026-08-10T10:00:00.000Z"
    }
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(
    result[0]?.points.map(({ snapshotId }) => snapshotId),
    ["old", "new"]
  );
});

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
