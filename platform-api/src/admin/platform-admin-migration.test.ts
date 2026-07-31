import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform roles are append-only and NPD replacements retain lineage", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260731050000_platform_admin_npd_operations/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "platform_staff_role_assignments_active_user_role_key"/u
  );
  assert.match(
    sql,
    /platform staff role assignments are append-only/u
  );
  assert.match(
    sql,
    /BEFORE TRUNCATE ON "platform_staff_role_assignments"/u
  );
  assert.match(
    sql,
    /"npd_receipt_obligations_payment_sequence_key"/u
  );
  assert.match(
    sql,
    /"npd_receipt_obligations_cancellation_check"/u
  );
  assert.match(sql, /COMMIT;\s*$/u);
});
