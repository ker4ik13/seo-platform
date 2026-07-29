import assert from "node:assert/strict";
import test from "node:test";
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { RankResultApiGuard } from "./rank-result-api.guard.js";

const token = "result-token-that-is-long-enough-for-tests";

test("accepts only the dedicated normalized-result token", () => {
  const guard = new RankResultApiGuard(config(token));
  assert.equal(
    guard.canActivate(context({ "x-rank-result-token": token })),
    true
  );
  assert.throws(
    () =>
      guard.canActivate(
        context({ "x-rank-result-token": "preparation-token" })
      ),
    UnauthorizedException
  );
  assert.throws(
    () =>
      guard.canActivate(
        context({ "x-rank-execution-token": token })
      ),
    UnauthorizedException
  );
});

test("fails closed when result persistence is not configured", () => {
  const guard = new RankResultApiGuard(config(undefined));
  assert.throws(
    () => guard.canActivate(context({})),
    ServiceUnavailableException
  );
});

function config(
  jobsToSeoRankResultToken: string | undefined
): AppConfig {
  return {
    nodeEnv: "test",
    port: 4001,
    version: "test",
    databaseUrl: "postgresql://test",
    databasePoolMax: 1,
    ...(jobsToSeoRankResultToken
      ? { jobsToSeoRankResultToken }
      : {}),
    nats: { url: "nats://test" }
  };
}

function context(
  headers: Readonly<Record<string, string>>
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers })
    })
  } as unknown as ExecutionContext;
}
