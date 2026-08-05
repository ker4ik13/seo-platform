import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260805203000_rank_route_frequency_capacity_consistency/migration.sql",
  import.meta.url
);

test("explicit rank routes remain valid through grant, claim and submit", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /^BEGIN;\s/u);
  assert.match(migration, /\sCOMMIT;\s*$/u);
  assert.match(
    migration,
    /public\.assert_rank_connector_execution_scope\(\)/u
  );
  assert.match(
    migration,
    /public\.claim_rank_connector_execution_pre_authorization\(text,integer,text\)/u
  );
  assert.match(
    migration,
    /public\.authorize_rank_connector_execution_submit\(uuid,uuid,text,uuid,integer,integer,text\)/u
  );
  assert.match(migration, /route_position_fragment := 'AND route\.position = 0'/u);
  assert.match(
    migration,
    /route_position_fragment := 'AND route\."position" = 0'/u
  );
  assert.match(migration, /occurrence_count <> 1/u);
  assert.match(migration, /occurrence_count <> 2/u);
  assert.match(
    migration,
    /EXECUTE replace\(function_definition, route_position_fragment, ''\)/u
  );
});

test("Wordstat capacity counts only live Arsenkin provider work", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /seo-platform:rank-dispatch:ARSENKIN/u);
  assert.match(
    migration,
    /JOIN public\.jobs rank_job[\s\S]*rank_job\.id = execution\.job_id/u
  );
  assert.match(migration, /execution\.provider = 'ARSENKIN'/u);
  assert.match(migration, /rank_job\.status = 'RUNNING'/u);
  assert.match(migration, /rank_job\.cancel_requested_at IS NULL/u);
  assert.match(
    migration,
    /execution\.status = 'READY_TO_SUBMIT'[\s\S]*authorization_expires_at > clock_timestamp\(\)/u
  );
  assert.match(
    migration,
    /execution\.status IN \('CLAIMED','FETCHING'\)[\s\S]*lease_expires_at > clock_timestamp\(\)/u
  );
  assert.match(
    migration,
    /execution\.status IN \('SUBMITTING','POLL_WAIT'\)/u
  );
  assert.match(
    migration,
    /public\.mark_frequency_collection_batch_submitting\(uuid,uuid\[\],text,integer,text,integer\)/u
  );
});
