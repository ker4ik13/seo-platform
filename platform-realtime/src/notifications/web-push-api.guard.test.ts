import assert from "node:assert/strict";
import test from "node:test";
import {
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import { WebPushApiGuard } from "./web-push-api.guard.js";

const dedicatedToken = "p".repeat(32);

test("accepts only the dedicated notification token", () => {
  const guard = new WebPushApiGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_REALTIME_TOKEN: "i".repeat(32),
      PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: dedicatedToken
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
