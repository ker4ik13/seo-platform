import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { WebPushWorkerModule } from "./web-push-worker.module.js";

const app = await NestFactory.createApplicationContext(
  WebPushWorkerModule,
  { bufferLogs: true }
);
app.enableShutdownHooks();
