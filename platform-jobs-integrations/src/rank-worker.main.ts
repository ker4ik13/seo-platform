import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { AppConfig } from "./config/app-config.js";
import { APP_CONFIG } from "./config/config.module.js";
import { bullMqConnectionOptions } from "./queue/bullmq-keyspace.js";
import {
  enqueueRankPreparation,
  RANK_PREPARATION_JOB,
  RANK_PREPARATION_QUEUE,
  type RankPreparationJobData
} from "./queue/rank-preparation.queue.js";
import { RankPreparationService } from "./rank-runs/rank-preparation.service.js";
import { RankWorkerModule } from "./rank-worker.module.js";

const logger = new Logger("RankPreparationWorker");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    RankWorkerModule,
    { logger: ["error", "warn", "log"] }
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  if (!config.rankPreparation.enabled) {
    throw new Error("Rank worker requires RANK_PREPARATION_ENABLED=true");
  }
  const preparation = app.get(RankPreparationService);
  const workerConnection = redis(config.redisUrl);
  const queueConnection = redis(config.redisUrl);
  const queue = new Queue<RankPreparationJobData>(
    RANK_PREPARATION_QUEUE,
    bullMqConnectionOptions(queueConnection)
  );
  const worker = new Worker<RankPreparationJobData>(
    RANK_PREPARATION_QUEUE,
    async (job) => {
      if (
        job.name !== RANK_PREPARATION_JOB ||
        !UUID_PATTERN.test(job.data.jobId)
      ) {
        throw new Error("Invalid rank preparation queue message");
      }
      await preparation.process(
        job.data.jobId,
        `rank-${randomUUID()}`
      );
    },
    {
      ...bullMqConnectionOptions(workerConnection),
      concurrency: config.rankPreparation.concurrency
    }
  );

  let dispatching = false;
  async function dispatchPending(): Promise<void> {
    if (dispatching) return;
    dispatching = true;
    try {
      const ids = await preparation.pendingPreparationIds();
      for (const id of ids) {
        await enqueueRankPreparation(queue, id);
      }
    } catch {
      logger.error("Unable to dispatch pending rank preparations");
    } finally {
      dispatching = false;
    }
  }

  await dispatchPending();
  const dispatchTimer = setInterval(
    () => void dispatchPending(),
    config.rankPreparation.dispatchSeconds * 1_000
  );
  dispatchTimer.unref();

  worker.on("failed", (job) => {
    logger.warn(`Rank preparation failed for job ${job?.id ?? "unknown"}`);
  });
  worker.on("error", () => {
    logger.error("Rank preparation worker error");
  });
  queue.on("error", () => {
    logger.error("Rank preparation queue error");
  });

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(dispatchTimer);
    await worker.close();
    await queue.close();
    await workerConnection.quit();
    await queueConnection.quit();
    await app.close();
  }

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  logger.log("Rank preparation worker started");
}

function redis(url: string): Redis {
  const connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
  connection.on("error", () => {
    logger.error("Rank preparation Redis connection error");
  });
  return connection;
}

void bootstrap().catch(() => {
  logger.error("Rank preparation worker failed to start");
  process.exit(1);
});
