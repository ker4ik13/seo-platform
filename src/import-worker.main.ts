import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { AppConfig } from "./config/app-config.js";
import { APP_CONFIG } from "./config/config.module.js";
import { ImportWorkerModule } from "./import-worker.module.js";
import { SemanticImportParserService } from "./imports/semantic-import-parser.service.js";
import { SemanticImportPublisherService } from "./imports/semantic-import-publisher.service.js";
import { SemanticImportValidatorService } from "./imports/semantic-import-validator.service.js";
import {
  enqueueSemanticImport,
  enqueueSemanticImportPublish,
  enqueueSemanticImportValidation,
  SEMANTIC_IMPORT_PARSE_JOB,
  SEMANTIC_IMPORT_PUBLISH_JOB,
  SEMANTIC_IMPORT_QUEUE,
  SEMANTIC_IMPORT_VALIDATE_JOB,
  type SemanticImportJobData
} from "./queue/semantic-import.queue.js";

const logger = new Logger("SemanticImportWorker");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    ImportWorkerModule,
    { logger: ["error", "warn", "log"] }
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  const parser = app.get(SemanticImportParserService);
  const validator = app.get(SemanticImportValidatorService);
  const publisher = app.get(SemanticImportPublisherService);
  const workerConnection = redis(config.redisUrl);
  const queueConnection = redis(config.redisUrl);
  const queue = new Queue<SemanticImportJobData>(
    SEMANTIC_IMPORT_QUEUE,
    { connection: queueConnection }
  );
  const worker = new Worker<SemanticImportJobData>(
    SEMANTIC_IMPORT_QUEUE,
    async (job) => {
      if (!UUID_PATTERN.test(job.data.importId)) {
        throw new Error("Invalid semantic import job");
      }
      if (job.name === SEMANTIC_IMPORT_PARSE_JOB) {
        return parser.parse(job.data.importId);
      }
      if (job.name === SEMANTIC_IMPORT_VALIDATE_JOB) {
        return validator.validate(job.data.importId);
      }
      if (job.name === SEMANTIC_IMPORT_PUBLISH_JOB) {
        return publisher.publish(job.data.importId);
      }
      throw new Error("Unknown semantic import job");
    },
    {
      connection: workerConnection,
      concurrency: config.imports.parseConcurrency
    }
  );

  let dispatching = false;
  async function dispatchPending(): Promise<void> {
    if (dispatching) return;
    dispatching = true;
    try {
      const [importIds, validations, publications] = await Promise.all([
        parser.pendingImportIds(),
        validator.pendingImports(),
        publisher.pendingImports()
      ]);
      for (const importId of importIds) {
        await enqueueSemanticImport(queue, importId);
      }
      for (const semanticImport of validations) {
        await enqueueSemanticImportValidation(
          queue,
          semanticImport.id,
          semanticImport.version
        );
      }
      for (const semanticImport of publications) {
        await enqueueSemanticImportPublish(
          queue,
          semanticImport.id,
          semanticImport.version
        );
      }
    } catch {
      logger.error("Unable to dispatch pending semantic imports");
    } finally {
      dispatching = false;
    }
  }

  await dispatchPending();
  const dispatchTimer = setInterval(
    () => void dispatchPending(),
    config.imports.parseDispatchSeconds * 1_000
  );
  dispatchTimer.unref();

  worker.on("failed", (job) => {
    logger.warn(`Semantic import failed for job ${job?.id ?? "unknown"}`);
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
  logger.log("Semantic import worker started");
}

function redis(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
}

void bootstrap().catch(() => {
  logger.error("Semantic import worker failed to start");
  process.exitCode = 1;
});
