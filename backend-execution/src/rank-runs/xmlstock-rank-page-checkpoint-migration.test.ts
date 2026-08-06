import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260806130000_xmlstock_rank_page_checkpoints/migration.sql",
  import.meta.url
);

test("persists XMLStock Live pages and fences duplicate continuation jobs", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /ADD COLUMN provider_progress_snapshot JSONB/u);
  assert.match(sql, /ADD COLUMN provider_progress_hash BYTEA/u);
  assert.match(sql, /p_outcome = 'CHECKPOINTED'/u);
  assert.match(sql, /execution\.provider_progress_snapshot/u);
  assert.match(sql, /poll_attempt_count < 720/u);
  assert.match(
    sql,
    /p_outcome = 'CHECKPOINTED'[\s\S]*poll_attempt_count >= 720[\s\S]*'FAILED_FINAL'/u
  );
  assert.match(sql, /rank_jobs_single_manual_rank_retry_child_key/u);
  assert.match(sql, /WHERE type = 'MANUAL_RANK_CHECK'/u);
  assert.match(
    sql,
    /complete_rank_connector_poll\([\s\S]*JSONB, BYTEA\s*\) FROM PUBLIC/u
  );
});
