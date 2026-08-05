import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("semantic import confirmation persists one complete entitlement snapshot", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260731070000_semantic_capacity_entitlements/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /"billing_plan_code" VARCHAR\(64\)/u);
  assert.match(sql, /"stored_keywords_limit" BIGINT/u);
  assert.match(sql, /"keywords_per_project_limit" BIGINT/u);
  assert.match(sql, /"tracked_context_pairs_limit" BIGINT/u);
  assert.match(
    sql,
    /"semantic_imports_entitlement_completeness_check"[\s\S]*"billing_plan_code" IS NULL[\s\S]*"tracked_context_pairs_limit" > 0/u
  );
});
