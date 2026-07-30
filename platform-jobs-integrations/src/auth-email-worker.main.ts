import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AuthEmailWorkerModule } from "./auth-email-worker.module.js";

const logger = new Logger("AuthEmailWorkerBootstrap");

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    AuthEmailWorkerModule,
    { logger: ["error", "warn", "log"] }
  );
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

void bootstrap().catch(() => {
  logger.error("AUTH_EMAIL_WORKER_STARTUP_FAILED");
  process.exit(1);
});
