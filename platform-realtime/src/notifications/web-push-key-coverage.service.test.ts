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

test("persists canaries and rejects same-version key replacement", async () => {
  const prisma = canaryPrisma();
  const environment = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    WEB_PUSH_SUBSCRIPTION_KEYS:
      `4:${Buffer.alloc(32, 1).toString("base64url")}`,
    WEB_PUSH_FINGERPRINT_KEYS:
      `8:${Buffer.alloc(32, 2).toString("base64url")}`
  };
  const config = loadAppConfig(environment);

  await new WebPushKeyCoverageService(
    prisma,
    config
  ).onApplicationBootstrap();
  await new WebPushKeyCoverageService(
    prisma,
    config
  ).onApplicationBootstrap();

  const replaced = loadAppConfig({
    ...environment,
    WEB_PUSH_SUBSCRIPTION_KEYS:
      `4:${Buffer.alloc(32, 9).toString("base64url")}`
  });
  await assert.rejects(
    new WebPushKeyCoverageService(
      prisma,
      replaced
    ).onApplicationBootstrap(),
    /canary verification failed/u
  );
});

function canaryPrisma(): PrismaService {
  const encryption = new Map<number, Readonly<Record<string, unknown>>>();
  const fingerprint = new Map<number, Readonly<Record<string, unknown>>>();
  return {
    webPushSubscription: {
      findMany: async () => [
        { encryptionKeyVersion: 4, fingerprintKeyVersion: 8 }
      ]
    },
    webPushEncryptionKeyCanary: {
      findUnique: async ({ where }: { where: { keyVersion: number } }) =>
        encryption.get(where.keyVersion) ?? null,
      create: async ({ data }: { data: Readonly<Record<string, unknown>> }) => {
        encryption.set(Number(data.keyVersion), data);
        return data;
      }
    },
    webPushFingerprintKeyCanary: {
      findUnique: async ({ where }: { where: { keyVersion: number } }) =>
        fingerprint.get(where.keyVersion) ?? null,
      create: async ({ data }: { data: Readonly<Record<string, unknown>> }) => {
        fingerprint.set(Number(data.keyVersion), data);
        return data;
      }
    }
  } as unknown as PrismaService;
}
