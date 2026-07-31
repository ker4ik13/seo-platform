import assert from "node:assert/strict";
import test from "node:test";
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { AppConfig } from "../config/app-config.js";
import { NotificationController } from "../notifications/notification.controller.js";
import { PlatformApiGuard } from "./platform-api.guard.js";

const platformToken = "p".repeat(32);
const notificationToken = "n".repeat(32);

test("protects the general notification routes with Platform API auth", () => {
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, NotificationController),
    [PlatformApiGuard]
  );
});

test("rejects dedicated, duplicate and malformed tokens on general routes", () => {
  const guard = new PlatformApiGuard(config(platformToken));
  assert.equal(guard.canActivate(context(platformToken)), true);
  for (const token of [notificationToken, "short", ` ${platformToken}`]) {
    assert.throws(
      () => guard.canActivate(context(token)),
      UnauthorizedException
    );
  }
  assert.throws(
    () =>
      guard.canActivate(
        context(platformToken, [
          "X-Internal-Token",
          platformToken,
          "x-internal-token",
          platformToken
        ])
      ),
    UnauthorizedException
  );
});

test("fails closed without general audience configuration", () => {
  assert.throws(
    () => new PlatformApiGuard(config()).canActivate(context(platformToken)),
    ServiceUnavailableException
  );
});

function config(platformApiToken?: string): AppConfig {
  return {
    serviceRole: "HTTP",
    nodeEnv: "test",
    bindAddress: "127.0.0.1",
    port: 4003,
    version: "test",
    databaseUrl: "postgresql://test",
    databasePoolMax: 1,
    redisUrl: "redis://test",
    ...(platformApiToken ? { platformApiToken } : {}),
    nats: { url: "nats://test" },
    eventConsumer: {
      enabled: false,
      fetchExpiresMs: 1_000,
      maxAttempts: 8,
      retryBaseMs: 1_000,
      retryMaxMs: 60_000,
      publishTimeoutMs: 5_000,
      maxPayloadBytes: 65_536,
      shutdownGraceMs: 10_000
    },
    webOrigins: ["https://app.example.test"],
    webPush: {
      registrationEnabled: false,
      deliveryAvailable: false,
      deliveryEnabled: false,
      deliveryAuthorizationTimeoutMs: 5_000,
      endpointOrigins: [],
      subscriptionKeys: new Map(),
      fingerprintKeys: new Map(),
      maxActiveDevices: 20,
      deliveryMaxAttempts: 8,
      deliveryPollIntervalMs: 1_000,
      deliveryLeaseMs: 30_000,
      deliveryRetryBaseMs: 1_000,
      deliveryRetryMaxMs: 300_000,
      deliverySendTimeoutMs: 10_000,
      deliveryTtlSeconds: 3_600,
      expirySweepIntervalMs: 60_000,
      expirySweepBatchSize: 100
    }
  };
}

function context(
  token: string,
  rawHeaders?: readonly string[]
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { "x-internal-token": token },
        ...(rawHeaders ? { raw: { rawHeaders } } : {})
      })
    })
  } as unknown as ExecutionContext;
}
