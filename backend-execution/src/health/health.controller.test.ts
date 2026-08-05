import assert from "node:assert/strict";
import test from "node:test";
import { HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { EmailPort } from "../email/email.port.js";
import type { NatsService } from "../messaging/nats.service.js";
import type { QueueService } from "../queue/queue.service.js";
import type { ObjectStoragePort } from "../storage/object-storage.port.js";
import { HealthController } from "./health.controller.js";

test("returns HTTP 200 when required dependencies are ready and optional adapters are disabled", async () => {
  const response = reply();
  const storage = optionalAdapter(false);
  const email = optionalAdapter(false);
  const body = await healthController({ storage, email }).ready(response.value);

  assert.deepEqual(response.codes, [200]);
  assert.equal(body.status, "ok");
  assert.deepEqual(
    body.dependencies?.slice(3).map(({ name, status, message }) => ({
      name,
      status,
      message
    })),
    [
      {
        name: "s3",
        status: "degraded",
        message: "Adapter is intentionally disabled"
      },
      {
        name: "email",
        status: "degraded",
        message: "Adapter is intentionally disabled"
      }
    ]
  );
  assert.equal(storage.healthChecks, 0);
  assert.equal(email.healthChecks, 0);
});

test("returns HTTP 503 and a degraded body when a required dependency fails", async () => {
  const response = reply();
  const body = await healthController({
    redisError: new Error("unavailable")
  }).ready(response.value);

  assert.deepEqual(response.codes, [503]);
  assert.equal(body.status, "degraded");
  assert.equal(body.dependencies?.[1]?.name, "redis");
  assert.equal(body.dependencies?.[1]?.status, "unavailable");
});

test("keeps an enabled optional adapter failure non-blocking", async () => {
  const response = reply();
  const storage = optionalAdapter(
    true,
    new Error("object storage unavailable")
  );
  const body = await healthController({ storage }).ready(response.value);

  assert.deepEqual(response.codes, [200]);
  assert.equal(body.status, "ok");
  assert.equal(body.dependencies?.[3]?.status, "unavailable");
  assert.equal(storage.healthChecks, 1);
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
    readonly storage?: TestOptionalAdapter;
    readonly email?: TestOptionalAdapter;
  } = {}
): HealthController {
  return new HealthController(
    { version: "test-version" } as AppConfig,
    dependency(options.databaseError) as unknown as PrismaService,
    dependency(options.natsError) as unknown as NatsService,
    dependency(options.redisError) as unknown as QueueService,
    (options.storage ?? optionalAdapter(false))
      .value as unknown as ObjectStoragePort,
    (options.email ?? optionalAdapter(false)).value as unknown as EmailPort
  );
}

function dependency(error?: Error): { ping: () => Promise<void> } {
  return {
    ping: () => (error ? Promise.reject(error) : Promise.resolve())
  };
}

interface TestOptionalAdapter {
  readonly value: {
    isEnabled: () => boolean;
    healthCheck: () => Promise<void>;
  };
  readonly healthChecks: number;
}

function optionalAdapter(
  enabled: boolean,
  error?: Error
): TestOptionalAdapter {
  let healthChecks = 0;
  return {
    value: {
      isEnabled: () => enabled,
      healthCheck: () => {
        healthChecks += 1;
        return error ? Promise.reject(error) : Promise.resolve();
      }
    },
    get healthChecks() {
      return healthChecks;
    }
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
