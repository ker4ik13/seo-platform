import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260827113000_billing_usage_reservations/migration.sql",
  import.meta.url
);

test("billing usage reservations freeze economics and terminal settlement evidence", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /CREATE TABLE "billing_usage_reservations"/u);
  assert.match(
    migration,
    /"amount_minor" = "unit_price_minor" \* "quantity"/u
  );
  assert.match(
    migration,
    /"captured_at" >= "reserved_at"[\s\S]*"captured_at" < "expires_at"/u
  );
  assert.match(
    migration,
    /OLD\."status" <> 'RESERVED'[\s\S]*NEW\."capture_transaction_id" IS DISTINCT FROM OLD\."capture_transaction_id"[\s\S]*terminal billing usage settlement is immutable/u
  );
  assert.match(
    migration,
    /NEW\."expires_at" > clock_timestamp\(\) \+ interval '2 minutes'[\s\S]*invalid billing usage reservation hold/u
  );
  assert.match(
    migration,
    /BEFORE TRUNCATE ON "billing_usage_reservations"/u
  );
});
