import fastifyCookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import type { Type } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import {
  installHttpResponsePolicy,
  TRUSTED_PROXY_HOPS
} from "./common/http-response-policy.js";
import { loadAppConfig } from "./config/app-config.js";
import { installClusteringRunBodyLimit } from "./semantics/clustering-run-body-limit.js";
import { installKeywordBulkBodyLimit } from "./semantics/keyword-bulk-body-limit.js";

export async function createPlatformApiApplication(
  rootModule: Type<unknown> = AppModule
): Promise<NestFastifyApplication> {
  const config = loadAppConfig();
  const adapter = new FastifyAdapter({
    logger: config.nodeEnv !== "test",
    trustProxy: TRUSTED_PROXY_HOPS,
    requestIdHeader: "x-request-id"
  });
  installClusteringRunBodyLimit(adapter.getInstance());
  installKeywordBulkBodyLimit(adapter.getInstance());
  const app = await NestFactory.create<NestFastifyApplication>(
    rootModule,
    adapter
  );

  await app.register(fastifyCookie);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  installHttpResponsePolicy(adapter.getInstance(), config.nodeEnv);
  adapter.getInstance().addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-Id", request.id);
    reply.header("X-API-Version", "v1");
    return payload;
  });

  if (config.corsOrigins.length > 0) {
    app.enableCors({
      origin: [...config.corsOrigins],
      credentials: true
    });
  }
  return app;
}
