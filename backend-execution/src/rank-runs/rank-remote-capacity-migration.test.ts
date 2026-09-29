import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("remote grant budget counts only healthy enabled rank slots", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260930001000_remote_rank_grant_capacity/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /CREATE FUNCTION public\.available_remote_rank_slots/u);
  assert.match(sql, /node\.enabled[\s\S]*NOT node\.draining/u);
  assert.match(sql, /node\.reported_rank_slots/u);
  assert.match(sql, /last_heartbeat_at > clock_timestamp\(\) - INTERVAL '30 seconds'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.available_remote_rank_slots/u);
  const permissions = await readFile(new URL(
    "../../../infrastructure/postgres/permissions/service-runtime.sql",
    import.meta.url
  ), "utf8");
  assert.match(permissions, /available_remote_rank_slots\(integer\)/u);
});
