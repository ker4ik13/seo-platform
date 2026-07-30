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
import {
  enqueueIntegrationCredentialValidation,
  INTEGRATION_CREDENTIAL_VALIDATION_JOB,
  INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
  type IntegrationCredentialValidationJobData
} from "./queue/integration-credential-validation.queue.js";

const logger = new Logger("IntegrationConnectorWorker");
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
  const workerConnection = redis(config.redisUrl);
  const queueConnection = redis(config.redisUrl);
  const queue = new Queue<IntegrationCredentialValidationJobData>(
    INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
    { connection: queueConnection }
  );
  const leaseOwner = `connector-${randomUUID()}`;
  const worker = new Worker<IntegrationCredentialValidationJobData>(
    INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
    async (job) => {
      if (
        job.name !== INTEGRATION_CREDENTIAL_VALIDATION_JOB ||
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
      connection: workerConnection,
      concurrency:
        config.integrationCredentialValidation.concurrency,
      limiter: {
        max: 5,
        duration: 10_000
      }
    }
  );

  let dispatching = false;
  async function dispatchPending(): Promise<void> {
    if (dispatching) return;
    dispatching = true;
    try {
      const validationJobIds = await validations.pendingValidationIds();
      for (const validationJobId of validationJobIds) {
        await enqueueIntegrationCredentialValidation(queue, validationJobId);
      }
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
