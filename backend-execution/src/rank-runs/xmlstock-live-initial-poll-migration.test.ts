import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL(
    "../../prisma/migrations/20260923083400_xmlstock_live_initial_poll_immediate/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("starts XMLStock Live pages immediately while retaining delayed Search API cadence", async () => {
  const sql = (await migration).replace(/\s+/gu, " ");
  assert.match(
    sql,
    /execution\.provider <> ''XMLSTOCK'' THEN interval ''5 seconds''/u
  );
  assert.match(
    sql,
    /p_wire_request_snapshot->>''delayed'' = ''true'' THEN interval ''15 seconds''/u
  );
  assert.match(sql, /ELSE interval ''0 seconds''/u);
  assert.match(sql, /occurrence|length\(definition\)/u);
});
