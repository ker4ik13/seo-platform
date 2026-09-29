import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../prisma/migrations/20260929130000_rank_submit_candidate_prefetch/migration.sql", import.meta.url),
  "utf8"
);

test("candidate discovery is bounded and only returns IDs", () => {
  assert.match(migration, /p_limit NOT BETWEEN 1 AND 30/u);
  assert.match(migration, /RETURNS TABLE \("executionId" UUID, "jobId" UUID\)/u);
  assert.match(migration, /execution\.id <> ALL\(p_excluded\)/u);
  assert.match(migration, /execution\.authorization_expires_at >/u);
  assert.match(migration, /LIMIT p_limit/u);
});

test("targeted claim reuses the authoritative graph and fences by exact ID", () => {
  assert.match(migration, /pg_get_functiondef\(/u);
  assert.match(migration, /WHERE execution\."id" = p_execution_id AND control/u);
  assert.match(migration, /Unexpected rank submit graph before targeted claim/u);
  assert.match(migration, /Unexpected rank submit precheck before targeted claim/u);
  assert.match(migration, /claim_rank_connector_execution_pre_authorization_targeted\(/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_rank_connector_submit_targeted\(/u);
});
