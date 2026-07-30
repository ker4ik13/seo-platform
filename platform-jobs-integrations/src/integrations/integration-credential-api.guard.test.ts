import assert from "node:assert/strict";
import test from "node:test";
import {
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import { IntegrationCredentialApiGuard } from "./integration-credential-api.guard.js";

const dedicatedToken = "c".repeat(32);

test("accepts only the dedicated Platform API credential token", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const fingerprintKey = Buffer.alloc(32, 2).toString("base64url");
  const guard = new IntegrationCredentialApiGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_JOBS_TOKEN: "i".repeat(32),
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: dedicatedToken,
      INTEGRATION_CREDENTIAL_ROLE: "MANAGEMENT",
      INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `1:${fingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "1"
    })
  );

  assert.equal(guard.canActivate(context(dedicatedToken)), true);
  assert.throws(
    () => guard.canActivate(context("i".repeat(32))),
    UnauthorizedException
  );
});

function context(token: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { "x-internal-token": token }
      })
    })
  } as unknown as ExecutionContext;
}
