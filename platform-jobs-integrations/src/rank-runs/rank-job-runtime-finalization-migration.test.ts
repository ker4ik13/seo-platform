import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL(
    "../../prisma/migrations/20260730123200_rank_job_runtime_finalization/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const permissions = readFile(
  new URL(
    "../../../platform-infrastructure/postgres/permissions/service-runtime.sql",
    import.meta.url
  ),
  "utf8"
);

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

test("allows truthful mixed submit-unknown finalization counts", async () => {
  const sql = compact(await migration);
  assert.ok(
    sql.includes(
      "CREATE FUNCTION public.manual_rank_action_result_is_coherent"
    )
  );
  assert.ok(
    sql.includes(
      "result_pair_count = result_persisted_count + result_failed_count + result_unknown_count"
    )
  );
  assert.ok(sql.includes("result_unknown_count > 0"));
  assert.ok(
    sql.includes(
      "result_persisted_count = persisted_count"
    )
  );
  assert.ok(
    sql.includes(
      "CREATE OR REPLACE FUNCTION public.assert_manual_rank_job_shape"
    )
  );
  assert.ok(
    sql.includes(
      "public.manual_rank_action_result_is_coherent( NEW.\"result_summary\", NEW.\"progress_total\", NEW.\"progress_current\" )"
    )
  );
});

test("rank worker gets only reviewed result finalization mutations", async () => {
  const sql = compact(await permissions);
  assert.ok(
    sql.includes(
      "GRANT UPDATE ( status, provider_request_id, output_reference, actual_cost_micro, error, attempt, retry_at, updated_at ) ON TABLE public.job_items"
    )
  );
  assert.equal(
    sql.match(
      /'public\.manual_rank_action_result_is_coherent\(jsonb,bigint,bigint\)'/gu
    )?.length,
    2
  );
});
