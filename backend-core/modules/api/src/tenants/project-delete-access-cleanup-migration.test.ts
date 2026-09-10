import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260910110000_project_delete_access_cleanup/migration.sql",
  import.meta.url
);

test("deleted projects retain data without retaining live authorization edges", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const normalized = sql.replace(/\s+/gu, " ").trim();

  assert.match(
    normalized,
    /DELETE FROM public\.project_member_access access USING public\.projects project WHERE access\.project_id = project\.id/u
  );
  assert.match(
    normalized,
    /DELETE FROM public\.api_token_project_accesses access USING public\.projects project WHERE access\.project_id = project\.id AND access\.workspace_id = project\.workspace_id/u
  );
  assert.match(
    normalized,
    /project\.status = 'DELETED' OR project\.deleted_at IS NOT NULL/u
  );
  assert.match(
    normalized,
    /UPDATE public\.workspace_invites AS invite SET project_accesses = .*jsonb_array_elements\(invite\.project_accesses\).*invite\.status IN \('SENT', 'DELIVERED'\)/u
  );
});
