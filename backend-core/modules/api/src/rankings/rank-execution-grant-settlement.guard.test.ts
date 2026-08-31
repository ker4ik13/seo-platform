import assert from "node:assert/strict";
import test from "node:test";
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import { RankExecutionGrantSettlementGuard } from "./rank-execution-grant-settlement.guard.js";

const token = "b".repeat(32);

test("accepts only the dedicated billing settlement token", () => {
  const guard = new RankExecutionGrantSettlementGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN: token
    })
  );
  const accepted = context(token);
  assert.equal(guard.canActivate(accepted.value), true);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
  assert.throws(
    () => guard.canActivate(context("g".repeat(32)).value),
    UnauthorizedException
  );
});

test("fails closed when settlement auth is absent or duplicated", () => {
  const unavailable = new RankExecutionGrantSettlementGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test"
    })
  );
  assert.throws(
    () => unavailable.canActivate(context(token).value),
    ServiceUnavailableException
  );

  const configured = new RankExecutionGrantSettlementGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN: token
    })
  );
  for (const candidate of [
    context(undefined),
    context([token]),
    context(token, [
      "X-Rank-Billing-Settlement-Token",
      token,
      "x-rank-billing-settlement-token",
      token
    ])
  ]) {
    assert.throws(
      () => configured.canActivate(candidate.value),
      UnauthorizedException
    );
  }
});

function context(
  value: string | readonly string[] | undefined,
  rawHeaders?: readonly string[]
): {
  readonly value: ExecutionContext;
  readonly headers: Map<string, string>;
} {
  const responseHeaders = new Map<string, string>();
  return {
    headers: responseHeaders,
    value: {
      switchToHttp: () => ({
        getRequest: () => ({
          headers:
            value === undefined
              ? {}
              : { "x-rank-billing-settlement-token": value },
          ...(rawHeaders ? { raw: { rawHeaders } } : {})
        }),
        getResponse: () => ({
          header: (name: string, headerValue: string) => {
            responseHeaders.set(name.toLowerCase(), headerValue);
          }
        })
      })
    } as unknown as ExecutionContext
  };
}
