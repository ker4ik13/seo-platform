import assert from "node:assert/strict";
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
    try {
      const first = await service.recordFailure("radar.example.com", {
        code: "HOST_RATE_LIMIT",
        statusCode: 429,
        retryAfterMs: 20_000
      });
      const state = await service.currentBackoff("radar.example.com");
      assert.ok(state);
      assert.equal(state.code, "HOST_RATE_LIMIT");
      assert.equal(state.until.getTime(), first.getTime());

      const second = await service.recordFailure("radar.example.com", {
        code: "HOST_UNAVAILABLE",
        statusCode: 503
      });
      assert.ok(second >= first);
      const stored = await prisma.crawlHostState.findUniqueOrThrow({
        where: { host: "radar.example.com" }
      });
      assert.equal(stored.consecutiveFailures, 2);
      assert.equal(stored.lastStatusCode, 503);

      assert.equal(
        await service.recordResponse("radar.example.com", 100),
        undefined
      );
      assert.equal(
        await service.currentBackoff("radar.example.com"),
        undefined
      );

      const latencyBackoff =
        await service.recordResponse("radar.example.com", 4_000);
      assert.ok(latencyBackoff);
      assert.equal(
        (await service.currentBackoff("radar.example.com"))?.code,
        "LATENCY_SPIKE"
      );
      for (let attempt = 2; attempt <= 6; attempt += 1) {
        await service.recordFailure("radar.example.com", {
          code: "HOST_UNAVAILABLE",
          statusCode: 503
        });
      }
      const sitePause =
        await service.currentBackoff("radar.example.com");
      assert.equal(sitePause?.code, "SITE_PAUSED");
      assert.ok(
        sitePause!.until.getTime() >=
          Date.now() + 23 * 60 * 60 * 1_000
      );
      assert.equal(
        (
          await prisma.crawlHostState.findUniqueOrThrow({
            where: { host: "radar.example.com" }
          })
        ).consecutiveFailures,
        6
      );
    } finally {
      await prisma.$disconnect();
    }
  }
);
