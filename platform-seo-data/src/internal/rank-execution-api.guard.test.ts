import assert from "node:assert/strict";
import test from "node:test";
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { RankExecutionApiGuard } from "./rank-execution-api.guard.js";

const rankToken = "r".repeat(32);

test("accepts only the dedicated rank execution header", () => {
  const guard = new RankExecutionApiGuard(config(rankToken));

  assert.equal(
    guard.canActivate(context({ "x-rank-execution-token": rankToken })),
    true
  );
  assert.throws(
    () => guard.canActivate(context({ "x-internal-token": rankToken })),
    UnauthorizedException
  );
  assert.throws(
    () =>
      guard.canActivate(
        context({ "x-rank-execution-token": "wrong" })
      ),
    UnauthorizedException
  );
});

test("fails closed when the rank execution secret is disabled", () => {
  const guard = new RankExecutionApiGuard(config());
  assert.throws(
    () => guard.canActivate(context({})),
    ServiceUnavailableException
  );
});

function config(jobsToSeoRankToken?: string): AppConfig {
  return {
    nodeEnv: "test",
    port: 4001,
    version: "test",
    databaseUrl: "postgresql://test",
    databasePoolMax: 1,
    ...(jobsToSeoRankToken ? { jobsToSeoRankToken } : {}),
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
