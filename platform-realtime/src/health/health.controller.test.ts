import assert from "node:assert/strict";
import test from "node:test";
import { HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { NatsService } from "../messaging/nats.service.js";
import type { RedisHealthService } from "../redis/redis-health.service.js";
import { HealthController } from "./health.controller.js";

test("returns HTTP 200 when required dependencies are ready", async () => {
  const response = reply();
  const body = await healthController().ready(response.value);

  assert.deepEqual(response.codes, [200]);
  assert.equal(body.status, "ok");
  assert.deepEqual(
    body.dependencies?.map(({ name, status }) => ({ name, status })),
    [
      { name: "postgresql", status: "ok" },
      { name: "redis", status: "ok" },
      { name: "nats", status: "ok" }
    ]
  );
});

test("returns HTTP 503 and preserves the degraded body when Redis is unavailable", async () => {
  const response = reply();
  const body = await healthController({
    redisError: new Error("unavailable")
  }).ready(response.value);

  assert.deepEqual(response.codes, [503]);
  assert.equal(body.status, "degraded");
  assert.equal(body.dependencies?.[1]?.status, "unavailable");
});

test("keeps both liveness routes on the default GET 200 response", () => {
  const controller = healthController();

  assert.deepEqual(
    Reflect.getMetadata(PATH_METADATA, HealthController.prototype.live),
    ["health/live", "internal/v1/health/live"]
  );
  assert.equal(
    Reflect.getMetadata(HTTP_CODE_METADATA, HealthController.prototype.live),
    undefined
  );
  assert.equal(controller.live().status, "ok");
});

function healthController(
  options: {
    readonly databaseError?: Error;
    readonly redisError?: Error;
    readonly natsError?: Error;
  } = {}
): HealthController {
  return new HealthController(
    { version: "test-version" } as AppConfig,
    dependency(options.databaseError) as unknown as PrismaService,
    dependency(options.natsError) as unknown as NatsService,
    dependency(options.redisError) as unknown as RedisHealthService
  );
}

function dependency(error?: Error): { ping: () => Promise<void> } {
  return {
    ping: () => (error ? Promise.reject(error) : Promise.resolve())
  };
}

function reply(): {
  readonly value: FastifyReply;
  readonly codes: number[];
} {
  const codes: number[] = [];
  return {
    value: {
      code: (statusCode: number) => {
        codes.push(statusCode);
      }
    } as unknown as FastifyReply,
    codes
  };
}
