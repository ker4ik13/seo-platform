import assert from "node:assert/strict";
import test from "node:test";
import type { RankOperationResultRow } from "@seo-platform/contracts";
import {
  rankFailureReason,
  rankPollAttempts
} from "./rank-result-presentation.ts";

test("explains a maxed XMLStock keyword without treating it as not found", () => {
  const row = failedRow({
    pollAttempts: 50,
    errorCode: "PROVIDER_UNAVAILABLE"
  });

  assert.equal(
    rankFailureReason(row, "XMLSTOCK"),
    "XMLStock оставался недоступен до исчерпания попыток"
  );
  assert.equal(rankPollAttempts(row), "50 попыток");
});

test("formats attempts and provides a safe fallback reason", () => {
  assert.equal(rankPollAttempts(failedRow({ pollAttempts: 1 })), "1 попытка");
  assert.equal(rankPollAttempts(failedRow({ pollAttempts: 22 })), "22 попытки");
  assert.equal(rankPollAttempts(failedRow({ pollAttempts: 11 })), "11 попыток");
  assert.equal(
    rankFailureReason(failedRow({ pollAttempts: 50 }), "XMLSTOCK"),
    "Результат не получен за 50 попыток"
  );
  assert.equal(
    rankFailureReason(
      failedRow({ errorCode: "INVALID_CREDENTIAL" }),
      "ARSENKIN"
    ),
    "Arsenkin отклонил API-ключ"
  );
});

function failedRow(
  overrides: Partial<RankOperationResultRow>
): RankOperationResultRow {
  return {
    sequence: 0,
    keywordId: "01900000-0000-7000-8000-000000000001",
    keyword: "неснятый запрос",
    state: "PENDING",
    dataQualityFlags: [],
    ...overrides
  };
}
