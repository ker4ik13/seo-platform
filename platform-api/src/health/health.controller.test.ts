import assert from "node:assert/strict";
import test from "node:test";
import { HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import type { DependencyHealth } from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { NatsService } from "../messaging/nats.service.js";
import type { DependencyHealthService } from "./dependency-health.service.js";
import { HealthController } from "./health.controller.js";

test("returns HTTP 200 and the health body when every dependency is ready", async () => {
  const response = reply();
  const controller = healthController({
    downstream: [
      { name: "seo-data", status: "ok" },
      { name: "jobs-integrations", status: "ok" },
      { name: "realtime", status: "ok" }
    ]
  });

  const body = await controller.ready(response.value);

  assert.deepEqual(response.codes, [200]);
  assert.equal(body.status, "ok");
  assert.equal(body.version, "test-version");
  assert.equal(body.dependencies?.length, 5);
});

test("returns HTTP 503 while preserving a degraded body for an unavailable dependency", async () => {
  const response = reply();
  const controller = healthController({
    downstream: [
      {
        name: "seo-data",
        status: "unavailable",
        message: "Dependency readiness response invalid"
      }
    ]
  });

  const body = await controller.ready(response.value);

  assert.deepEqual(response.codes, [503]);
  assert.equal(body.status, "degraded");
  assert.equal(body.dependencies?.[2]?.status, "unavailable");
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
    readonly natsError?: Error;
    readonly downstream?: readonly DependencyHealth[];
  } = {}
): HealthController {
  const prisma = {
    ping: () =>
      options.databaseError
        ? Promise.reject(options.databaseError)
        : Promise.resolve()
  } as unknown as PrismaService;
  const nats = {
    ping: () =>
      options.natsError
        ? Promise.reject(options.natsError)
        : Promise.resolve()
  } as unknown as NatsService;
  const dependencies = {
    checkAll: () => Promise.resolve(options.downstream ?? [])
  } as unknown as DependencyHealthService;

  return new HealthController(
    { version: "test-version" } as AppConfig,
    prisma,
    nats,
    dependencies
  );
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
