import assert from "node:assert/strict";
import test from "node:test";
import {
  hasSemanticAiAnswerSnapshot,
  latestSemanticRankHistory,
  normalizeSemanticTargetUrlInput,
  primaryRankContextIds,
  rankChangePresentation,
  rankEngineLabel,
  rankHistoryProviderLabel,
  rankSearchSystemLabel,
  sameSemanticRankingUrl,
  semanticDisplayUrl,
  semanticRankingUrlMatch,
  semanticSiteFaviconSources,
  semanticUrlBelongsToProject,
  semanticRankHistoryByEngine,
  semanticRankHistoryDateRows
} from "./semantic-rank-presentation.ts";

test("puts Yandex and Google positions from the same city and device in one date row", () => {
  const point = (
    snapshotId: string,
    searchEngine: "YANDEX" | "GOOGLE",
    regionCode: string,
    observedAt: string,
    position: number,
    device: "DESKTOP" | "MOBILE" = "DESKTOP"
  ) => ({
    snapshotId,
    trackingContextId: `context-${snapshotId}`,
    contextName: "Москва",
    searchEngine,
    regionCode,
    countryCode: "RU",
    language: "ru",
    device,
    provider: "XMLSTOCK" as const,
    found: true,
    position,
    observedAt
  });
  const selected = "YANDEX|RU|213|ru|DESKTOP";
  const rows = semanticRankHistoryDateRows([
    point("yandex-old", "YANDEX", "213", "2026-10-06T08:00:00.000Z", 10),
    point("google", "GOOGLE", "1011969", "2026-10-06T11:00:00.000Z", 2),
    point("yandex-new", "YANDEX", "213", "2026-10-06T18:00:00.000Z", 4),
    point("other-city", "GOOGLE", "1012040", "2026-10-06T12:00:00.000Z", 6),
    point("other-device", "GOOGLE", "1011969", "2026-10-06T12:00:00.000Z", 7, "MOBILE"),
    point("previous-day", "GOOGLE", "1011969", "2026-10-05T12:00:00.000Z", 3)
  ], selected);

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.positions.get("YANDEX")?.snapshotId, "yandex-new");
  assert.equal(rows[0]?.positions.get("GOOGLE")?.snapshotId, "google");
  assert.equal(rows[1]?.positions.get("GOOGLE")?.snapshotId, "previous-day");
  assert.equal(rows[1]?.positions.has("YANDEX"), false);
  assert.equal(semanticRankHistoryDateRows([], selected).length, 0);
  assert.equal(semanticRankHistoryDateRows([], "bad-key").length, 0);
});

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
  assert.equal(rankSearchSystemLabel("GOOGLE", "LIVE", "XMLSTOCK"), "Google XML");
});

test("labels imported Key Collector history without treating it as a live provider", () => {
  assert.equal(rankHistoryProviderLabel("KEY_COLLECTOR"), "Key Collector · импорт");
  assert.equal(rankHistoryProviderLabel("XMLSTOCK"), "XMLStock");
});

test("compares target pages and project hosts without www noise", () => {
  assert.equal(
    sameSemanticRankingUrl(
      "https://example.com/catalog/",
      "HTTPS://WWW.EXAMPLE.COM/catalog#result"
    ),
    true
  );
  assert.equal(
    sameSemanticRankingUrl(
      "https://example.com/catalog",
      "https://example.com/other"
    ),
    false
  );
  assert.equal(
    semanticUrlBelongsToProject(
      "https://shop.example.com/catalog",
      "www.example.com"
    ),
    true
  );
  assert.equal(
    semanticUrlBelongsToProject(
      "https://notexample.com/catalog",
      "example.com"
    ),
    false
  );
});

test("classifies every captured ranking URL against the assigned target", () => {
  assert.equal(
    semanticRankingUrlMatch(
      "https://example.com/catalog/",
      "https://www.example.com/catalog#result"
    ),
    "MATCH"
  );
  assert.equal(
    semanticRankingUrlMatch(
      "https://example.com/catalog",
      "https://example.com/other"
    ),
    "MISMATCH"
  );
  assert.equal(
    semanticRankingUrlMatch(undefined, "https://example.com/catalog"),
    "NO_TARGET"
  );
});

test("shows the AI result action for every persisted snapshot", () => {
  assert.equal(
    hasSemanticAiAnswerSnapshot([
      { observedAt: "2026-09-02T18:00:00.000Z" }
    ]),
    true
  );
  assert.equal(hasSemanticAiAnswerSnapshot([]), false);
  assert.equal(hasSemanticAiAnswerSnapshot(undefined), false);
});

test("normalizes target URL shorthand against the project", () => {
  assert.equal(
    normalizeSemanticTargetUrlInput(
      "/neuroluv.ru/prompts-menu/collection-chempionat-mira-po-futbol",
      "neuroluv.ru"
    ),
    "https://neuroluv.ru/prompts-menu/collection-chempionat-mira-po-futbol"
  );
  assert.equal(
    normalizeSemanticTargetUrlInput("/catalog/item", "www.example.com"),
    "https://www.example.com/catalog/item"
  );
  assert.equal(
    normalizeSemanticTargetUrlInput("example.com/catalog", "example.com"),
    "https://example.com/catalog"
  );
  assert.equal(
    normalizeSemanticTargetUrlInput(
      "https://EXAMPLE.com:443/catalog?q=1",
      "example.com"
    ),
    "https://example.com/catalog?q=1"
  );
});

test("rejects unsafe or unusable target URLs before submit", () => {
  assert.equal(
    normalizeSemanticTargetUrlInput("javascript:alert(1)", "example.com"),
    undefined
  );
  assert.equal(
    normalizeSemanticTargetUrlInput(
      "https://user:password@example.com/private",
      "example.com"
    ),
    undefined
  );
  assert.equal(
    normalizeSemanticTargetUrlInput(
      "https://example.com/catalog#private",
      "example.com"
    ),
    undefined
  );
});

test("hides only the transport protocol in displayed SERP URLs", () => {
  assert.equal(
    semanticDisplayUrl("https://www.example.com/catalog?q=1#item"),
    "www.example.com/catalog?q=1#item"
  );
  assert.equal(
    semanticDisplayUrl("http://example.com/"),
    "example.com/"
  );
  assert.equal(
    semanticDisplayUrl("https://broken url"),
    "broken url"
  );
});

test("loads a SERP favicon from the result site before provider fallback", () => {
  assert.deepEqual(
    semanticSiteFaviconSources(
      "https://www.example.com/catalog/item?q=1",
      "https://search-assets.example/example.png"
    ),
    [
      "https://www.example.com/favicon.ico",
      "https://search-assets.example/example.png"
    ]
  );
  assert.deepEqual(
    semanticSiteFaviconSources(
      "http://example.com/page",
      "data:image/png;base64,unsafe"
    ),
    ["http://example.com/favicon.ico"]
  );
});
