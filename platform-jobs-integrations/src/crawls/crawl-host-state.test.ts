import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  crawlBackoffDelayMs,
  crawlHostBackoffDecision
} from "./crawl-host-state.service.js";

const migrationUrl = new URL(
  "../../prisma/migrations/20260731230100_crawl_host_backoff/migration.sql",
  import.meta.url
);
const sitePauseMigrationUrl = new URL(
  "../../prisma/migrations/20260801030000_crawl_site_pause/migration.sql",
  import.meta.url
);

test("uses bounded exponential host backoff and honors Retry-After", () => {
  assert.equal(crawlBackoffDelayMs(1), 5_000);
  assert.equal(crawlBackoffDelayMs(2), 10_000);
  assert.equal(crawlBackoffDelayMs(9), 15 * 60 * 1_000);
  assert.equal(crawlBackoffDelayMs(1, 120_000), 120_000);
  assert.equal(crawlBackoffDelayMs(1, 24 * 60 * 60 * 1_000), 60 * 60 * 1_000);
  assert.throws(
    () => crawlBackoffDelayMs(0),
    /Invalid crawl host failure count/u
  );
});

test("pauses a repeatedly failing site for a bounded full day", () => {
  assert.deepEqual(
    crawlHostBackoffDecision("HOST_UNAVAILABLE", 5),
    { code: "HOST_UNAVAILABLE", delayMs: 80_000 }
  );
  assert.deepEqual(
    crawlHostBackoffDecision("HOST_UNAVAILABLE", 6),
    { code: "SITE_PAUSED", delayMs: 24 * 60 * 60 * 1_000 }
  );
  assert.deepEqual(
    crawlHostBackoffDecision(
      "HOST_RATE_LIMIT",
      6,
      60 * 60 * 1_000
    ),
    { code: "SITE_PAUSED", delayMs: 24 * 60 * 60 * 1_000 }
  );
});

test("host backoff migration is global, bounded and crawl-visible", async () => {
  const [sql, sitePauseSql] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(sitePauseMigrationUrl, "utf8")
  ]);
  assert.match(sql, /CREATE TABLE "crawl_host_states"/u);
  assert.match(sql, /CONSTRAINT "crawl_host_states_host_check"/u);
  assert.match(sql, /CONSTRAINT "crawl_host_states_values_check"/u);
  assert.match(sql, /ADD COLUMN "backoff_code" VARCHAR\(64\)/u);
  assert.match(sql, /technical_crawls_backoff_check/u);
  assert.match(sql, /technical_crawls_status_backoff_idx/u);
  assert.doesNotMatch(sql, /workspace_id|project_id|credential|secret/iu);
  assert.match(sitePauseSql, /DROP CONSTRAINT "technical_crawls_backoff_check"/u);
  assert.match(sitePauseSql, /'SITE_PAUSED'/u);
  assert.doesNotMatch(
    sitePauseSql,
    /workspace_id|project_id|credential|secret/iu
  );
});
