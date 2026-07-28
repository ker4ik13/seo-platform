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
  const guard = new IntegrationCredentialApiGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTERNAL_API_TOKEN: "i".repeat(32),
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: dedicatedToken
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
