import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import {
  installHttpResponsePolicy,
  TRUSTED_PROXY_HOPS
} from "./common/http-response-policy.js";
import { safeRequestId } from "./common/request-id.js";
import type { AppConfig } from "./config/app-config.js";
import { APP_CONFIG } from "./config/config.module.js";
import { RedisIoAdapter } from "./realtime/redis-io.adapter.js";

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    requestIdHeader: false,
    genReqId: safeRequestId,
    trustProxy: TRUSTED_PROXY_HOPS
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: true }
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  const websocketAdapter = new RedisIoAdapter(app, config.redisUrl);

  try {
    await websocketAdapter.connect();
    app.useWebSocketAdapter(websocketAdapter);
    app.enableCors({
      origin: [...config.webOrigins],
      credentials: true
    });
    installHttpResponsePolicy(
      adapter.getInstance(),
      config.nodeEnv
    );
    app.enableShutdownHooks();

    const closeAdapter = (): void => {
      void websocketAdapter.closeConnections().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once("SIGTERM", closeAdapter);
    process.once("SIGINT", closeAdapter);

    await app.init();
    await websocketAdapter.waitUntilReady();
    await app.listen(config.port, "0.0.0.0");
  } catch (error) {
    await websocketAdapter
      .closeConnections()
      .catch(() => undefined);
    await app.close().catch(() => undefined);
    throw error;
  }
}

await bootstrap();
