import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { AppConfig } from "./config/app-config.js";
import { APP_CONFIG } from "./config/config.module.js";
import { InspectionWorkerModule } from "./inspection-worker.module.js";
import { bullMqConnectionOptions } from "./queue/bullmq-keyspace.js";
import {
  enqueueUploadInspection,
  UPLOAD_INSPECTION_JOB,
  UPLOAD_INSPECTION_QUEUE,
  type UploadInspectionJobData
} from "./queue/upload-inspection.queue.js";
import { UploadInspectionService } from "./uploads/upload-inspection.service.js";

const logger = new Logger("UploadInspectionWorker");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    InspectionWorkerModule,
    { logger: ["error", "warn", "log"] }
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  const inspections = app.get(UploadInspectionService);
  const workerConnection = redis(config.redisUrl);
  const queueConnection = redis(config.redisUrl);
  const queue = new Queue<UploadInspectionJobData>(
    UPLOAD_INSPECTION_QUEUE,
    bullMqConnectionOptions(queueConnection)
  );
  const worker = new Worker<UploadInspectionJobData>(
    UPLOAD_INSPECTION_QUEUE,
    async (job) => {
      if (
        job.name !== UPLOAD_INSPECTION_JOB ||
        !UUID_PATTERN.test(job.data.uploadId)
      ) {
        throw new Error("Invalid upload inspection job");
      }
      return inspections.inspect(job.data.uploadId);
    },
    {
      ...bullMqConnectionOptions(workerConnection),
      concurrency: config.uploads.inspectionConcurrency
    }
  );

  let dispatching = false;
  async function dispatchPending(): Promise<void> {
    if (dispatching) return;
    dispatching = true;
    try {
      const uploadIds = await inspections.pendingUploadIds();
      for (const uploadId of uploadIds) {
        await enqueueUploadInspection(queue, uploadId);
      }
    } catch {
      logger.error("Unable to dispatch pending upload inspections");
    } finally {
      dispatching = false;
    }
  }

  await dispatchPending();
  const dispatchTimer = setInterval(
    () => void dispatchPending(),
    config.uploads.inspectionDispatchSeconds * 1_000
  );
  dispatchTimer.unref();

  worker.on("failed", (job) => {
    logger.warn(`Upload inspection failed for job ${job?.id ?? "unknown"}`);
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
  logger.log("Upload inspection worker started");
}

function redis(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
}

void bootstrap().catch(() => {
  logger.error("Upload inspection worker failed to start");
  process.exit(1);
});
