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
import { RankExecutionDispatchService } from "./rank-runs/rank-execution-dispatch.service.js";
import { RankPreparationService } from "./rank-runs/rank-preparation.service.js";
import { RankResultFinalizationService } from "./rank-runs/rank-result-finalization.service.js";
import { RankResultPersistenceService } from "./rank-runs/rank-result-persistence.service.js";
import { RankWorkerModule } from "./rank-worker.module.js";
import { safeErrorSummary } from "./runtime-safe-error.js";

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
  const execution = app.get(RankExecutionDispatchService);
  const finalization = app.get(RankResultFinalizationService);
  const resultPersistence = app.get(RankResultPersistenceService);
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
      await forEachConcurrent(ids, config.rankPreparation.concurrency, async (id) => {
        try {
          await enqueueRankPreparation(queue, id);
        } catch (error) {
          logger.warn(
            `Unable to enqueue one rank preparation: ${safeErrorSummary(error)}`
          );
        }
      });
      const executionIds = await execution.pendingExecutionJobIds();
      await forEachConcurrent(
        executionIds,
        config.rankPreparation.concurrency,
        async (id) => {
        try {
          await execution.process(id);
        } catch (error) {
          logger.warn(
            `Unable to dispatch one rank execution: ${safeErrorSummary(error)}`
          );
        }
        }
      );
      const finalizationIds = await finalization.pendingJobIds();
      await forEachConcurrent(
        finalizationIds,
        config.rankPreparation.concurrency,
        async (id) => {
          try {
            await finalization.process(
              id,
              `rank-finalize-${randomUUID()}`
            );
          } catch (error) {
            logger.warn(
              `Unable to finalize one rank result: ${safeErrorSummary(error)}`
            );
          }
        }
      );
    } catch {
      logger.error("Unable to dispatch pending rank preparations");
    } finally {
      dispatching = false;
    }
  }

  let resultDispatching = false;
  async function dispatchResults(): Promise<void> {
    if (resultDispatching) return;
    resultDispatching = true;
    try {
      await Promise.all(
        Array.from(
          { length: config.rankPreparation.concurrency },
          async () => {
            try {
              await resultPersistence.processBatch(
                `rank-result-${randomUUID()}`
              );
            } catch (error) {
              logger.error(
                `Unable to persist rank result batch: ${safeErrorSummary(error)}`
              );
            }
          }
        )
      );
    } finally {
      resultDispatching = false;
    }
  }

  await Promise.all([dispatchPending(), dispatchResults()]);
  const dispatchTimer = setInterval(
    () => void dispatchPending(),
    config.rankPreparation.dispatchSeconds * 1_000
  );
  dispatchTimer.unref();
  const resultDispatchTimer = setInterval(
    () => void dispatchResults(),
    config.rankPreparation.resultPersistenceDispatchIntervalMs
  );
  resultDispatchTimer.unref();

  worker.on("failed", (job) => {
    logger.error(`Rank preparation failed for job ${job?.id ?? "unknown"}`);
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
    clearInterval(resultDispatchTimer);
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

async function forEachConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>
): Promise<void> {
  for (let index = 0; index < values.length; index += concurrency) {
    await Promise.all(
      values
        .slice(index, index + concurrency)
        .map((value) => operation(value))
    );
  }
}

void bootstrap().catch(() => {
  logger.error("Rank preparation worker failed to start");
  process.exit(1);
});
