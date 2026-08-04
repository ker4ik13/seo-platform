import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260802224500_xmlstock_validation_and_rank_lease/migration.sql",
  import.meta.url
);
const retryMigrationUrl = new URL(
  "../../prisma/migrations/20260802225000_retry_pre_xmlstock_validation_failures/migration.sql",
  import.meta.url
);

test("persists a verified XMLStock credential with exact safe metadata", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /current_job\."provider" = ''XMLSTOCK''/u);
  assert.match(sql, /regionCatalogAvailable/u);
  assert.match(sql, /Invalid XMLStock validation metadata/u);
  assert.match(
    sql,
    /SERP_RANK_TRACKING.*SERP_COLLECTION.*WORDSTAT/u
  );
  assert.match(sql, /finish_integration_credential_validation_success/u);
});

test("extends the real rank pre-authorization lease to 120 seconds", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /claim_rank_connector_execution_pre_authorization\(text,integer,text\)/u
  );
  assert.match(sql, /BETWEEN 5 AND 120/u);
  assert.match(sql, /between 5 and 120 seconds/iu);
  assert.doesNotMatch(
    sql,
    /claim_rank_connector_execution\(text,integer,text\)'::regprocedure/u
  );
});

test("retries only the current pending XMLStock material after the broker fix", async () => {
  const sql = await readFile(retryMigrationUrl, "utf8");

  assert.match(sql, /job\."provider" = 'XMLSTOCK'/u);
  assert.match(sql, /job\."status" = 'FAILED_RETRYABLE'/u);
  assert.match(sql, /credential\."status" = 'PENDING_VERIFICATION'/u);
  assert.match(sql, /credential\."material_version"/u);
  assert.match(sql, /'xmlstock@1\.1\.0'/u);
  assert.match(sql, /"status" = 'RETRY_SCHEDULED'/u);
});
