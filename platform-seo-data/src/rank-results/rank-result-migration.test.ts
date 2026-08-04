import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260729220000_rank_result_persistence/migration.sql",
  import.meta.url
);
const connectorVersionMigrationUrl = new URL(
  "../../prisma/migrations/20260801202000_rank_connector_version_pattern/migration.sql",
  import.meta.url
);
const providerRequestMigrationUrl = new URL(
  "../../prisma/migrations/20260801203000_rank_provider_request_id_pattern/migration.sql",
  import.meta.url
);
const foundQualificationMigrationUrl = new URL(
  "../../prisma/migrations/20260801204000_rank_receipt_found_qualification/migration.sql",
  import.meta.url
);

test("rank result migration is transactional and fails closed on legacy rows", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  assert.match(
    sql,
    /LOCK TABLE "rank_snapshots", "current_ranks"\s+IN ACCESS EXCLUSIVE MODE/u
  );
  assert.match(
    sql,
    /IF EXISTS \(SELECT 1 FROM "rank_snapshots"\)[\s\S]*OR EXISTS \(SELECT 1 FROM "current_ranks"\)[\s\S]*requires empty pre-release rank tables/u
  );
  assert.match(sql, /CREATE TABLE "rank_chunk_ingest_receipts"/u);
  assert.match(sql, /CREATE TABLE "rank_snapshots"/u);
  assert.match(sql, /CREATE TABLE "current_ranks"/u);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/u);
  assert.doesNotMatch(sql, /ON UPDATE CASCADE/u);
});

test("rank result migration enforces tenant provenance and immutable receipts", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  for (const constraint of [
    "rank_chunk_ingest_receipts_manifest_tenant_fkey",
    "rank_chunk_ingest_receipts_chunk_tenant_fkey",
    "rank_snapshots_manifest_tenant_fkey",
    "rank_snapshots_chunk_tenant_fkey",
    "rank_snapshots_entry_tenant_fkey",
    "rank_snapshots_keyword_tenant_fkey"
  ]) {
    assert.match(sql, new RegExp(`"${constraint}"`, "u"));
  }
  assert.match(
    sql,
    /"chunk_hash" = NEW\."manifest_chunk_hash"/u
  );
  assert.match(
    sql,
    /"chunk_entry_count" = NEW\."persisted_count"/u
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER\s+"rank_snapshots_ingest_receipt_at_commit"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER\s+"current_ranks_ingest_receipt_at_commit"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u
  );
  for (const trigger of [
    "rank_snapshots_immutable",
    "current_ranks_monotonic",
    "rank_chunk_ingest_receipts_immutable",
    "rank_snapshots_no_truncate",
    "current_ranks_no_truncate",
    "rank_chunk_ingest_receipts_no_truncate"
  ]) {
    assert.match(sql, new RegExp(`"${trigger}"`, "u"));
  }
});

test("rank result migration binds quality flags to missing fields", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /rank_data_quality_flags_valid/u);
  assert.match(
    sql,
    /"rank_snapshots_data_quality_shape"/u
  );
  for (const flag of [
    "ABSOLUTE_POSITION_UNAVAILABLE",
    "PIXEL_POSITION_UNAVAILABLE",
    "TITLE_UNAVAILABLE",
    "SNIPPET_UNAVAILABLE"
  ]) {
    assert.match(
      sql,
      new RegExp(
        `IS NULL\\)[\\s\\S]*"data_quality_flags"[\\s\\S]*${flag}`,
        "u"
      )
    );
  }
  assert.match(
    sql,
    /NOT "found"[\s\S]*<@ '\["PROVIDER_OBSERVED_AT_UNAVAILABLE"\]'::jsonb/u
  );
});

test("completion receipt and outbox require each other at commit", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "rank_completion_outbox_manifest_key"/u
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER\s+"rank_check_finalization_completion_outbox_at_commit"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER\s+"rank_completion_outbox_receipt_at_commit"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u
  );
  assert.match(
    sql,
    /'seo\.rank-check\.completed\.v1'/u
  );
  for (const forbidden of [
    "credentialId",
    "providerRequestId",
    "keywordId",
    "rankingUrl"
  ]) {
    assert.doesNotMatch(sql, new RegExp(`'${forbidden}'`, "u"));
  }
});

test("connector version migration keeps SQL and API validation aligned", async () => {
  const sql = await readFile(connectorVersionMigrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  for (const constraint of [
    "rank_chunk_ingest_receipts_connector_version",
    "rank_snapshots_connector_version"
  ]) {
    assert.match(sql, new RegExp(`DROP CONSTRAINT "${constraint}"`, "u"));
    assert.match(sql, new RegExp(`ADD CONSTRAINT "${constraint}"`, "u"));
  }
  assert.equal(
    (sql.match(/\^\[a-z0-9\]\[a-z0-9@\._-\]\{0,63\}\$/gu) ?? []).length,
    2
  );
});

test("provider request migration avoids unsupported regex repetition counts", async () => {
  const sql = await readFile(providerRequestMigrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  assert.doesNotMatch(sql, /\{1,256\}/u);
  assert.equal(
    (sql.match(/length\("provider_request_id"\) BETWEEN 1 AND 256/gu) ?? [])
      .length,
    2
  );
  assert.equal(
    (sql.match(/"provider_request_id" ~ '\^\[ -~\]\+\$'/gu) ?? []).length,
    2
  );
});

test("receipt guard qualifies found against the snapshot table", async () => {
  const sql = await readFile(foundQualificationMigrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  assert.match(
    sql,
    /count\(\*\) FILTER \(WHERE "snapshot"\."found"\)::integer/u
  );
  assert.match(
    sql,
    /count\(\*\) FILTER \(WHERE NOT "snapshot"\."found"\)::integer/u
  );
  assert.doesNotMatch(sql, /FILTER \(WHERE "found"\)/u);
});
