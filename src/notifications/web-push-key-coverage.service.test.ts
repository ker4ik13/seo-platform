import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import { WebPushKeyCoverageService } from "./web-push-key-coverage.service.js";

test("fails startup when an active device references a missing key version", async () => {
  const prisma = {
    webPushSubscription: {
      findMany: async () => [
        { encryptionKeyVersion: 4, fingerprintKeyVersion: 8 }
      ]
    }
  } as unknown as PrismaService;
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    WEB_PUSH_SUBSCRIPTION_KEYS:
      `3:${Buffer.alloc(32, 1).toString("base64url")}`,
    WEB_PUSH_FINGERPRINT_KEYS:
      `7:${Buffer.alloc(32, 2).toString("base64url")}`
  });

  await assert.rejects(
    new WebPushKeyCoverageService(
      prisma,
      config
    ).onApplicationBootstrap(),
    /does not cover/
  );
});

test("accepts retained key versions used by active devices", async () => {
  const prisma = {
    webPushSubscription: {
      findMany: async () => [
        { encryptionKeyVersion: 4, fingerprintKeyVersion: 8 }
      ]
    }
  } as unknown as PrismaService;
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    WEB_PUSH_SUBSCRIPTION_KEYS:
      `4:${Buffer.alloc(32, 1).toString("base64url")}`,
    WEB_PUSH_FINGERPRINT_KEYS:
      `8:${Buffer.alloc(32, 2).toString("base64url")}`
  });

  await new WebPushKeyCoverageService(
    prisma,
    config
  ).onApplicationBootstrap();
});
