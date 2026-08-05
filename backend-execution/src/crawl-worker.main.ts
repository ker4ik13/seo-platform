import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { CrawlWorkerModule } from "./crawl-worker.module.js";
import type { AppConfig } from "./config/app-config.js";
import { APP_CONFIG } from "./config/config.module.js";
import { CrawlRunnerService } from "./crawls/crawl-runner.service.js";
import { CrawlService } from "./crawls/crawl.service.js";
import { bullMqConnectionOptions } from "./queue/bullmq-keyspace.js";
import {
  CRAWL_JOB,
  CRAWL_QUEUE,
  enqueueCrawl,
  type CrawlJobData
} from "./queue/crawl.queue.js";

const logger = new Logger("CrawlWorker");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    CrawlWorkerModule,
    { logger: ["error", "warn", "log"] }
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  if (!config.crawl.enabled) {
    throw new Error("Crawl worker process role is not enabled");
  }
  const runner = app.get(CrawlRunnerService);
  const crawls = app.get(CrawlService);
  const workerConnection = redis(config.redisUrl);
  const queueConnection = redis(config.redisUrl);
  const queue = new Queue<CrawlJobData>(
    CRAWL_QUEUE,
    bullMqConnectionOptions(queueConnection)
  );
  const worker = new Worker<CrawlJobData>(
    CRAWL_QUEUE,
    async (job) => {
      if (
        job.name !== CRAWL_JOB ||
        !UUID_PATTERN.test(job.data.crawlId)
      ) {
        throw new Error("Invalid crawl queue message");
      }
      const attempts = job.opts.attempts ?? 1;
      await runner.process(
        job.data.crawlId,
        `crawl-worker:${process.pid}:${job.id ?? job.data.crawlId}`,
        job.attemptsMade + 1 >= attempts
      );
    },
    {
      ...bullMqConnectionOptions(workerConnection),
      concurrency: config.crawl.concurrency
    }
  );

  let dispatching = false;
  async function dispatchPending(): Promise<void> {
    if (dispatching) return;
    dispatching = true;
    try {
      for (const crawlId of await crawls.pendingIds()) {
        await enqueueCrawl(queue, crawlId);
      }
    } catch {
      logger.warn("Unable to reconcile pending crawls");
    } finally {
      dispatching = false;
    }
  }
  await dispatchPending();
  const timer = setInterval(
    () => void dispatchPending(),
    config.crawl.dispatchSeconds * 1_000
  );
  timer.unref();

  worker.on("failed", (job) => {
    logger.warn(`Crawl failed for ${job?.id ?? "unknown"}`);
  });
  worker.on("error", () => logger.error("Crawl worker error"));
  queue.on("error", () => logger.error("Crawl queue error"));

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    await worker.close();
    await queue.close();
    await workerConnection.quit();
    await queueConnection.quit();
    await app.close();
  }
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  logger.log("Crawl worker started");
}

function redis(url: string): Redis {
  const connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
  connection.on("error", () => logger.error("Crawl Redis error"));
  return connection;
}

void bootstrap().catch(() => {
  logger.error("Crawl worker failed to start");
  process.exit(1);
});
