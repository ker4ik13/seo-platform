import assert from "node:assert/strict";
import test from "node:test";
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import { RankExecutionGrantGuard } from "./rank-execution-grant.guard.js";

const dedicatedToken = "g".repeat(32);

test("accepts only the dedicated Jobs rank grant token", () => {
  const guard = new RankExecutionGrantGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_SEO_DATA_TOKEN: "s".repeat(32),
      PLATFORM_API_TO_JOBS_TOKEN: "j".repeat(32),
      PLATFORM_API_TO_REALTIME_TOKEN: "r".repeat(32),
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
      PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "n".repeat(32),
      JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: dedicatedToken
    })
  );

  const accepted = context(dedicatedToken);
  assert.equal(guard.canActivate(accepted.value), true);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
  assert.throws(
    () => guard.canActivate(context("i".repeat(32)).value),
    UnauthorizedException
  );
  assert.throws(
    () => guard.canActivate(context("c".repeat(32)).value),
    UnauthorizedException
  );
});

test("fails closed when the dedicated token is not configured", () => {
  const guard = new RankExecutionGrantGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test"
    })
  );

  const unavailable = context(dedicatedToken);
  assert.throws(
    () => guard.canActivate(unavailable.value),
    ServiceUnavailableException
  );
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
});

test("rejects missing, array and raw duplicate token headers", () => {
  const guard = new RankExecutionGrantGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: dedicatedToken
    })
  );

  for (const requestContext of [
    context(undefined),
    context([dedicatedToken]),
    context(dedicatedToken, [
      "X-Rank-Grant-Token",
      dedicatedToken,
      "x-rank-grant-token",
      dedicatedToken
    ])
  ]) {
    assert.throws(
      () => guard.canActivate(requestContext.value),
      UnauthorizedException
    );
    assert.equal(requestContext.headers.get("cache-control"), "no-store");
  }
});

interface GuardContext {
  readonly value: ExecutionContext;
  readonly headers: Map<string, string>;
}

function context(
  token: string | readonly string[] | undefined,
  rawHeaders?: readonly string[]
): GuardContext {
  const headers =
    token === undefined ? {} : { "x-rank-grant-token": token };
  const responseHeaders = new Map<string, string>();
  const value = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        ...(rawHeaders ? { raw: { rawHeaders } } : {})
      }),
      getResponse: () => ({
        header: (name: string, value: string) => {
          responseHeaders.set(name.toLowerCase(), value);
        }
      })
    })
  } as unknown as ExecutionContext;
  return { value, headers: responseHeaders };
}
