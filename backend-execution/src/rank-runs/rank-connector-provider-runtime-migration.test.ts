import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const enumMigration = readFile(
  new URL(
    "../../prisma/migrations/20260730123000_rank_connector_result_enum/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const runtimeMigration = readFile(
  new URL(
    "../../prisma/migrations/20260730123100_rank_connector_provider_runtime/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const permissions = readFile(
  new URL(
    "../../../infrastructure/postgres/permissions/jobs-connector.sql",
    import.meta.url
  ),
  "utf8"
);

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

test("expands provider result states before the transactional runtime migration", async () => {
  const sql = await enumMigration;
  for (const state of [
    "SUBMIT_OUTCOME_UNKNOWN",
    "POLL_WAIT",
    "FETCHING",
    "STAGED",
    "PERSISTING",
    "PERSISTED",
    "FAILED_RETRYABLE",
    "FAILED_FINAL"
  ]) {
    assert.ok(
      sql.includes(`ADD VALUE IF NOT EXISTS '${state}'`),
      `Missing ${state}`
    );
  }
  assert.doesNotMatch(sql, /\bBEGIN\b/u);
});

test("persists submit, poll and normalized staging without raw provider bytes", async () => {
  const sql = await runtimeMigration;
  const normalized = compact(sql);
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /\sCOMMIT;\s*$/u);
  for (const column of [
    "provider_task_id",
    "provider_wire_request_snapshot",
    "provider_wire_request_hash",
    "provider_submitted_at",
    "poll_attempt_count",
    "next_action_at",
    "observed_at",
    "normalized_result_snapshot",
    "normalized_result_hash",
    "last_error_code",
    "finished_at"
  ]) {
    assert.ok(normalized.includes(`"${column}"`), `Missing ${column}`);
  }
  assert.doesNotMatch(
    sql,
    /raw_provider|raw_response|response_body|provider_response_snapshot/iu
  );
  assert.ok(
    normalized.includes(
      `"poll_attempt_count" BETWEEN 0 AND 180`
    )
  );
});

test("uses lease-fenced default-closed broker boundaries and provider limits", async () => {
  const sql = compact(await runtimeMigration);
  for (const routine of [
    "read_rank_connector_submit_request",
    "claim_rank_connector_submit_bounded",
    "complete_rank_connector_submit",
    "claim_rank_connector_poll",
    "complete_rank_connector_poll"
  ]) {
    assert.ok(sql.includes(`public.${routine}(`), `Missing ${routine}`);
    assert.ok(
      sql.includes(`REVOKE ALL ON FUNCTION public.${routine}(`),
      `Missing PUBLIC revoke for ${routine}`
    );
  }
  assert.ok(sql.includes("SECURITY DEFINER"));
  assert.ok(sql.includes("SET search_path = pg_catalog, pg_temp"));
  assert.ok(
    sql.includes(
      `pg_try_advisory_xact_lock( hashtextextended('seo-platform:arsenkin-rank-submit', 0) )`
    )
  );
  assert.ok(
    sql.includes(
      `WHERE execution."status" IN ( 'CLAIMED', 'SUBMITTING', 'POLL_WAIT', 'FETCHING' ) ) >= 5`
    )
  );
  assert.ok(sql.includes(`"poll_attempt_count" >= 180`));
});

test("connector role can execute only the new broker functions, not direct table DML", async () => {
  const sql = compact(await permissions);
  for (const routine of [
    "claim_rank_connector_submit_bounded(TEXT, INTEGER, TEXT)",
    "read_rank_connector_submit_request( UUID, UUID, TEXT, UUID, INTEGER, INTEGER )",
    "complete_rank_connector_submit( UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT, JSONB, BYTEA, TEXT )",
    "claim_rank_connector_poll(TEXT, INTEGER, TEXT)",
    "complete_rank_connector_poll( UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER, TIMESTAMPTZ, JSONB, BYTEA, TEXT )"
  ]) {
    assert.ok(sql.includes(routine), `Missing connector ACL ${routine}`);
  }
  assert.ok(
    sql.includes(
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public`
    )
  );
  assert.ok(
    !sql.includes(
      `'public.claim_rank_connector_execution(text,integer,text)'::regprocedure::oid`
    )
  );
});
