import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260829103000_provider_spend_budget_indexes/migration.sql",
  import.meta.url
);

test("provider hard-budget reads have provider/status/window indexes", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /CREATE INDEX "billing_usage_provider_captured_budget_idx"[\s\S]*"provider", "status", "captured_at"/u
  );
  assert.match(
    migration,
    /CREATE INDEX "billing_usage_provider_reserved_budget_idx"[\s\S]*"provider", "status", "expires_at"/u
  );
});
