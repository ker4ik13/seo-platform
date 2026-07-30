import assert from "node:assert/strict";
import test from "node:test";
import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext
} from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import { AuthEmailDeliveryGuard } from "./auth-email-delivery.guard.js";

const TOKEN = "e".repeat(32);

test("accepts only one exact dedicated Jobs bearer token and sets no-store", () => {
  const guard = new AuthEmailDeliveryGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN: TOKEN,
      WEB_PUBLIC_URL: "https://app.example.test"
    })
  );
  const accepted = context(`Bearer ${TOKEN}`);
  assert.equal(guard.canActivate(accepted.value), true);
  assert.equal(accepted.headers.get("cache-control"), "no-store");

  for (const authorization of [
    TOKEN,
    `bearer ${TOKEN}`,
    `Bearer  ${TOKEN}`,
    `Bearer ${"x".repeat(32)}`,
    undefined,
    [`Bearer ${TOKEN}`]
  ]) {
    assert.throws(
      () => guard.canActivate(context(authorization).value),
      UnauthorizedException
    );
  }
});

test("rejects duplicate Authorization and fails closed without config", () => {
  const guard = new AuthEmailDeliveryGuard(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN: TOKEN,
      WEB_PUBLIC_URL: "https://app.example.test"
    })
  );
  assert.throws(
    () =>
      guard.canActivate(
        context(`Bearer ${TOKEN}`, [
          "Authorization",
          `Bearer ${TOKEN}`,
          "authorization",
          `Bearer ${TOKEN}`
        ]).value
      ),
    UnauthorizedException
  );

  const unavailable = new AuthEmailDeliveryGuard(
    loadAppConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://test" })
  );
  assert.throws(
    () => unavailable.canActivate(context(`Bearer ${TOKEN}`).value),
    ServiceUnavailableException
  );
});

function context(
  authorization: string | readonly string[] | undefined,
  rawHeaders?: readonly string[]
): { readonly value: ExecutionContext; readonly headers: Map<string, string> } {
  const responseHeaders = new Map<string, string>();
  return {
    value: {
      switchToHttp: () => ({
        getRequest: () => ({
          headers:
            authorization === undefined ? {} : { authorization },
          ...(rawHeaders ? { raw: { rawHeaders } } : {})
        }),
        getResponse: () => ({
          header: (name: string, value: string) =>
            responseHeaders.set(name.toLowerCase(), value)
        })
      })
    } as unknown as ExecutionContext,
    headers: responseHeaders
  };
}
