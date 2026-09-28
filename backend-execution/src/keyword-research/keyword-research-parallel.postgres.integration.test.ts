import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.JOBS_KEYWORD_RESEARCH_TEST_DATABASE_URL;

test("PostgreSQL 18 checkpoints separate XMLStock seeds through the connector-only boundary", {
  skip: !databaseUrl,
  timeout: 20_000
}, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("BEGIN");
  try {
    const ids = (await client.query<{
      workspace: string; project: string; actor: string; credential: string;
      binding: string; route: string; job: string; run: string; lease: string;
      quote: string;
    }>(`SELECT uuidv7() AS workspace, uuidv7() AS project, uuidv7() AS actor,
      uuidv7() AS credential, uuidv7() AS binding, uuidv7() AS route,
      uuidv7() AS job, uuidv7() AS run, uuidv7() AS lease,
      uuidv7() AS quote`)).rows[0]!;
    const queries = ["первый запрос", "второй запрос", "третий запрос"];
    const input = {
      source: "XMLSTOCK_WORDSTAT", queries, regionCode: "0", device: "ALL",
      minusWords: [], clearMinusPhrases: false, includeRightColumn: false,
      clearPlus: false, maxKeywords: 6_000
    };
    await client.query(`INSERT INTO integration_credentials (
      id, workspace_id, provider, label, mode, status, ciphertext, nonce,
      auth_tag, encrypted_data_key, data_key_nonce, data_key_auth_tag,
      key_version, capabilities, idempotency_key, request_fingerprint,
      fingerprint_key_version, verified_at, created_by, updated_by, updated_at
    ) VALUES ($1,$2,'XMLSTOCK','Disposable','PLATFORM_PAID','ACTIVE',$3,$4,$5,$6,$4,$5,
      1,'["KEYWORD_RESEARCH"]'::jsonb,$7,$8,1,clock_timestamp(),$9,$9,clock_timestamp())`, [
      ids.credential, ids.workspace, Buffer.from("secret"), Buffer.alloc(12),
      Buffer.alloc(16), Buffer.from("key"), `seed-${ids.credential}`, Buffer.alloc(32), ids.actor
    ]);
    await client.query(`INSERT INTO project_connector_bindings (
      id, workspace_id, project_id, capability, enabled, created_by, updated_by,
      updated_at
    ) VALUES ($1,$2,$3,'KEYWORD_RESEARCH',true,$4,$4,clock_timestamp())`, [
      ids.binding, ids.workspace, ids.project, ids.actor
    ]);
    await client.query(`INSERT INTO project_connector_routes (
      id, workspace_id, project_id, binding_id, position, source_kind,
      credential_id, updated_at
    ) VALUES ($1,$2,$3,$4,0,'WORKSPACE_CREDENTIAL',$5,clock_timestamp())`, [
      ids.route, ids.workspace, ids.project, ids.binding, ids.credential
    ]);
    await client.query(`INSERT INTO jobs (
      id, workspace_id, project_id, type, status, stage, actor_id,
      idempotency_scope, input_snapshot, scope_snapshot, credential_mode,
      provider, correlation_id, lease_owner, lease_expires_at,
      progress_total, billing_quote_id, billing_command_hash,
      billing_maximum_units_milli, updated_at
    ) VALUES ($1,$2,$3,'KEYWORD_RESEARCH','RUNNING','collecting',$4,
      'research-checkpoint-fixture',$5::jsonb,'{}'::jsonb,'PLATFORM_PAID',
      'XMLSTOCK','research-checkpoint-fixture','worker-one',
      clock_timestamp() + interval '60 seconds',6000,$6,$7,3000,clock_timestamp())`, [
      ids.job, ids.workspace, ids.project, ids.actor, JSON.stringify(input),
      ids.quote, Buffer.alloc(32, 1)
    ]);
    await client.query(`INSERT INTO keyword_research_runs (
      id, workspace_id, project_id, job_id, actor_id, binding_id, route_id,
      credential_id, source, provider, input_snapshot, max_keywords, status,
      lease_token, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'XMLSTOCK_WORDSTAT','XMLSTOCK',
      $9::jsonb,6000,'RUNNING',$10,clock_timestamp())`, [
      ids.run, ids.workspace, ids.project, ids.job, ids.actor,
      ids.binding, ids.route, ids.credential, JSON.stringify(input), ids.lease
    ]);

    await client.query("SET LOCAL ROLE jobs_connector");
    const scope = [ids.run, "worker-one", ids.lease, 1, 1] as const;
    const reserve = (seedIndex: number, begin: boolean) => client.query<{
      state: string; rows: unknown; responseHash: Buffer | null;
    }>(`SELECT * FROM public.reserve_xmlstock_wordstat_research_seed(
      $1::uuid,$2::text,$3::uuid,$4::integer,$5::integer,$6::integer,$7::boolean
    )`, [...scope, seedIndex, begin]);
    assert.equal((await reserve(1, false)).rows[0]?.state, "AVAILABLE");
    for (const part of ["SEED:1", "SEED:2", "SEED:3"]) {
      const ticket = await client.query<{ ticket: { mode: string; state: string } }>(
        `SELECT public.prepare_provider_usage_ticket(
          $1::uuid,$2::uuid,$3::uuid,$4::text,$5::integer,$6::text,ARRAY[]::uuid[]
        ) AS ticket`, [ids.job, ids.workspace, ids.project, "worker-one", 1, part]
      );
      assert.equal(ticket.rows[0]?.ticket.mode, "PLATFORM_PAID");
      assert.equal(ticket.rows[0]?.ticket.state, "PREPARED");
    }
    await client.query("SAVEPOINT outside_paid_window");
    await assert.rejects(
      client.query(`SELECT public.prepare_provider_usage_ticket(
        $1::uuid,$2::uuid,$3::uuid,'worker-one',1,'SEED:4',ARRAY[]::uuid[]
      )`, [ids.job, ids.workspace, ids.project]),
      /Unsupported research billing unit/u
    );
    await client.query("ROLLBACK TO SAVEPOINT outside_paid_window");
    assert.equal((await reserve(1, true)).rows[0]?.state, "STARTED");
    assert.equal((await reserve(2, true)).rows[0]?.state, "STARTED");
    const rows = [{ keyword: "результат", frequencyBase: 2, sourceQuery: queries[0], sourceColumn: "LEFT" }];
    const hash = Buffer.alloc(32, 7);
    const finished = await client.query<{ finished: boolean }>(`SELECT
      public.finish_xmlstock_wordstat_research_seed_checkpoint(
        $1::uuid,$2::text,$3::uuid,$4::integer,$5::integer,1,
        'ACCEPTED',$6::jsonb,$7::bytea,NULL
      ) AS finished`, [...scope, JSON.stringify(rows), hash]);
    assert.equal(finished.rows[0]?.finished, true);
    assert.equal((await reserve(1, false)).rows[0]?.state, "ACCEPTED");
    assert.equal((await reserve(3, true)).rows[0]?.state, "STARTED");
    const laterRows = [{ keyword: "поздний результат", frequencyBase: 3, sourceQuery: queries[2], sourceColumn: "LEFT" }];
    const laterHash = Buffer.alloc(32, 8);
    const laterFinished = await client.query<{ finished: boolean }>(`SELECT
      public.finish_xmlstock_wordstat_research_seed_checkpoint(
        $1::uuid,$2::text,$3::uuid,$4::integer,$5::integer,3,
        'ACCEPTED',$6::jsonb,$7::bytea,NULL
      ) AS finished`, [...scope, JSON.stringify(laterRows), laterHash]);
    assert.equal(laterFinished.rows[0]?.finished, true);
    const completed = await client.query(`SELECT * FROM public.complete_xmlstock_wordstat_research_seed(
      $1::uuid,$2::text,$3::uuid,$4::integer,$5::integer,$6::jsonb,$7::bytea
    )`, [...scope, JSON.stringify(rows), hash]);
    assert.equal(completed.rowCount, 1);
    await client.query("RESET ROLE");
    const afterFirstPage = await client.query<{
      run_status: string; job_status: string; next_page: number;
    }>(`SELECT run.status AS run_status, job.status AS job_status,
      run.next_page FROM keyword_research_runs run JOIN jobs job
      ON job.id = run.job_id WHERE run.id = $1::uuid`, [ids.run]);
    assert.deepEqual(afterFirstPage.rows[0], {
      run_status: "QUEUED", job_status: "QUEUED", next_page: 2
    });
    await client.query("SET LOCAL ROLE jobs_connector");
    const nextClaim = await client.query<{
      runId: string; runVersion: number; jobVersion: number; leaseToken: string;
    }>("SELECT * FROM public.claim_keyword_research_run('worker-two',60)");
    assert.equal(nextClaim.rowCount, 1);
    const next = nextClaim.rows[0]!;
    const resumed = await client.query<{ state: string }>(`SELECT * FROM
      public.reserve_xmlstock_wordstat_research_seed(
        $1::uuid,'worker-two',$2::uuid,$3::integer,$4::integer,2,false
      )`, [ids.run, next.leaseToken, next.runVersion, next.jobVersion]);
    assert.equal(resumed.rows[0]?.state, "UNKNOWN");
    const skipped = await client.query<{ skipped: boolean }>(`SELECT
      public.skip_unknown_xmlstock_wordstat_research_seed(
        $1::uuid,'worker-two',$2::uuid,$3::integer,$4::integer,2
      ) AS skipped`, [ids.run, next.leaseToken, next.runVersion, next.jobVersion]);
    assert.equal(skipped.rows[0]?.skipped, true);
    const lastClaim = await client.query<{
      runVersion: number; jobVersion: number; leaseToken: string;
    }>("SELECT * FROM public.claim_keyword_research_run('worker-three',60)");
    assert.equal(lastClaim.rowCount, 1);
    const last = lastClaim.rows[0]!;
    const recovered = await client.query<{ state: string }>(`SELECT * FROM
      public.reserve_xmlstock_wordstat_research_seed(
        $1::uuid,'worker-three',$2::uuid,$3::integer,$4::integer,3,false
      )`, [ids.run, last.leaseToken, last.runVersion, last.jobVersion]);
    assert.equal(recovered.rows[0]?.state, "ACCEPTED");
    const lastCompleted = await client.query(`SELECT * FROM public.complete_xmlstock_wordstat_research_seed(
      $1::uuid,'worker-three',$2::uuid,$3::integer,$4::integer,$5::jsonb,$6::bytea
    )`, [ids.run, last.leaseToken, last.runVersion, last.jobVersion,
      JSON.stringify(laterRows), laterHash]);
    assert.equal(lastCompleted.rowCount, 1);

    await client.query("SAVEPOINT direct_table_denied");
    await assert.rejects(
      client.query("SELECT * FROM public.keyword_research_seed_checkpoints"),
      (error: unknown) => (error as { code?: string }).code === "42501"
    );
    await client.query("ROLLBACK TO SAVEPOINT direct_table_denied");
    await client.query("RESET ROLE");
    const persisted = await client.query<{
      next_page: number; collected_keywords: number; status: string; failure_code: string;
    }>(
      "SELECT next_page, collected_keywords, status, failure_code FROM keyword_research_runs WHERE id = $1::uuid", [ids.run]
    );
    assert.deepEqual(persisted.rows[0], {
      next_page: 4, collected_keywords: 2,
      status: "READY_TO_IMPORT", failure_code: "XMLSTOCK_OUTCOME_UNKNOWN"
    });
    const job = await client.query<{ status: string }>(
      "SELECT status FROM jobs WHERE id = $1::uuid", [ids.job]
    );
    assert.equal(job.rows[0]?.status, "AWAITING_APPROVAL");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});
