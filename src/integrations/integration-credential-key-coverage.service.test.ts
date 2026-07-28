import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { loadAppConfig } from "../config/app-config.js";
import {
  IntegrationCredentialKeyCoverageService,
  missingKeyVersions
} from "./integration-credential-key-coverage.service.js";

test("reports every credential key version missing from the keyring", () => {
  const keys = new Map([[2, Buffer.alloc(32)]]);

  assert.deepEqual(missingKeyVersions([3, 1, 3, 2], keys), [1, 3]);
});

test("fails startup before serving credentials with an incomplete keyring", async () => {
  const key = Buffer.alloc(32, 2).toString("base64url");
  const fingerprintKey = Buffer.alloc(32, 4).toString("base64url");
  const prisma = {
    integrationCredential: {
      groupBy: async ({
        by
      }: {
        readonly by: readonly string[];
      }) =>
        by[0] === "keyVersion"
          ? [{ keyVersion: 1 }, { keyVersion: 2 }]
          : [{ fingerprintKeyVersion: 4 }]
    }
  } as unknown as PrismaService;
  const service = new IntegrationCredentialKeyCoverageService(
    prisma,
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIALS_ENABLED: "true",
      INTEGRATION_CREDENTIAL_KEYS: `2:${key}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "2",
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `4:${fingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "4",
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32)
    })
  );

  await assert.rejects(
    service.onModuleInit(),
    /encryption versions: 1/u
  );
});
