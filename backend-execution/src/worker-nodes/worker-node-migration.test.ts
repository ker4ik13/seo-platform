import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("worker registry stores only a hash and bounded reported capacity", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260929235000_execution_worker_nodes/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /CREATE TABLE public\.execution_worker_nodes/u);
  assert.match(sql, /token_hash BYTEA NOT NULL UNIQUE/u);
  assert.match(sql, /octet_length\(token_hash\) = 32/u);
  assert.match(sql, /max_http_slots BETWEEN 1 AND 512/u);
  assert.match(sql, /'INSPECTION'/u);
  assert.doesNotMatch(sql, /api_key|plaintext_token/u);
});
