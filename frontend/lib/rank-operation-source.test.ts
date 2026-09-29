import assert from "node:assert/strict";
import test from "node:test";
import { hasRankRouting, rankRoutingLines, rankSourceLabel } from "./rank-operation-source.ts";

test("rank source presentation shows an exact masked connection and fallback counts", () => {
  const sources = [
    { provider: "XMLSTOCK" as const, label: "Личный",
      displayHint: "••••b313", requestCount: "4", selected: true },
    { provider: "XMLSTOCK" as const, label: "Резерв",
      displayHint: "••••349d", requestCount: "2", selected: false }
  ];
  const attempts = [
    { sequence: 1, provider: "XMLSTOCK" as const,
      routingScope: "WORKSPACE_DEFAULT" as const,
      outcome: "FALLBACK" as const, reasonCode: "RATE_LIMITED",
      occurredAt: "2026-09-29T18:00:00.000Z" },
    { sequence: 2, provider: "XMLSTOCK" as const,
      routingScope: "WORKSPACE_FALLBACK" as const,
      outcome: "SUCCEEDED" as const,
      occurredAt: "2026-09-29T18:01:00.000Z" }
  ];
  assert.equal(rankSourceLabel(sources, "ru-RU"), "Личный · ••••b313");
  assert.equal(hasRankRouting(attempts, sources), true);
  const lines = rankRoutingLines(attempts, sources, "ru-RU");
  assert.match(lines.attemptLines[0] ?? "", /лимит запросов/u);
  assert.match(lines.sourceLines[0] ?? "", /Личный.*4 запросов/u);
  assert.match(lines.sourceLines[1] ?? "", /Резерв.*2 запросов/u);
  assert.equal(rankSourceLabel(undefined, "ru-RU"), "Источник временно недоступен");
});
