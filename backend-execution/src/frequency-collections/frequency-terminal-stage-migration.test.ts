import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260801213000_frequency_terminal_stage_guard/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("normalizes terminal frequency jobs to the finished stage", () => {
  assert.match(migration, /jobs_frequency_terminal_stage_guard/u);
  assert.match(migration, /NEW\."type" = 'FREQUENCY_COLLECTION'/u);
  assert.match(migration, /NEW\."stage" := 'finished'/u);
  assert.match(migration, /UPDATE public\."jobs"/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.enforce_frequency_terminal_stage\(\) FROM PUBLIC/u
  );
});
