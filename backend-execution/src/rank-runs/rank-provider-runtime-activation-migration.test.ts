import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("activates only the completed runtime with a new kill-switch generation", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260730123300_rank_provider_runtime_activation/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    migration,
    /UPDATE public\.rank_connector_execution_controls[\s\S]*"submit_enabled" = TRUE/u
  );
  assert.match(
    migration,
    /"kill_switch_version" = 'arsenkin-positions@2'/u
  );
  assert.match(
    migration,
    /AND NOT "submit_enabled"[\s\S]*AND "version" = 1/u
  );
  assert.match(
    migration,
    /RAISE EXCEPTION[\s\S]*Arsenkin rank runtime activation precondition failed/u
  );
});
