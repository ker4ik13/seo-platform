import "dotenv/config";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadSystemWorkerConfig } from "./config/app-config.js";
import { SYSTEM_QUEUE } from "./queue/queue.service.js";

const config = loadSystemWorkerConfig();
const connection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
});

const worker = new Worker(
  SYSTEM_QUEUE,
  async (job) => ({
    jobId: job.id,
    processedAt: new Date().toISOString()
  }),
  {
    connection,
    concurrency: config.concurrency
  }
);

async function shutdown(): Promise<void> {
  await worker.close();
  await connection.quit();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
