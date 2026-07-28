import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { loadAppConfig } from "./config/app-config.js";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const adapter = new FastifyAdapter({
    logger: config.nodeEnv !== "test",
    trustProxy: true,
    requestIdHeader: "x-request-id"
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter
  );

  app.enableShutdownHooks();

  if (config.corsOrigins.length > 0) {
    app.enableCors({
      origin: [...config.corsOrigins],
      credentials: true
    });
  }

  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
