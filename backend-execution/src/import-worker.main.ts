import "dotenv/config";
import { randomUUID } from "node:crypto";
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
import { KeywordResearchImportService } from "./keyword-research/keyword-research-import.service.js";
import { bullMqConnectionOptions } from "./queue/bullmq-keyspace.js";
import {
  enqueueSemanticImport,
  enqueueSemanticImportPublish,
  enqueueSemanticImportValidation,
  enqueueKeywordResearchImport,
  KEYWORD_RESEARCH_IMPORT_JOB,
  SEMANTIC_IMPORT_PARSE_JOB,
  SEMANTIC_IMPORT_PUBLISH_JOB,
  SEMANTIC_IMPORT_QUEUE,
  SEMANTIC_IMPORT_VALIDATE_JOB,
  type ImportWorkerJobData
} from "./queue/semantic-import.queue.js";
import {
  enqueueSemanticExport,
  SEMANTIC_EXPORT_JOB,
  SEMANTIC_EXPORT_QUEUE,
  type SemanticExportJobData
} from "./queue/semantic-export.queue.js";
import { SemanticExportWorkerService } from "./semantic-exports/semantic-export-worker.service.js";
import { FileRetentionService } from "./file-retention/file-retention.service.js";

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
  const keywordResearch = app.get(KeywordResearchImportService);
  const semanticExports = app.get(SemanticExportWorkerService);
  const fileRetention = app.get(FileRetentionService);
  const leaseOwner = `keyword-import-${randomUUID()}`;
  const exportLeaseOwner = semanticExports.workerId();
  const workerConnection = redis(config.redisUrl);
  const queueConnection = redis(config.redisUrl);
  const exportWorkerConnection = redis(config.redisUrl);
  const exportQueueConnection = redis(config.redisUrl);
  const queue = new Queue<ImportWorkerJobData>(
    SEMANTIC_IMPORT_QUEUE,
    bullMqConnectionOptions(queueConnection)
  );
  const worker = new Worker<ImportWorkerJobData>(
    SEMANTIC_IMPORT_QUEUE,
    async (job) => {
      if (job.name === KEYWORD_RESEARCH_IMPORT_JOB) {
        if (!("runId" in job.data) || !UUID_PATTERN.test(job.data.runId)) {
          throw new Error("Invalid keyword research import job");
        }
        return keywordResearch.import(job.data.runId, leaseOwner);
      }
      if (!("importId" in job.data)) {
        throw new Error("Invalid semantic import job");
      }
      if (!UUID_PATTERN.test(job.data.importId)) {
        throw new Error("Invalid semantic import job");
      }
      if (job.name === SEMANTIC_IMPORT_PARSE_JOB) {
        const outcome = await parser.parse(job.data.importId);
        if (outcome.status === "VALIDATING" && outcome.version !== undefined) {
          await enqueueSemanticImportValidation(
            queue,
            outcome.importId,
            outcome.version
          );
        }
        return outcome;
      }
      if (job.name === SEMANTIC_IMPORT_VALIDATE_JOB) {
        const outcome = await validator.validate(job.data.importId);
        if (
          outcome.status === "READY_TO_PUBLISH" &&
          outcome.version !== undefined
        ) {
          await enqueueSemanticImportPublish(
            queue,
            outcome.importId,
            outcome.version
          );
        }
        return outcome;
      }
      if (job.name === SEMANTIC_IMPORT_PUBLISH_JOB) {
        return publisher.publish(job.data.importId);
      }
      throw new Error("Unknown semantic import job");
    },
    {
      ...bullMqConnectionOptions(workerConnection),
      concurrency: config.imports.parseConcurrency,
      // Native KC4 parsing is CPU intensive and may keep the event loop busy
      // longer than BullMQ's 30 second default. Match the database claim lease
      // so a large project cannot be picked up twice while parsing.
      lockDuration: config.imports.parseLeaseMinutes * 60_000
    }
  );
  const exportQueue = new Queue<SemanticExportJobData>(
    SEMANTIC_EXPORT_QUEUE,
    bullMqConnectionOptions(exportQueueConnection)
  );
  const exportWorker = new Worker<SemanticExportJobData>(
    SEMANTIC_EXPORT_QUEUE,
    async (job) => {
      if (
        job.name !== SEMANTIC_EXPORT_JOB ||
        !UUID_PATTERN.test(job.data.exportId)
      ) {
        throw new Error("Invalid semantic export job");
      }
      return semanticExports.process(job.data.exportId, exportLeaseOwner);
    },
    {
      ...bullMqConnectionOptions(exportWorkerConnection),
      concurrency: Math.max(1, Math.min(config.imports.parseConcurrency, 2)),
      lockDuration: config.imports.parseLeaseMinutes * 60_000
    }
  );

  let dispatching = false;
  async function dispatchPending(): Promise<void> {
    if (dispatching) return;
    dispatching = true;
    try {
      await semanticExports.reconcileCancellations();
      const [importIds, validations, publications, researchRunIds, exportIds] = await Promise.all([
        parser.pendingImportIds(),
        validator.pendingImports(),
        publisher.pendingImports(),
        keywordResearch.pendingIds(),
        semanticExports.pendingIds()
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
      for (const runId of researchRunIds) {
        await enqueueKeywordResearchImport(queue, runId);
      }
      for (const exportId of exportIds) {
        await enqueueSemanticExport(exportQueue, exportId);
      }
    } catch {
      logger.error("Unable to dispatch pending semantic import/export jobs");
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

  let sweepingFiles = false;
  async function sweepFiles(): Promise<void> {
    if (sweepingFiles) return;
    sweepingFiles = true;
    try {
      await fileRetention.sweep();
    } catch {
      logger.error("Unable to sweep expired uploaded and exported files");
    } finally {
      sweepingFiles = false;
    }
  }
  void sweepFiles();
  const fileRetentionTimer = setInterval(() => void sweepFiles(), 60 * 60 * 1_000);
  fileRetentionTimer.unref();

  worker.on("failed", (job, error) => {
    logger.error(
      `Semantic import failed for job ${job?.id ?? "unknown"} (${safeFailureCode(error)})`
    );
  });
  exportWorker.on("failed", (job, error) => {
    logger.error(
      `Semantic export failed for job ${job?.id ?? "unknown"} (${safeFailureCode(error)})`
    );
  });

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(dispatchTimer);
    clearInterval(fileRetentionTimer);
    await worker.close();
    await exportWorker.close();
    await queue.close();
    await exportQueue.close();
    await workerConnection.quit();
    await queueConnection.quit();
    await exportWorkerConnection.quit();
    await exportQueueConnection.quit();
    await app.close();
  }

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  logger.log("Semantic import/export worker started");
}

function redis(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
}

function safeFailureCode(error: Error): string {
  const code = (error as Error & { readonly code?: unknown }).code;
  if (
    typeof code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(code)
  ) {
    return code;
  }
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
    ? error.name
    : "UNKNOWN_ERROR";
}

void bootstrap().catch(() => {
  logger.error("Semantic import/export worker failed to start");
  process.exit(1);
});
