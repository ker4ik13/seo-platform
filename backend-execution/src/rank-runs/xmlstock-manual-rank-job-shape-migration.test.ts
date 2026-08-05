import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL(
    "../../prisma/migrations/20260803074500_xmlstock_manual_rank_job_shape/migration.sql",
    import.meta.url
  ),
  "utf8"
);

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

test("allows bounded Arsenkin and XMLStock manual rank jobs", async () => {
  const sql = compact(await migration);

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;$/u);
  assert.ok(
    sql.includes(
      `CREATE OR REPLACE FUNCTION public.assert_manual_rank_job_shape()`
    )
  );
  assert.ok(
    sql.includes(
      `NEW."provider" NOT IN ('ARSENKIN', 'XMLSTOCK')`
    )
  );
  assert.ok(
    sql.includes(
      `NEW."progress_total" NOT BETWEEN 1 AND 15000`
    )
  );
  assert.doesNotMatch(
    sql,
    /NEW\."provider" IS DISTINCT FROM 'ARSENKIN'/u
  );
  assert.doesNotMatch(
    sql,
    /NEW\."progress_total" NOT BETWEEN 1 AND 1000/u
  );
});

test("preserves the fail-closed manual rank lifecycle checks", async () => {
  const sql = compact(await migration);

  assert.ok(
    sql.includes(
      `MANUAL_RANK_CHECK must start in PREPARING version 1 attempt 0`
    )
  );
  assert.ok(
    sql.includes(
      `NEW."progress_unit" IS DISTINCT FROM 'KEYWORD'`
    )
  );
  assert.ok(
    sql.includes(
      `public.manual_rank_action_result_is_coherent( NEW."result_summary", NEW."progress_total", NEW."progress_current" )`
    )
  );
  assert.ok(sql.includes(`Invalid terminal rank job lifecycle`));
});
