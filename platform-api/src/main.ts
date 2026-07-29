import "reflect-metadata";
import fastifyCookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { loadAppConfig } from "./config/app-config.js";
import { applyRankExecutionGrantNoStore } from "./rankings/rank-execution-grant-http.js";

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

  await app.register(fastifyCookie);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  adapter.getInstance().addHook("onSend", async (request, reply, payload) => {
    applyRankExecutionGrantNoStore(request, reply);
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

  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
