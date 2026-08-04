import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260802140000_tracking_context_keyword_bulk_replace/migration.sql",
  import.meta.url
);

test("bulk keyword replacement receipt is tenant-bound and replay-safe", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /CREATE TABLE "tracking_context_keyword_replace_receipts"/u
  );
  assert.match(
    sql,
    /PRIMARY KEY \("workspace_id", "project_id", "actor_id", "idempotency_key"\)/u
  );
  assert.match(sql, /"request_hash" bytea NOT NULL/u);
  assert.match(sql, /"response_snapshot" jsonb NOT NULL/u);
  assert.match(
    sql,
    /FOREIGN KEY \("workspace_id", "project_id", "context_id"\)[\s\S]*REFERENCES "tracking_contexts" \("workspace_id", "project_id", "id"\)[\s\S]*ON DELETE RESTRICT ON UPDATE CASCADE/u
  );
  assert.match(
    sql,
    /CREATE INDEX "tracking_context_keyword_replace_receipts_context_idx"[\s\S]*\("workspace_id", "project_id", "context_id"\)/u
  );
});
