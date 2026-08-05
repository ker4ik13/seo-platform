import assert from "node:assert/strict";
import test from "node:test";
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { AppConfig } from "../config/app-config.js";
import { KeywordController } from "../keywords/keyword.controller.js";
import { RankHistoryController } from "../rank-results/rank-history.controller.js";
import { RankScopeController } from "../rank-scopes/rank-scope.controller.js";
import { SemanticImportController } from "../semantic-imports/semantic-import.controller.js";
import { TrackingContextController } from "../tracking-contexts/tracking-context.controller.js";
import { JobsApiGuard } from "./jobs-api.guard.js";
import { PlatformApiGuard } from "./platform-api.guard.js";

const platformToken = "p".repeat(32);
const jobsToken = "j".repeat(32);

test("binds every general route group to its exact caller", () => {
  for (const controller of [
    KeywordController,
    RankHistoryController,
    TrackingContextController
  ]) {
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, controller), [
      PlatformApiGuard
    ]);
  }
  for (const controller of [RankScopeController, SemanticImportController]) {
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, controller), [
      JobsApiGuard
    ]);
  }
});

test("isolates Platform API and Jobs callers on the SEO Data audience", () => {
  const config = appConfig(platformToken, jobsToken);
  const platformGuard = new PlatformApiGuard(config);
  const jobsGuard = new JobsApiGuard(config);

  assert.equal(platformGuard.canActivate(context(platformToken)), true);
  assert.equal(jobsGuard.canActivate(context(jobsToken)), true);
  assert.throws(
    () => platformGuard.canActivate(context(jobsToken)),
    UnauthorizedException
  );
  assert.throws(
    () => jobsGuard.canActivate(context(platformToken)),
    UnauthorizedException
  );
});

test("rejects duplicate and malformed service-token headers", () => {
  const guard = new PlatformApiGuard(appConfig(platformToken, jobsToken));
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
  for (const malformed of [
    `${platformToken},${platformToken}`,
    ` ${platformToken}`,
    `${platformToken}\t`,
    "short"
  ]) {
    assert.throws(
      () => guard.canActivate(context(malformed)),
      UnauthorizedException
    );
  }
});

test("fails closed when an audience token is not configured", () => {
  assert.throws(
    () => new PlatformApiGuard(appConfig()).canActivate(context(platformToken)),
    ServiceUnavailableException
  );
  assert.throws(
    () => new JobsApiGuard(appConfig()).canActivate(context(jobsToken)),
    ServiceUnavailableException
  );
});

function appConfig(
  platformApiToken?: string,
  jobsApiToken?: string
): AppConfig {
  return {
    nodeEnv: "test",
    bindAddress: "127.0.0.1",
    port: 4001,
    version: "test",
    databaseUrl: "postgresql://test",
    databasePoolMax: 1,
    ...(platformApiToken ? { platformApiToken } : {}),
    ...(jobsApiToken ? { jobsApiToken } : {}),
    nats: { url: "nats://test" }
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
