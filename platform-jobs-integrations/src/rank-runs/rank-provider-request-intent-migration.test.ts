import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260730120000_rank_provider_request_intents/migration.sql",
  import.meta.url
);

const migration = readFile(MIGRATION, "utf8");

function compactSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

test("creates one bounded exact provider request intent per tenant JobItem", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);

  assert.match(sql, /^BEGIN;\s/u);
  assert.match(sql, /\sCOMMIT;\s*$/u);
  assert.ok(
    normalized.includes(
      `CREATE TABLE public.rank_provider_request_intents (`
    )
  );
  for (const field of [
    `"id" UUID NOT NULL DEFAULT uuidv7()`,
    `"workspace_id" UUID NOT NULL`,
    `"project_id" UUID NOT NULL`,
    `"job_id" UUID NOT NULL`,
    `"job_item_id" UUID NOT NULL`,
    `"manifest_id" UUID NOT NULL`,
    `"manifest_hash" BYTEA NOT NULL`,
    `"manifest_chunk_index" INTEGER NOT NULL`,
    `"manifest_chunk_hash" BYTEA NOT NULL`,
    `"schema_version" VARCHAR(64) NOT NULL`,
    `"request_snapshot" JSONB NOT NULL`,
    `"request_hash" BYTEA NOT NULL`,
    `"created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP`
  ]) {
    assert.ok(normalized.includes(field), `Missing intent field: ${field}`);
  }

  for (const invariant of [
    `octet_length("manifest_hash") = 32`,
    `"manifest_chunk_index" BETWEEN 0 AND 3`,
    `octet_length("manifest_chunk_hash") = 32`,
    `"schema_version" = 'rank-provider-request-intent@1'`,
    `jsonb_typeof("request_snapshot") = 'object'`,
    `octet_length("request_snapshot"::text) <= 1048576`,
    `octet_length("request_hash") = 32`
  ]) {
    assert.ok(normalized.includes(invariant), `Missing ${invariant}`);
  }

  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "rank_provider_request_intents_tenant_job_item_key" ON public.rank_provider_request_intents ( "workspace_id", "project_id", "job_id", "job_item_id" );`
    )
  );
});

test("binds intent and execution through exact tenant and hash evidence", async () => {
  const normalized = compactSql(await migration);

  for (const constraint of [
    `"rank_provider_request_intents_job_tenant_fkey"`,
    `"rank_provider_request_intents_rank_run_tenant_fkey"`,
    `"rank_provider_request_intents_job_item_tenant_fkey"`,
    `"rank_connector_executions_provider_request_intent_fkey"`
  ]) {
    assert.ok(
      normalized.includes(`CONSTRAINT ${constraint}`),
      `Missing tenant constraint ${constraint}`
    );
  }

  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "rank_provider_request_intents_execution_key" ON public.rank_provider_request_intents ( "workspace_id", "project_id", "job_id", "job_item_id", "id", "request_hash", "manifest_id", "manifest_hash", "manifest_chunk_index", "manifest_chunk_hash" );`
    )
  );
  for (const field of [
    `ADD COLUMN "provider_request_intent_id" UUID NOT NULL`,
    `ADD COLUMN "provider_request_intent_hash" BYTEA NOT NULL`,
    `ADD COLUMN "provider_request_intent_chunk_hash" BYTEA NOT NULL`
  ]) {
    assert.ok(normalized.includes(field), `Missing execution field ${field}`);
  }
  assert.ok(
    normalized.includes(
      `FOREIGN KEY ( "workspace_id", "project_id", "job_id", "job_item_id", "provider_request_intent_id", "provider_request_intent_hash", "manifest_id", "manifest_hash", "manifest_chunk_index", "provider_request_intent_chunk_hash" ) REFERENCES public.rank_provider_request_intents ( "workspace_id", "project_id", "job_id", "job_item_id", "id", "request_hash", "manifest_id", "manifest_hash", "manifest_chunk_index", "manifest_chunk_hash" )`
    )
  );
});

test("fails closed before adding the required execution contract", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);
  const lock = normalized.indexOf(
    `LOCK TABLE public.rank_connector_executions IN ACCESS EXCLUSIVE MODE;`
  );
  const precondition = normalized.indexOf(
    `IF EXISTS ( SELECT 1 FROM public.rank_connector_executions )`
  );
  const notNullContract = normalized.indexOf(
    `ADD COLUMN "provider_request_intent_id" UUID NOT NULL`
  );

  assert.ok(lock >= 0, "Missing concurrent-writer lock");
  assert.ok(precondition > lock, "Precondition must run under the lock");
  assert.ok(
    notNullContract > precondition,
    "Required execution columns must follow the empty-table precondition"
  );
  assert.ok(
    normalized.includes(
      `rank provider request intent migration requires empty pre-release rank_connector_executions; use an explicit expand/backfill/validate/contract migration`
    )
  );
});

test("keeps request intents and execution evidence immutable and private", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);

  assert.match(
    normalized,
    /CREATE TRIGGER "rank_provider_request_intent_no_mutation" BEFORE UPDATE OR DELETE ON public\.rank_provider_request_intents/u
  );
  assert.match(
    normalized,
    /CREATE TRIGGER "rank_provider_request_intent_no_truncate" BEFORE TRUNCATE ON public\.rank_provider_request_intents/u
  );
  assert.match(
    normalized,
    /CREATE TRIGGER "rank_connector_execution_provider_intent_guard" BEFORE UPDATE ON public\.rank_connector_executions/u
  );
  for (const field of [
    `NEW."provider_request_intent_id"`,
    `NEW."provider_request_intent_hash"`,
    `NEW."provider_request_intent_chunk_hash"`
  ]) {
    assert.ok(normalized.includes(field), `Missing immutable field ${field}`);
  }
  assert.ok(
    normalized.includes(
      `REVOKE ALL ON TABLE public.rank_provider_request_intents FROM PUBLIC;`
    )
  );
  assert.ok(
    normalized.includes(
      `REVOKE ALL PRIVILEGES ON TABLE public.rank_provider_request_intents FROM jobs_runtime`
    )
  );
  assert.ok(
    normalized.includes(
      `GRANT SELECT, INSERT ON TABLE public.rank_provider_request_intents TO jobs_rank_runtime`
    )
  );
  const rankRevoke = normalized.indexOf(
    `REVOKE ALL PRIVILEGES ON TABLE public.rank_provider_request_intents FROM jobs_rank_runtime`
  );
  const rankGrant = normalized.indexOf(
    `GRANT SELECT, INSERT ON TABLE public.rank_provider_request_intents TO jobs_rank_runtime`
  );
  assert.ok(
    rankRevoke >= 0 && rankGrant > rankRevoke,
    "Rank runtime ACL must be normalized before the exact grant"
  );
  assert.ok(
    normalized.includes(
      `Privacy-sensitive exact provider request; never expose through public DTO, queue, log, trace, or event.`
    )
  );
});
