import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("competitor estimates count TOP-10 without weakening position estimates", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260902194500_competitor_rank_estimate_counts/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    sql,
    /execution_snapshot ->> 'purpose' = 'COMPETITOR_SERP'[\s\S]*THEN 10/u
  );
  assert.match(sql, /'xmlstock-yandex-live@2'/u);
  assert.match(sql, /'xmlstock-yandex-live@3'/u);
  assert.match(sql, /'xmlstock-google-live@2'/u);
  assert.match(sql, /ELSE \(execution_snapshot ->> 'depth'\)::integer/u);
  assert.match(sql, /VALIDATE CONSTRAINT rank_estimates_counts_bounded/u);
  assert.doesNotMatch(
    sql,
    /\b(?:UPDATE\s+|DELETE FROM|TRUNCATE|DROP TABLE)\b/u
  );
});
