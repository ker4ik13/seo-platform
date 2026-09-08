import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { CrawlHostStateService } from "./crawl-host-state.service.js";

const databaseUrl = process.env.JOBS_CRAWL_TEST_DATABASE_URL;

test(
  "PostgreSQL serializes global host failures, recovery and latency backoff",
  { skip: !databaseUrl, timeout: 15_000 },
  async () => {
    const prisma = new PrismaService({
      databaseUrl,
      databasePoolMax: 2
    } as AppConfig);
    const service = new CrawlHostStateService(prisma);
    const host = `${randomUUID()}.example.invalid`;
    try {
      const first = await service.recordFailure(host, {
        code: "HOST_RATE_LIMIT",
        statusCode: 429,
        retryAfterMs: 20_000
      });
      const state = await service.currentBackoff(host);
      assert.ok(state);
      assert.equal(state.code, "HOST_RATE_LIMIT");
      assert.equal(state.until.getTime(), first.getTime());

      const second = await service.recordFailure(host, {
        code: "HOST_UNAVAILABLE",
        statusCode: 503
      });
      assert.ok(second >= first);
      const stored = await prisma.crawlHostState.findUniqueOrThrow({
        where: { host: host }
      });
      assert.equal(stored.consecutiveFailures, 2);
      assert.equal(stored.lastStatusCode, 503);

      assert.equal(
        await service.recordResponse(host, 100),
        undefined
      );
      assert.equal(
        await service.currentBackoff(host),
        undefined
      );

      const latencyBackoff =
        await service.recordResponse(host, 4_000);
      assert.ok(latencyBackoff);
      assert.equal(
        (await service.currentBackoff(host))?.code,
        "LATENCY_SPIKE"
      );
      for (let attempt = 2; attempt <= 6; attempt += 1) {
        await service.recordFailure(host, {
          code: "HOST_UNAVAILABLE",
          statusCode: 503
        });
      }
      const sitePause =
        await service.currentBackoff(host);
      assert.equal(sitePause?.code, "SITE_PAUSED");
      assert.ok(
        sitePause!.until.getTime() >=
          Date.now() + 23 * 60 * 60 * 1_000
      );
      assert.equal(
        (
          await prisma.crawlHostState.findUniqueOrThrow({
            where: { host: host }
          })
        ).consecutiveFailures,
        6
      );
    } finally {
      await prisma.crawlHostState.deleteMany({ where: { host } });
      await prisma.$disconnect();
    }
  }
);
