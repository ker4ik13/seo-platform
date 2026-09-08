import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { PrivateExceptionFilter } from "./internal/private-exception.filter.js";
import { installClusteringRunBodyLimit } from "./clustering-runs/clustering-run-body-limit.js";
import { loadAppConfig } from "./config/app-config.js";
import { installPrivateHttpResponsePolicy, serializeRequestForLog } from "./internal/http-response-policy.js";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const adapter = new FastifyAdapter({
    logger: config.nodeEnv !== "test" ? { serializers: { req: serializeRequestForLog } } : false,
    requestIdHeader: "x-request-id"
  });
  installClusteringRunBodyLimit(adapter.getInstance());
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter
  );

  installPrivateHttpResponsePolicy(adapter.getInstance());
  app.useGlobalFilters(new PrivateExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(config.port, config.bindAddress);
}

void bootstrap();
