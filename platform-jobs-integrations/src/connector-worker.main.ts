import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { AppConfig } from "./config/app-config.js";
import { APP_CONFIG } from "./config/config.module.js";
import { ConnectorWorkerModule } from "./connector-worker.module.js";
import { IntegrationCredentialValidationWorkerService } from "./integrations/integration-credential-validation-worker.service.js";
import { IntegrationCredentialRefreshSchedulerService } from "./integrations/integration-credential-refresh-scheduler.service.js";
import { RankConnectorRuntimeService } from "./rank-runs/rank-connector-runtime.service.js";
import { KeywordResearchRuntimeService } from "./keyword-research/keyword-research-runtime.service.js";
import { bullMqConnectionOptions } from "./queue/bullmq-keyspace.js";
import {
  enqueueIntegrationCredentialValidation,
  INTEGRATION_CREDENTIAL_VALIDATION_JOB,
  INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
  type IntegrationCredentialValidationJobData
} from "./queue/integration-credential-validation.queue.js";
import {
  enqueueRankConnectorRuntime,
  RANK_CONNECTOR_RUNTIME_JOB,
  type RankConnectorRuntimeJobData
} from "./queue/rank-connector-runtime.queue.js";
import {
  enqueueKeywordResearchRuntime,
  KEYWORD_RESEARCH_RUNTIME_JOB,
  type KeywordResearchRuntimeJobData
} from "./queue/keyword-research-runtime.queue.js";
import { FrequencyCollectionRuntimeService } from "./frequency-collections/frequency-collection-runtime.service.js";
import {
  enqueueFrequencyCollectionRuntime,
  FREQUENCY_COLLECTION_RUNTIME_JOB,
  type FrequencyCollectionRuntimeJobData
} from "./queue/frequency-collection-runtime.queue.js";

const logger = new Logger("IntegrationConnectorWorker");
const RANK_CONNECTOR_RUNTIME_BURST = 5;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    ConnectorWorkerModule,
    { logger: ["error", "warn", "log"] }
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  if (config.integrationCredentials.role !== "EXECUTION") {
    throw new Error(
      "Connector worker requires the EXECUTION integration credential role"
    );
  }
  const validations = app.get(
    IntegrationCredentialValidationWorkerService
  );
  const refreshScheduler = app.get(
    IntegrationCredentialRefreshSchedulerService
  );
  const rankRuntime = app.get(RankConnectorRuntimeService);
  const keywordResearchRuntime = app.get(KeywordResearchRuntimeService);
  const frequencyRuntime = app.get(FrequencyCollectionRuntimeService);
  const workerConnection = redis(config.redisUrl);
  const queueConnection = redis(config.redisUrl);
  const queue = new Queue<IntegrationCredentialValidationJobData>(
    INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
    bullMqConnectionOptions(queueConnection)
  );
  const rankQueue = new Queue<RankConnectorRuntimeJobData>(
    INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
    bullMqConnectionOptions(queueConnection)
  );
  const keywordResearchQueue = new Queue<KeywordResearchRuntimeJobData>(
    INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
    bullMqConnectionOptions(queueConnection)
  );
  const frequencyQueue = new Queue<FrequencyCollectionRuntimeJobData>(
    INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
    bullMqConnectionOptions(queueConnection)
  );
  const leaseOwner = `connector-${randomUUID()}`;
  const worker = new Worker<
    | IntegrationCredentialValidationJobData
    | RankConnectorRuntimeJobData
    | KeywordResearchRuntimeJobData
    | FrequencyCollectionRuntimeJobData
  >(
    INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
    async (job) => {
      if (job.name === FREQUENCY_COLLECTION_RUNTIME_JOB) {
        if (
          !("schemaVersion" in job.data) ||
          job.data.schemaVersion !== "frequency-collection-runtime@1"
        ) {
          throw new Error("Invalid frequency collection runtime job");
        }
        return frequencyRuntime.processBatch(leaseOwner);
      }
      if (job.name === KEYWORD_RESEARCH_RUNTIME_JOB) {
        if (
          !("schemaVersion" in job.data) ||
          job.data.schemaVersion !== "keyword-research-runtime@1"
        ) {
          throw new Error("Invalid keyword research runtime job");
        }
        return keywordResearchRuntime.processOne(leaseOwner);
      }
      if (job.name === RANK_CONNECTOR_RUNTIME_JOB) {
        if (
          !("schemaVersion" in job.data) ||
          job.data.schemaVersion !== "rank-connector-runtime@1"
        ) {
          throw new Error("Invalid rank connector runtime job");
        }
        return rankRuntime.processOne(leaseOwner);
      }
      if (
        job.name !== INTEGRATION_CREDENTIAL_VALIDATION_JOB ||
        !("jobId" in job.data) ||
        !UUID_PATTERN.test(job.data.jobId)
      ) {
        throw new Error("Invalid integration credential validation job");
      }
      return validations.process(
        job.data.jobId.toLowerCase(),
        leaseOwner
      );
    },
    {
      ...bullMqConnectionOptions(workerConnection),
      concurrency:
        config.integrationCredentialValidation.concurrency
    }
  );

  let dispatching = false;
  async function dispatchPending(): Promise<void> {
    if (dispatching) return;
    dispatching = true;
    try {
      try {
        await refreshScheduler.scheduleHourlyRefreshes();
      } catch {
        // Refresh is best-effort and must never stop paid/user operations.
        logger.warn("Unable to schedule hourly credential refreshes");
      }
      const validationJobIds = await validations.pendingValidationIds();
      for (const validationJobId of validationJobIds) {
        await enqueueIntegrationCredentialValidation(queue, validationJobId);
      }
      const dispatchBucket = Math.floor(
        Date.now() /
          (config.integrationCredentialValidation.dispatchSeconds * 1_000)
      );
      for (let slot = 0; slot < RANK_CONNECTOR_RUNTIME_BURST; slot += 1) {
        await enqueueRankConnectorRuntime(
          rankQueue,
          dispatchBucket * RANK_CONNECTOR_RUNTIME_BURST + slot
        );
      }
      await enqueueKeywordResearchRuntime(
        keywordResearchQueue,
        Math.floor(
          Date.now() /
            (config.integrationCredentialValidation.dispatchSeconds * 1_000)
        )
      );
      await enqueueFrequencyCollectionRuntime(
        frequencyQueue,
        Math.floor(
          Date.now() /
            (config.integrationCredentialValidation.dispatchSeconds * 1_000)
        )
      );
    } catch {
      logger.error("Unable to dispatch pending credential validations");
    } finally {
      dispatching = false;
    }
  }

  await dispatchPending();
  const dispatchTimer = setInterval(
    () => void dispatchPending(),
    config.integrationCredentialValidation.dispatchSeconds * 1_000
  );
  dispatchTimer.unref();

  worker.on("failed", (job) => {
    logger.warn(
      `Credential validation failed for job ${job?.id ?? "unknown"}`
    );
  });
  worker.on("error", () => {
    logger.error("Integration credential validation worker error");
  });
  queue.on("error", () => {
    logger.error("Integration credential validation queue error");
  });

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(dispatchTimer);
    await worker.close();
    await queue.close();
    await rankQueue.close();
    await keywordResearchQueue.close();
    await frequencyQueue.close();
    await workerConnection.quit();
    await queueConnection.quit();
    await app.close();
  }

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  logger.log("Integration connector worker started");
}

function redis(url: string): Redis {
  const connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
  connection.on("error", () => {
    logger.error("Integration connector Redis connection error");
  });
  return connection;
}

void bootstrap().catch(() => {
  logger.error("Integration connector worker failed to start");
  process.exit(1);
});
