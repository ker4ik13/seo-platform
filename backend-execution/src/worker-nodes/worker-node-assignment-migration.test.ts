import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin worker assignments are projected by a bounded secret-free function", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260930001500_remote_rank_assignment_summary/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /CREATE FUNCTION public\.list_remote_worker_rank_assignments/u);
  assert.match(sql, /p_limit NOT BETWEEN 1 AND 1000/u);
  assert.match(sql, /execution\."lease_expires_at" > clock_timestamp\(\)/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.list_remote_worker_rank_assignments/u);
  assert.doesNotMatch(sql, /keywordText|apiKey|ciphertext/u);
  const permissions = await readFile(new URL(
    "../../../infrastructure/postgres/permissions/service-runtime.sql",
    import.meta.url
  ), "utf8");
  assert.match(permissions, /list_remote_worker_rank_assignments\(integer\)/u);
});
